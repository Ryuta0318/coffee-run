// COFFEE RUN — 社内コーヒー共同注文・PayPay精算
//   Worker + Durable Object（SQLite）1つで、データ・リアルタイム配信（WebSocket）・
//   締切5分前の通知（Alarm）・Web Push をまかなう。
import { DurableObject } from "cloudflare:workers";
import { generateVapid, sendPush, endpointAllowed } from "./push.js";
import { MENU, MENU_VERSION, STORES, fitSize } from "./menu.js";

const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rid = (n = 12) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

class HttpError extends Error {
  constructor(s, m) {
    super(m);
    this.status = s;
  }
}
const bad = (m = "bad_request") => new HttpError(400, m);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneLine = (v, max) => str(typeof v === "string" ? v.replace(/[\r\n]+/g, " ") : "", max);

const COLORS = ["#EF2027", "#A0643C", "#C49A78", "#2C1710", "#3F7A3A"];
const MODES = ["go", "ask"];
const PAYPAY_URL = /https:\/\/qr\.paypay\.ne\.jp\/[A-Za-z0-9_-]{6,100}/;
const MIN = 60e3;
const JST = 9 * 3600e3;
const hmJst = (ms) => {
  const d = new Date(ms + JST);
  return d.getUTCHours() + ":" + String(d.getUTCMinutes()).padStart(2, "0");
};
const yen = (n) => (n || 0).toLocaleString("ja-JP");
const POST_LIMIT = 100;

export default {
  async fetch(req, env) {
    const stub = env.HUB.get(env.HUB.idFromName("main"));
    return stub.fetch(req);
  },
};

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.init();
    });
    // 端末からの ping には DO を起こさずに pong を返す
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  init() {
    for (const s of [
      "CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, name TEXT NOT NULL, paypay_id TEXT NOT NULL DEFAULT '', color TEXT NOT NULL, last_orders TEXT NOT NULL DEFAULT '{}', created_at INTEGER)",
      "CREATE TABLE IF NOT EXISTS sessions(tok TEXT PRIMARY KEY, uid TEXT, ts INTEGER)",
      "CREATE TABLE IF NOT EXISTS menu_items(store TEXT, id TEXT, g TEXT, name TEXT, p TEXT, t TEXT, c INTEGER, sort INTEGER, active INTEGER DEFAULT 1, PRIMARY KEY(store,id))",
      "CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, organizer_id TEXT, paypay_id TEXT, title TEXT, body TEXT, store TEXT, deadline_at INTEGER, depart_at INTEGER, closed INTEGER DEFAULT 0, notified_5min INTEGER DEFAULT 0, created_at INTEGER)",
      "CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at)",
      // item_name / size_label は注文時点の表示名。メニューが変わっても注文の内容は変わらない
      "CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, post_id TEXT, user_id TEXT, mode TEXT, item_id TEXT, item_name TEXT, size_index INTEGER, size_label TEXT, temp TEXT, note TEXT, price INTEGER, status TEXT DEFAULT 'unpaid', created_at INTEGER, UNIQUE(post_id,user_id))",
      "CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id)",
      "CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, post_id TEXT, user_id TEXT, text TEXT, created_at INTEGER)",
      "CREATE INDEX IF NOT EXISTS messages_post ON messages(post_id, created_at)",
      "CREATE TABLE IF NOT EXISTS push_subs(id TEXT PRIMARY KEY, uid TEXT, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT, ts INTEGER)",
      "CREATE INDEX IF NOT EXISTS ps_uid ON push_subs(uid)",
      "CREATE TABLE IF NOT EXISTS attempts(k TEXT PRIMARY KEY, n INTEGER, ts INTEGER)",
      "CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)",
    ])
      this.sql.exec(s);
    // PayPay は ID ではなく「マイコード」のリンクで受け取る（v1 からの追加）
    for (const col of ["ALTER TABLE profiles ADD COLUMN paypay_url TEXT NOT NULL DEFAULT ''", "ALTER TABLE posts ADD COLUMN paypay_url TEXT NOT NULL DEFAULT ''"]) {
      try {
        this.sql.exec(col);
      } catch {}
    }
    const v = this.one("SELECT v FROM kv WHERE k='menu_version'");
    if (!v || Number(v.v) < MENU_VERSION) {
      for (const store of Object.keys(MENU)) this.replaceMenu(store, MENU[store]);
      this.run("INSERT OR REPLACE INTO kv(k,v) VALUES('menu_version',?)", String(MENU_VERSION));
    }
  }

  q(sql, ...a) {
    return this.sql.exec(sql, ...a).toArray();
  }
  one(sql, ...a) {
    return this.q(sql, ...a)[0] || null;
  }
  run(sql, ...a) {
    this.sql.exec(sql, ...a);
  }

  // ---- メニュー ----
  replaceMenu(store, items) {
    this.run("UPDATE menu_items SET active=0 WHERE store=?", store);
    items.forEach((it, i) => {
      this.run(
        "INSERT OR REPLACE INTO menu_items(store,id,g,name,p,t,c,sort,active) VALUES(?,?,?,?,?,?,?,?,1)",
        store, it.id, it.g, it.name, JSON.stringify(it.p), it.t, it.c | 0, i
      );
    });
  }
  menu() {
    const out = {};
    for (const s of Object.keys(STORES)) out[s] = [];
    for (const r of this.q("SELECT * FROM menu_items WHERE active=1 ORDER BY sort")) {
      if (out[r.store]) out[r.store].push({ id: r.id, g: r.g, name: r.name, p: JSON.parse(r.p), t: r.t, c: r.c });
    }
    return out;
  }
  item(store, id) {
    const r = this.one("SELECT * FROM menu_items WHERE store=? AND id=? AND active=1", store, id);
    return r ? { id: r.id, name: r.name, p: JSON.parse(r.p), t: r.t } : null;
  }

  // ---- 入口 ----
  async fetch(req) {
    try {
      this.origin = new URL(req.url).origin;
      this.rememberOrigin();
      return await this.route(req, new URL(req.url));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e && e.stack ? e.stack : e);
      return json({ error: "server" }, 500);
    }
  }

  async sessionUser(req) {
    const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)cr=([a-f0-9]{48})/);
    if (!m) return null;
    const s = this.one("SELECT uid FROM sessions WHERE tok=?", await sha(m[1]));
    return s ? this.one("SELECT * FROM profiles WHERE id=?", s.uid) : null;
  }
  async startSession(uid) {
    const tok = rid(24);
    this.run("INSERT INTO sessions(tok,uid,ts) VALUES(?,?,?)", await sha(tok), uid, Date.now());
    return `cr=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=63072000`;
  }
  async body(req) {
    try {
      const b = await req.json();
      return b && typeof b === "object" ? b : {};
    } catch {
      throw bad("json");
    }
  }
  // 同じ回線からの回数制限
  limit(key, max, windowMs) {
    // ローカル開発（wrangler dev）では数えない
    if (/:(local|127\.0\.0\.1|::1)$/.test(key)) return;
    const now = Date.now();
    const r = this.one("SELECT n, ts FROM attempts WHERE k=?", key);
    if (r && now - r.ts < windowMs) {
      if (r.n >= max) throw new HttpError(429, "too_many");
      this.run("UPDATE attempts SET n=n+1 WHERE k=?", key);
    } else this.run("INSERT OR REPLACE INTO attempts(k,n,ts) VALUES(?,1,?)", key, now);
  }

  // ---- 出力の形 ----
  profileOut(p) {
    return p ? { id: p.id, name: p.name, color: p.color } : null;
  }
  meOut(p) {
    if (!p) return null;
    const st = this.one("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='unpaid' THEN price ELSE 0 END),0) due FROM orders WHERE user_id=?", p.id);
    let last = {};
    try {
      last = JSON.parse(p.last_orders || "{}");
    } catch {}
    return { ...this.profileOut(p), paypayUrl: p.paypay_url || "", last, stats: { count: st.n, due: st.due } };
  }
  postsOut(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => "?").join(",");
    const orders = this.q(`SELECT * FROM orders WHERE post_id IN (${ph}) ORDER BY created_at`, ...ids);
    const msgs = this.q(`SELECT * FROM messages WHERE post_id IN (${ph}) ORDER BY created_at`, ...ids);
    return rows.map((r) => ({
      id: r.id,
      organizerId: r.organizer_id,
      paypayUrl: r.paypay_url || "",
      paypayId: r.paypay_id || "", // 以前の投稿（ID で登録していたころ）用
      title: r.title,
      body: r.body,
      store: r.store,
      deadline: r.deadline_at,
      depart: r.depart_at,
      closed: !!r.closed,
      createdAt: r.created_at,
      orders: orders.filter((o) => o.post_id === r.id).map((o) => ({
        id: o.id,
        userId: o.user_id,
        mode: o.mode,
        itemId: o.item_id,
        name: o.item_name,
        size: o.size_index,
        sizeLabel: o.size_label,
        temp: o.temp,
        note: o.note,
        price: o.price,
        status: o.status,
      })),
      msgs: msgs.filter((m) => m.post_id === r.id).map((m) => ({ id: m.id, userId: m.user_id, text: m.text, ts: m.created_at })),
    }));
  }
  postOut(id) {
    const r = this.one("SELECT * FROM posts WHERE id=?", id);
    return r ? this.postsOut([r])[0] : null;
  }
  needPost(id) {
    const p = this.one("SELECT * FROM posts WHERE id=?", id);
    if (!p) throw new HttpError(404, "not_found");
    return p;
  }
  locked(p, now = Date.now()) {
    return !!p.closed || now >= p.deadline_at;
  }

  // ---- リアルタイム配信 ----
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(s);
      } catch {}
    }
  }
  sendPost(id) {
    const post = this.postOut(id);
    if (post) this.broadcast({ t: "post", post });
  }
  webSocketMessage() {}
  webSocketClose(ws, code) {
    try {
      ws.close(code, "bye");
    } catch {}
  }
  webSocketError() {}

  // ---- ルーティング ----
  async route(req, url) {
    const path = url.pathname;
    const method = req.method;
    const me = await this.sessionUser(req);
    const need = () => {
      if (!me) throw new HttpError(401, "login");
      return me;
    };
    let m;

    if (path === "/api/ws") {
      if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      need();
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (path === "/api/boot" && method === "GET") {
      const rows = this.q("SELECT * FROM posts ORDER BY created_at DESC LIMIT ?", POST_LIMIT);
      const profiles = {};
      for (const p of this.q("SELECT * FROM profiles")) profiles[p.id] = this.profileOut(p);
      return json({ now: Date.now(), me: this.meOut(me), profiles, posts: me ? this.postsOut(rows) : [], menu: this.menu(), stores: STORES });
    }

    // ---- アカウント ----
    if (path === "/api/signup" && method === "POST") {
      const ip = req.headers.get("cf-connecting-ip") || "local";
      this.limit("signup:" + ip, 20, 3600e3);
      const b = await this.body(req);
      const p = this.cleanProfile(b);
      const id = rid(10);
      this.run("INSERT INTO profiles(id,name,paypay_url,color,created_at) VALUES(?,?,?,?,?)", id, p.name, p.paypayUrl, p.color, Date.now());
      const cookie = await this.startSession(id);
      const row = this.one("SELECT * FROM profiles WHERE id=?", id);
      this.broadcast({ t: "profile", profile: this.profileOut(row) });
      return json({ me: this.meOut(row) }, 200, { "set-cookie": cookie });
    }
    if (path === "/api/me" && method === "GET") return json({ me: this.meOut(need()) });
    if (path === "/api/me" && method === "POST") {
      const u = need();
      const p = this.cleanProfile(await this.body(req));
      this.run("UPDATE profiles SET name=?, paypay_url=?, color=? WHERE id=?", p.name, p.paypayUrl, p.color, u.id);
      const row = this.one("SELECT * FROM profiles WHERE id=?", u.id);
      this.broadcast({ t: "profile", profile: this.profileOut(row) });
      return json({ me: this.meOut(row) });
    }
    if (path === "/api/logout" && method === "POST") {
      const m2 = (req.headers.get("cookie") || "").match(/(?:^|;\s*)cr=([a-f0-9]{48})/);
      if (m2) this.run("DELETE FROM sessions WHERE tok=?", await sha(m2[1]));
      if (me) this.run("DELETE FROM push_subs WHERE uid=?", me.id);
      return json({ ok: true }, 200, { "set-cookie": "cr=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
    }

    // ---- 投稿 ----
    if (path === "/api/posts" && method === "POST") {
      const u = need();
      if (!u.paypay_url) throw bad("paypay_required");
      const b = await this.body(req);
      const store = b.store;
      if (!STORES[store]) throw bad("store");
      const title = oneLine(b.title, 40);
      if (!title) throw bad("title");
      const body = str(b.body, 500) || STORES[store].label + "行きますが皆さんいけますか？";
      const now = Date.now();
      const deadline = Math.floor(Number(b.deadline) / MIN) * MIN;
      const depart = Math.floor(Number(b.depart) / MIN) * MIN;
      if (!Number.isFinite(deadline) || deadline <= now || deadline > now + 12 * 3600e3) throw bad("deadline");
      if (!Number.isFinite(depart) || depart < deadline || depart > deadline + 3 * 3600e3) throw bad("depart");
      const id = rid(8);
      this.run(
        "INSERT INTO posts(id,organizer_id,paypay_url,title,body,store,deadline_at,depart_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id, u.id, u.paypay_url, title, body, store, deadline, depart, now
      );
      this.sendPost(id);
      this.pushAll(
        { t: "COFFEE RUN", b: `${u.name}さんが${STORES[store].label}に行きます｜締切 ${hmJst(deadline)}`, u: "/?p=" + id, g: "post-" + id },
        u.id
      );
      await this.scheduleAlarm();
      return json({ post: this.postOut(id) });
    }

    if ((m = path.match(/^\/api\/posts\/([a-f0-9]{16})\/close$/)) && method === "POST") {
      const u = need();
      const p = this.needPost(m[1]);
      if (p.organizer_id !== u.id) throw new HttpError(403, "organizer_only");
      const b = await this.body(req);
      const closed = !!b.closed;
      if (!closed && Date.now() >= p.deadline_at) throw bad("past_deadline");
      this.run("UPDATE posts SET closed=? WHERE id=?", closed ? 1 : 0, p.id);
      this.sendPost(p.id);
      await this.scheduleAlarm();
      return json({ post: this.postOut(p.id) });
    }

    if ((m = path.match(/^\/api\/posts\/([a-f0-9]{16})\/order$/)) && method === "PUT") {
      const u = need();
      const p = this.needPost(m[1]);
      if (this.locked(p)) throw bad("closed");
      const o = this.cleanOrder(p.store, await this.body(req));
      const prev = this.one("SELECT * FROM orders WHERE post_id=? AND user_id=?", p.id, u.id);
      // 投稿者は自分で立て替えるので、自分の分は最初から確認済み
      let status = u.id === p.organizer_id ? "done" : "unpaid";
      if (prev && prev.price === o.price && status !== "done") status = prev.status;
      if (prev) {
        this.run(
          "UPDATE orders SET mode=?, item_id=?, item_name=?, size_index=?, size_label=?, temp=?, note=?, price=?, status=? WHERE id=?",
          o.mode, o.itemId, o.name, o.size, o.sizeLabel, o.temp, o.note, o.price, status, prev.id
        );
      } else {
        this.run(
          "INSERT INTO orders(id,post_id,user_id,mode,item_id,item_name,size_index,size_label,temp,note,price,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          rid(8), p.id, u.id, o.mode, o.itemId, o.name, o.size, o.sizeLabel, o.temp, o.note, o.price, status, Date.now()
        );
      }
      // 「いつもの」
      let last = {};
      try {
        last = JSON.parse(u.last_orders || "{}");
      } catch {}
      last[p.store] = { itemId: o.itemId, size: o.size, temp: o.temp, note: o.note, mode: o.mode, customName: o.itemId === "_other" ? o.name : "", customPrice: o.itemId === "_other" ? o.price : 0 };
      this.run("UPDATE profiles SET last_orders=? WHERE id=?", JSON.stringify(last), u.id);
      this.sendPost(p.id);
      return json({ post: this.postOut(p.id), me: this.meOut(this.one("SELECT * FROM profiles WHERE id=?", u.id)), changed: !!prev });
    }

    if ((m = path.match(/^\/api\/orders\/([a-f0-9]{16})$/)) && method === "DELETE") {
      const u = need();
      const o = this.one("SELECT * FROM orders WHERE id=?", m[1]);
      if (!o) throw new HttpError(404, "not_found");
      const p = this.needPost(o.post_id);
      const isOrg = p.organizer_id === u.id;
      // 本人は受付中だけ取り消せる。投稿者はいつでも
      if (!isOrg && !(o.user_id === u.id && !this.locked(p))) throw new HttpError(403, "forbidden");
      this.run("DELETE FROM orders WHERE id=?", o.id);
      this.sendPost(p.id);
      return json({ post: this.postOut(p.id) });
    }

    if ((m = path.match(/^\/api\/orders\/([a-f0-9]{16})\/status$/)) && method === "POST") {
      const u = need();
      const o = this.one("SELECT * FROM orders WHERE id=?", m[1]);
      if (!o) throw new HttpError(404, "not_found");
      const p = this.needPost(o.post_id);
      const to = (await this.body(req)).status;
      const isOrg = p.organizer_id === u.id;
      // unpaid →（本人が報告）reported →（投稿者が確認）done。done → unpaid は投稿者のみ
      const ok =
        (to === "reported" && o.status === "unpaid" && o.user_id === u.id) ||
        (to === "done" && o.status === "reported" && isOrg) ||
        (to === "unpaid" && o.status === "done" && isOrg);
      if (!ok) throw new HttpError(403, "bad_transition");
      this.run("UPDATE orders SET status=? WHERE id=?", to, o.id);
      this.sendPost(p.id);
      if (to === "reported") {
        this.pushTo(p.organizer_id, { t: "COFFEE RUN", b: `${this.nameOf(u.id)}さんが ¥${yen(o.price)} の送金を報告しました｜${p.title}`, u: "/?p=" + p.id + "&tab=pay", g: "pay-" + p.id });
      }
      return json({ post: this.postOut(p.id) });
    }

    if ((m = path.match(/^\/api\/posts\/([a-f0-9]{16})\/remind$/)) && method === "POST") {
      const u = need();
      const p = this.needPost(m[1]);
      if (p.organizer_id !== u.id) throw new HttpError(403, "organizer_only");
      this.limit("remind:" + p.id, 6, 3600e3);
      const unpaid = this.q("SELECT * FROM orders WHERE post_id=? AND status='unpaid'", p.id);
      for (const o of unpaid) {
        this.pushTo(o.user_id, { t: "COFFEE RUN｜精算のお願い", b: `${p.title} ¥${yen(o.price)} を${u.name}さんへ PayPay で送金してください`, u: "/?p=" + p.id + "&tab=pay", g: "pay-" + p.id });
      }
      return json({ sent: unpaid.length });
    }

    if ((m = path.match(/^\/api\/posts\/([a-f0-9]{16})\/messages$/)) && method === "POST") {
      const u = need();
      const p = this.needPost(m[1]);
      const text = str((await this.body(req)).text, 500);
      if (!text) throw bad("text");
      this.limit("msg:" + u.id, 60, 60e3);
      this.run("INSERT INTO messages(id,post_id,user_id,text,created_at) VALUES(?,?,?,?,?)", rid(8), p.id, u.id, text, Date.now());
      this.sendPost(p.id);
      return json({ post: this.postOut(p.id) });
    }

    // ---- プッシュ通知 ----
    if (path === "/api/push/key" && method === "GET") return json({ key: (await this.getVapid()).publicKey });
    if (path === "/api/push/subscribe" && method === "POST") {
      const u = need();
      const b = await this.body(req);
      const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
      const keys = b.keys || {};
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (!endpointAllowed(endpoint, local) || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") throw bad("subscription");
      this.run("DELETE FROM push_subs WHERE endpoint=?", endpoint);
      this.run("INSERT INTO push_subs(id,uid,endpoint,p256dh,auth,ts) VALUES(?,?,?,?,?,?)", rid(8), u.id, endpoint, keys.p256dh.slice(0, 200), keys.auth.slice(0, 100), Date.now());
      return json({ ok: true });
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      const u = need();
      const b = await this.body(req);
      this.run("DELETE FROM push_subs WHERE uid=? AND endpoint=?", u.id, String(b.endpoint || ""));
      return json({ ok: true });
    }

    // ---- 管理（メニューの更新）。wrangler secret put ADMIN_TOKEN で設定したトークンが必要 ----
    if (path === "/api/admin/menu") {
      const tok = String((this.env && this.env.ADMIN_TOKEN) || "");
      const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      this.limit("admin:" + (req.headers.get("cf-connecting-ip") || "local"), 30, 600e3);
      if (!tok || tok.length < 12 || (await sha(got)) !== (await sha(tok))) throw new HttpError(401, "admin");
      if (method === "GET") return json({ menu: this.menu(), stores: STORES });
      if (method === "PUT") {
        const b = await this.body(req);
        if (!STORES[b.store] || !Array.isArray(b.items) || !b.items.length) throw bad("menu");
        const items = b.items.map((x) => this.cleanMenuItem(b.store, x));
        if (new Set(items.map((x) => x.id)).size !== items.length) throw bad("duplicate_id");
        this.replaceMenu(b.store, items);
        this.broadcast({ t: "menu", menu: this.menu() });
        return json({ menu: this.menu() });
      }
    }

    if (path.startsWith("/api/")) throw new HttpError(404, "not_found");
    return new Response("not found", { status: 404 });
  }

  nameOf(uid) {
    const r = this.one("SELECT name FROM profiles WHERE id=?", uid);
    return r ? r.name : "";
  }

  // ---- 入力チェック ----
  cleanProfile(b) {
    const name = oneLine(b.name, 20);
    if (!name) throw bad("name");
    // PayPay の「マイコード」のリンク。共有の文面ごと貼られても、リンクだけを取り出す
    const raw = typeof b.paypayUrl === "string" ? b.paypayUrl.slice(0, 500) : "";
    const m = raw.match(PAYPAY_URL);
    if (raw.trim() && !m) throw bad("paypay_url");
    const paypayUrl = m ? m[0] : "";
    const color = COLORS.includes(b.color) ? b.color : COLORS[0];
    return { name, paypayUrl, color };
  }
  cleanOrder(store, b) {
    const mode = MODES.includes(b.mode) ? b.mode : "ask";
    const note = oneLine(b.note, 80);
    const temp0 = b.temp === "ICED" ? "ICED" : "HOT";
    if (b.itemId === "_other") {
      const name = oneLine(b.customName, 40);
      const price = Math.floor(Number(String(b.customPrice ?? "").replace(/[^0-9]/g, "")));
      if (!name) throw bad("custom_name");
      if (!(price > 0 && price <= 20000)) throw bad("custom_price");
      return { mode, note, itemId: "_other", name, size: null, sizeLabel: "", temp: temp0, price };
    }
    const it = this.item(store, String(b.itemId || ""));
    if (!it) throw bad("item");
    const size = fitSize(it.p, Number(b.size));
    const temp = it.t === "both" ? temp0 : it.t;
    return { mode, note, itemId: it.id, name: it.name, size, sizeLabel: STORES[store].sizes[size], temp, price: it.p[size] };
  }
  cleanMenuItem(store, x) {
    const n = STORES[store].sizes.length;
    const id = String(x && x.id || "");
    if (!/^[a-z0-9_-]{1,32}$/.test(id) || id === "_other") throw bad("menu_id");
    const name = oneLine(x.name, 60);
    const g = oneLine(x.g, 30);
    if (!name || !g) throw bad("menu_name");
    const p = Array.isArray(x.p) ? x.p.slice(0, n) : [];
    while (p.length < n) p.push(null);
    const prices = p.map((v) => (v === null || v === "" ? null : Math.floor(Number(v))));
    if (prices.some((v) => v !== null && !(v > 0 && v <= 20000)) || prices.every((v) => v === null)) throw bad("menu_price");
    const t = ["both", "HOT", "ICED"].includes(x.t) ? x.t : "both";
    const c = Math.min(3, Math.max(0, Math.floor(Number(x.c)) || 0));
    return { id, g, name, p: prices, t, c };
  }

  // ---- プッシュ通知 ----
  async getVapid() {
    if (this._vapid) return this._vapid;
    const row = this.one("SELECT v FROM kv WHERE k='vapid'");
    if (row) this._vapid = JSON.parse(row.v);
    else {
      this._vapid = await generateVapid();
      this.run("INSERT INTO kv(k,v) VALUES('vapid',?)", JSON.stringify(this._vapid));
    }
    return this._vapid;
  }
  // Alarm から送るときはリクエストが無いので、最後に見た https のオリジンを保存しておく
  rememberOrigin() {
    if (!this.origin || !this.origin.startsWith("https://") || this.origin === this._savedOrigin) return;
    this._savedOrigin = this.origin;
    this.run("INSERT OR REPLACE INTO kv(k,v) VALUES('origin',?)", this.origin);
  }
  pushSubject() {
    if (this.env && this.env.PUSH_SUBJECT) return this.env.PUSH_SUBJECT;
    const o = this.origin || (this.one("SELECT v FROM kv WHERE k='origin'") || {}).v;
    return o && o.startsWith("https://") ? o : "mailto:coffee-run@example.com";
  }
  pushTo(uid, payload) {
    const subs = this.q("SELECT * FROM push_subs WHERE uid=?", uid);
    if (subs.length) this.ctx.waitUntil(this.deliver(subs, payload));
  }
  pushAll(payload, exceptUid) {
    const subs = this.q("SELECT * FROM push_subs WHERE uid!=?", exceptUid || "");
    if (!subs.length) return Promise.resolve();
    const done = this.deliver(subs, payload);
    this.ctx.waitUntil(done);
    return done;
  }
  async deliver(subs, payload) {
    const vapid = await this.getVapid();
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const code = await sendPush(sub, body, vapid, this.pushSubject(), { urgency: "high", ttl: 1800 });
          if (code === 404 || code === 410) this.run("DELETE FROM push_subs WHERE id=?", sub.id);
          else if (code >= 400) console.error("push status", code);
        } catch (e) {
          console.error("push fail", String(e));
        }
      })
    );
  }

  // ---- 締切5分前の通知（Alarm）----
  // 対象: deadline - 5分 <= now < deadline かつ未通知・未締切
  async scheduleAlarm() {
    const now = Date.now();
    const r = this.one("SELECT MIN(deadline_at) d FROM posts WHERE notified_5min=0 AND closed=0 AND deadline_at>?", now);
    if (r && r.d) await this.ctx.storage.setAlarm(Math.max(now + 1000, r.d - 5 * MIN));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    try {
      const now = Date.now();
      const due = this.q("SELECT * FROM posts WHERE notified_5min=0 AND closed=0 AND deadline_at>? AND deadline_at-?<=?", now, 5 * MIN, now);
      const sending = [];
      for (const p of due) {
        this.run("UPDATE posts SET notified_5min=1 WHERE id=?", p.id);
        sending.push(this.pushAll({ t: "COFFEE RUN", b: `締切まであと5分｜${p.title} ${STORES[p.store].label}`, u: "/?p=" + p.id, g: "post-" + p.id }));
      }
      await Promise.all(sending);
    } catch (e) {
      console.error("alarm", String(e));
    } finally {
      await this.scheduleAlarm();
    }
  }
}
