// COFFEE RUN — 画面（Preact + htm、ビルド不要）
//   見た目と挙動は design/Coffee Order v2.dc.html（デザインのプロトタイプ）をそのまま移植している。
//   データはサーバー（/api/*）に保存し、WebSocket（/api/ws）で全員にリアルタイムで反映する。
import { h, render, Component } from "preact";
import htm from "htm";

const html = htm.bind(h);

const RED = "#EF2027";
const SL = "#2C1710";
const MIN = 60000;
const LOGO = "/assets/coffee-run-logo.svg";
const COLORS = ["#EF2027", "#A0643C", "#C49A78", "#2C1710", "#3F7A3A"];
const OTHER = { id: "_other", g: "その他", name: "その他のドリンク", p: [null], t: "both", c: 3 };
// アイコン色: [背景, ふた, カップ] 0 coffee / 1 milk / 2 tea / 3 sweet
const TINT = [["#EAE2D8", "#2C1710", "#2A1810"], ["#F3EADF", "#E7D6C4", "#A0643C"], ["#E4F0DB", "#A9D18E", "#3F7A3A"], ["#F3EADF", "#C49A78", "#C81A20"]];
const QUICK = ["了解！", "ありがとう！", "今どこ？", "着きました", "追加いいですか？"];
const ERRORS = {
  login: "もう一度ログインしてください",
  closed: "受付は締め切られました",
  paypay_required: "投稿にはPayPay IDの登録が必要です",
  deadline: "締切の時刻をもう一度選んでください",
  depart: "出発の時刻をもう一度選んでください",
  past_deadline: "締切時刻を過ぎているため再開できません",
  bad_transition: "状態が変わっています。画面を更新しました",
  forbidden: "この操作はできません",
  organizer_only: "投稿者だけができる操作です",
  too_many: "少し時間をおいてからもう一度お試しください",
  custom_name: "ドリンク名を入力してください",
  custom_price: "金額を入力してください",
  item: "メニューが更新されています。もう一度選んでください",
  not_found: "投稿が見つかりません",
  network: "通信できませんでした。電波の良いところでもう一度",
};

// ---- 小さな道具 ----
const yen = (n) => (n || 0).toLocaleString("ja-JP");
const hm = (ms) => {
  const d = new Date(ms);
  return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
};
const dayTitle = (d) => d.getMonth() + 1 + "/" + d.getDate() + "（" + "日月火水木金土"[d.getDay()] + "）";
const bodyFor = (stores, store) => stores[store].label + "行きますが皆さんいけますか？";
const countdown = (ms) => {
  if (ms <= 0) return "0:00";
  const t = Math.floor(ms / 1000), hh = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return hh ? hh + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
};
const ago = (ms, now) => {
  const m = Math.floor((now - ms) / MIN);
  if (m < 1) return "たった今";
  if (m < 60) return m + "分前";
  if (m < 1440) return Math.floor(m / 60) + "時間前";
  return Math.floor(m / 1440) + "日前";
};
const fit = (ps, sz) => {
  let i = Math.min(Math.max(0, sz | 0), ps.length - 1);
  while (i > 0 && ps[i] == null) i--;
  if (ps[i] == null) i = ps.findIndex((x) => x != null);
  return i;
};
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobile = () => isIOS() || /Android/.test(navigator.userAgent);
const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};

async function copy(t) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {}
  // 古いブラウザ向け
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error("network");
    e.code = "network";
    throw e;
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.error || "server");
    e.code = j.error || "server";
    e.status = res.status;
    throw e;
  }
  return j;
}

// ---- プッシュ通知 ----
const b64uToU8 = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
function pushSupport() {
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (ok) return { ok: true };
  return { ok: false, why: isIOS() && !standalone() ? "ios" : "none" };
}
async function pushCurrent() {
  if (!pushSupport().ok || Notification.permission !== "granted") return null;
  try {
    const r = await navigator.serviceWorker.ready;
    return await r.pushManager.getSubscription();
  } catch {
    return null;
  }
}
async function pushEnable() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm;
  const reg = await navigator.serviceWorker.ready;
  const k = await api("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(k.key) });
  const j = sub.toJSON();
  await api("/api/push/subscribe", { method: "POST", body: { endpoint: j.endpoint, keys: j.keys } });
  return "granted";
}
async function pushDisable() {
  const sub = await pushCurrent();
  if (!sub) return;
  const ep = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: ep } }).catch(() => {});
}

// ---- 部品 ----
const Av = ({ size, bg, fs, children, extra = "" }) =>
  html`<span style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#FFFFFF;font-size:${fs}px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;${extra}">${children}</span>`;

const Splash = ({ onSkip }) => html`
  <div class="splash" onClick=${onSkip} style="position:fixed;inset:0;z-index:50;background:#FBF7F2;display:flex;align-items:center;justify-content:center;overflow:hidden;animation:crFade 350ms ease 1950ms forwards;cursor:pointer">
    <div style="position:relative;width:min(72vw, 320px)">
      ${[0, 1, 2].map(
        (i) => html`<span style="position:absolute;right:100%;margin-right:${10 + i * 8}px;top:${22 + i * 20}%;width:${84 - i * 22}px;height:7px;border-radius:4px;background:${i === 1 ? RED : SL};transform-origin:right center;animation:crLine 620ms cubic-bezier(.2,.8,.2,1) ${60 + i * 70}ms both"></span>`
      )}
      <img src=${LOGO} alt="COFFEE RUN" style="width:100%;display:block;animation:crDash 760ms cubic-bezier(.2,.8,.2,1) both" />
      <div style="margin-top:20px;text-align:center;font-size:13px;font-weight:700;color:#7A6A5E;letter-spacing:0.12em;animation:crUp 420ms ease 780ms both">みんなのコーヒー、まとめて。</div>
    </div>
  </div>`;

const CupEmpty = () => html`
  <span style="position:relative;width:44px;height:44px;display:block">
    <span style="position:absolute;left:10px;top:0;width:4px;height:10px;border-radius:2px;background:#D8C2AC"></span>
    <span style="position:absolute;left:18px;top:2px;width:4px;height:8px;border-radius:2px;background:#E7D6C4"></span>
    <span style="position:absolute;left:26px;top:0;width:4px;height:10px;border-radius:2px;background:#D8C2AC"></span>
    <span style="position:absolute;left:2px;top:14px;width:34px;height:4px;border-radius:2px;background:#B5A897"></span>
    <span style="position:absolute;left:5px;top:17px;width:28px;height:26px;border-radius:3px 3px 14px 14px;background:#D6CCC0"></span>
    <span style="position:absolute;left:28px;top:21px;width:14px;height:14px;border:4px solid #D6CCC0;border-radius:50%;box-sizing:border-box"></span>
  </span>`;

const CupRed = () => html`
  <span style="position:relative;width:28px;height:28px;display:block">
    <span style="position:absolute;left:6px;top:0;width:3px;height:7px;border-radius:2px;background:#D8C2AC"></span>
    <span style="position:absolute;left:11px;top:1px;width:3px;height:6px;border-radius:2px;background:#E7D6C4"></span>
    <span style="position:absolute;left:16px;top:0;width:3px;height:7px;border-radius:2px;background:#D8C2AC"></span>
    <span style="position:absolute;left:1px;top:9px;width:22px;height:3px;border-radius:2px;background:#C81A20"></span>
    <span style="position:absolute;left:3px;top:11px;width:18px;height:16px;border-radius:2px 2px 9px 9px;background:#EF2027"></span>
    <span style="position:absolute;left:18px;top:13px;width:9px;height:9px;border:3px solid #EF2027;border-radius:50%;box-sizing:border-box"></span>
  </span>`;

const sel = (on) => (on ? { bg: "#F3EADF", fg: RED, bd: RED } : { bg: "#FFFFFF", fg: "#3E2A20", bd: "#D6CCC0" });
const Label = ({ children }) => html`<label style="font-size:13px;font-weight:700;color:#2C1710">${children}</label>`;
const Chip = ({ on, onClick, children, h: ht = 38, fs = 14, r = 19, pad = 16 }) => {
  const c = sel(on);
  return html`<button onClick=${onClick} aria-pressed=${on} style="height:${ht}px;padding:0 ${pad}px;border-radius:${r}px;border:1px solid ${c.bd};background:${c.bg};color:${c.fg};font-size:${fs}px;font-weight:700;cursor:pointer;font-variant-numeric:tabular-nums;flex:none">${children}</button>`;
};

// ---- アプリ ----
class App extends Component {
  constructor() {
    super();
    const q = new URLSearchParams(location.search);
    this.skew = 0;
    this.state = {
      ready: false,
      bootError: false,
      now: Date.now(),
      me: null,
      profiles: {},
      posts: [],
      menu: { sbux: [], mammoth: [] },
      stores: null,
      pf: { name: "", paypayId: "", color: RED },
      view: "feed",
      activeId: q.get("p"),
      startTab: q.get("tab"),
      filter: "all",
      tab: "order",
      sheetId: null,
      sheetOpened: false,
      toast: "",
      draft: null,
      splash: true,
      splashKey: 0,
      chatText: "",
      form: { mode: "ask", cat: "all", itemId: "", size: 1, temp: "HOT", note: "", otherName: "", otherPrice: "" },
      busy: false,
      push: { support: pushSupport(), on: false, dismissed: ls.get("coffeeRun.pushDismissed") === "1" },
      online: true,
    };
  }

  // ---- ライフサイクル ----
  componentDidMount() {
    this.iv = setInterval(() => this.setState({ now: Date.now() + this.skew }), 1000);
    this.st = setTimeout(() => this.setState({ splash: false }), 2400);
    this.boot();
    window.addEventListener("popstate", () => this.fromUrl());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.state.me) {
        this.refresh();
        if (!this.ws || this.ws.readyState > 1) this.connect();
      }
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data && e.data.type === "go") this.openUrl(e.data.url);
      });
    }
    pushCurrent().then((s) => this.setPush({ on: !!s }));
  }
  componentDidUpdate(_, prev) {
    // チャットは新しいメッセージが来たら一番下へ
    const s = this.state;
    if (s.view === "detail" && s.tab === "chat") {
      const p = this.cur();
      const n = p ? p.msgs.length : 0;
      if (n !== this._chatN || prev.tab !== "chat") {
        this._chatN = n;
        requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
      }
    }
  }
  setPush(p) {
    this.setState((s) => ({ push: { ...s.push, ...p } }));
  }

  async boot() {
    try {
      const j = await api("/api/boot");
      this.applyBoot(j);
      if (j.me) this.connect();
      this.setState({ ready: true, bootError: false });
    } catch {
      this.setState({ bootError: true });
    }
  }
  applyBoot(j) {
    this.skew = j.now - Date.now();
    const st = { me: j.me, profiles: j.profiles, posts: j.posts, menu: j.menu, stores: j.stores, now: j.now };
    if (!j.me) Object.assign(st, { view: "signup", pf: { name: "", paypayId: "", color: RED } });
    else if (this.state.view === "signup" || !this.state.ready) {
      st.view = "feed";
      if (this.state.activeId && j.posts.some((p) => p.id === this.state.activeId)) {
        const p = j.posts.find((x) => x.id === this.state.activeId);
        st.view = "detail";
        st.tab = this.state.startTab || (this.lockedAt(p, j.now) ? "pay" : "order");
        st.form = this.formFor(p, j.me, j.menu);
      }
    }
    this.setState(st);
  }
  async refresh() {
    try {
      const j = await api("/api/boot");
      this.applyBoot(j);
    } catch {}
  }
  connect() {
    clearTimeout(this.wsRetry);
    clearInterval(this.wsPing);
    try {
      if (this.ws) this.ws.close();
    } catch {}
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/ws");
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.wsTries = 0;
      if (this.wsWasDown) this.refresh();
      this.wsWasDown = false;
      this.setState({ online: true });
      this.wsPing = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === "post") this.upsert(m.post);
      else if (m.t === "profile") this.setState((s) => ({ profiles: { ...s.profiles, [m.profile.id]: m.profile } }));
      else if (m.t === "menu") this.setState({ menu: m.menu });
    };
    ws.onclose = () => {
      clearInterval(this.wsPing);
      if (this.ws !== ws || !this.state.me) return;
      this.wsWasDown = true;
      if (opened) this.setState({ online: false });
      this.wsTries = (this.wsTries || 0) + 1;
      this.wsRetry = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** Math.min(4, this.wsTries)));
    };
  }
  upsert(post) {
    if (!post) return;
    this.setState((s) => {
      const has = s.posts.some((p) => p.id === post.id);
      const posts = has ? s.posts.map((p) => (p.id === post.id ? post : p)) : [post, ...s.posts];
      posts.sort((a, b) => b.createdAt - a.createdAt);
      return { posts };
    });
  }

  // ---- 画面の移動（スマホの「戻る」でも戻れるように URL に載せる）----
  go(view, extra = {}, push = true) {
    const st = { view, sheetId: null, ...extra };
    this.setState(st);
    if (push) {
      const url = view === "detail" ? "/?p=" + (extra.activeId || this.state.activeId) : view === "feed" || view === "signup" ? "/" : "/?v=" + view;
      if (location.pathname + location.search !== url) history.pushState({ view }, "", url);
    }
    window.scrollTo(0, 0);
  }
  fromUrl() {
    const q = new URLSearchParams(location.search);
    if (!this.state.me) return;
    if (q.get("p")) this.openPost(q.get("p"), q.get("tab"), false);
    else if (q.get("v") === "compose") this.go("compose", { draft: this.state.draft || this.newDraft() }, false);
    else if (q.get("v") === "profile") this.go("profile", { pf: { ...this.state.me } }, false);
    else this.go("feed", {}, false);
  }
  openUrl(url) {
    try {
      const u = new URL(url, location.origin);
      history.pushState({}, "", u.pathname + u.search);
      this.fromUrl();
    } catch {}
  }
  openPost(id, tab, push = true) {
    const p = this.state.posts.find((x) => x.id === id);
    if (!p) {
      this.go("feed", {}, push);
      return;
    }
    const locked = this.lockedAt(p, this.state.now);
    this.go("detail", { activeId: id, tab: tab || (locked ? "pay" : "order"), form: this.formFor(p, this.state.me, this.state.menu) }, push);
  }

  // ---- 計算 ----
  lockedAt(p, now) {
    return p.closed || now >= p.deadline;
  }
  cur() {
    return this.state.posts.find((x) => x.id === this.state.activeId) || null;
  }
  nameOf(uid) {
    const p = this.state.profiles[uid];
    return p ? p.name : "？";
  }
  colorOf(uid) {
    const p = this.state.profiles[uid];
    return p ? p.color : "#C49A78";
  }
  short(o) {
    return o.itemId === "_other" ? o.name + " " + o.temp : o.name + " " + o.sizeLabel + " " + o.temp;
  }
  calc(p) {
    const unpaid = p.orders.filter((o) => o.status === "unpaid");
    const reported = p.orders.filter((o) => o.status === "reported");
    const total = p.orders.reduce((a, o) => a + o.price, 0);
    return { st: this.state.stores[p.store], unpaid, reported, total };
  }
  slots() {
    const q = 15 * MIN;
    const base = Math.ceil(this.state.now / q) * q + q;
    return [0, 1, 2, 3, 5].map((i) => base + i * q);
  }
  newDraft() {
    const store = "mammoth";
    const sl = this.slots();
    return { title: dayTitle(new Date(this.state.now)), store, body: bodyFor(this.state.stores, store), bodyEdited: false, deadline: sl[1], departOff: 10 };
  }
  formFor(p, me, menu) {
    const items = menu[p.store] || [];
    const mine = me && p.orders.find((o) => o.userId === me.id);
    const f = this.state.form;
    if (mine) {
      const other = mine.itemId === "_other" || !items.some((i) => i.id === mine.itemId);
      return {
        mode: mine.mode, cat: "all", itemId: other ? "_other" : mine.itemId, size: mine.size ?? 1, temp: mine.temp, note: mine.note || "",
        otherName: other ? mine.name : "", otherPrice: other ? String(mine.price) : "",
      };
    }
    return { mode: f.mode, cat: "all", itemId: items[0] ? items[0].id : "_other", size: 1, temp: "HOT", note: "", otherName: "", otherPrice: "" };
  }
  setForm(p) {
    this.setState((s) => ({ form: { ...s.form, ...p } }));
  }
  setDraft(p) {
    this.setState((s) => ({ draft: { ...s.draft, ...p } }));
  }
  showToast(t) {
    clearTimeout(this.tt);
    this.setState({ toast: t });
    this.tt = setTimeout(() => this.setState({ toast: "" }), 2400);
  }
  fail(e) {
    if (e && e.code === "login") {
      this.setState({ me: null, view: "signup" });
    }
    if (e && (e.code === "bad_transition" || e.code === "closed")) this.refresh();
    this.showToast(ERRORS[e && e.code] || "うまくいきませんでした。もう一度お試しください");
  }
  async act(fn) {
    if (this.state.busy) return;
    this.setState({ busy: true });
    try {
      return await fn();
    } catch (e) {
      this.fail(e);
    } finally {
      this.setState({ busy: false });
    }
  }
  replaySplash() {
    clearTimeout(this.st);
    this.setState((s) => ({ splash: true, splashKey: s.splashKey + 1 }));
    this.st = setTimeout(() => this.setState({ splash: false }), 2400);
  }
  async sendMsg(text) {
    const t = (text || "").trim();
    const p = this.cur();
    if (!t || !p) return;
    this.setState({ chatText: "" });
    try {
      const j = await api("/api/posts/" + p.id + "/messages", { method: "POST", body: { text: t } });
      this.upsert(j.post);
    } catch (e) {
      this.setState({ chatText: t });
      this.fail(e);
    }
  }
  async togglePush() {
    const ps = this.state.push;
    if (!ps.support.ok) {
      this.showToast(ps.support.why === "ios" ? "ホーム画面に追加してから開くと通知を使えます" : "このブラウザは通知に対応していません");
      return;
    }
    try {
      if (ps.on) {
        await pushDisable();
        this.setPush({ on: false });
        this.showToast("通知をオフにしました");
      } else {
        const r = await pushEnable();
        if (r === "granted") {
          this.setPush({ on: true });
          this.showToast("通知をオンにしました");
        } else this.showToast("通知が許可されませんでした。ブラウザの設定から許可してください");
      }
    } catch (e) {
      this.fail(e);
    }
  }
  dismissPush() {
    ls.set("coffeeRun.pushDismissed", "1");
    this.setPush({ dismissed: true });
  }

  // ---- 描画 ----
  render() {
    const s = this.state;
    if (!s.ready) {
      return html`<div style="min-height:100vh;background:#F4EEE6;display:flex;justify-content:center">
        <div style="width:100%;max-width:480px;background:#FFFFFF;min-height:100vh;box-shadow:0 0 0 1px #EAE2D8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 20px;box-sizing:border-box">
          ${s.bootError
            ? html`<img src=${LOGO} alt="COFFEE RUN" style="height:20px;width:auto" />
                <span style="font-size:13px;color:#7A6A5E">${ERRORS.network}</span>
                <button onClick=${() => this.boot()} class="hv-dim" style="height:46px;padding:0 24px;border:none;border-radius:23px;background:${RED};color:#FFFFFF;font-size:14px;font-weight:700;cursor:pointer">再読み込み</button>`
            : null}
        </div>
        ${s.splash ? html`<${Splash} key=${"sp" + s.splashKey} onSkip=${() => this.setState({ splash: false })} />` : null}
      </div>`;
    }
    const v = this.vals();
    return html`
      <div style="min-height:100vh;background:#F4EEE6;display:flex;justify-content:center;padding:0 0 80px">
        <div data-screen-label="Coffee Run" style="width:100%;max-width:480px;background:#FFFFFF;min-height:100vh;display:flex;flex-direction:column;box-shadow:0 0 0 1px #EAE2D8">
          ${this.header(v)}
          ${!s.online ? html`<div role="status" style="background:#FBE6E4;color:#A3161B;font-size:12px;font-weight:700;padding:8px 20px">接続が切れました。再接続しています…</div>` : null}
          ${v.isFeed ? this.feedView(v) : null}
          ${v.isProfileView ? this.profileView(v) : null}
          ${v.isCompose ? this.composeView(v) : null}
          ${v.isDetail ? this.detailView(v) : null}
          ${v.sheetOpen ? this.sheetView(v) : null}
          ${s.splash ? html`<${Splash} key=${"sp" + s.splashKey} onSkip=${() => this.setState({ splash: false })} />` : null}
          ${s.toast
            ? html`<div role="status" aria-live="polite" style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#2A1810;color:#FFFFFF;padding:10px 18px 10px 10px;border-radius:24px;font-size:13px;z-index:30;max-width:90vw;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;gap:10px">
                <span style="width:26px;height:26px;border-radius:50%;background:#EF2027;display:flex;align-items:center;justify-content:center;flex:none;font-size:12px;font-weight:700">✓</span>
                <span>${s.toast}</span>
              </div>`
            : null}
        </div>
      </div>`;
  }

  vals() {
    const s = this.state;
    const now = s.now;
    const me = s.me || { id: "", name: "", paypayId: "", color: RED, last: {}, stats: { count: 0, due: 0 } };
    let view = s.view;
    if (view === "compose" && !s.draft) view = "feed";
    let p = view === "detail" ? this.cur() : null;
    if (view === "detail" && !p) view = "feed";
    return {
      s, now, me, view, p,
      isFeed: view === "feed", isCompose: view === "compose", isDetail: view === "detail",
      isSub: view !== "feed" && view !== "signup", isSignup: view === "signup", isProfile: view === "profile",
      isProfileView: view === "signup" || view === "profile",
      sheetOpen: view === "detail" && !!s.sheetId && p.orders.some((o) => o.id === s.sheetId),
      meInitial: me.name.slice(0, 1),
    };
  }

  header(v) {
    const backLabel = v.view === "compose" ? "キャンセル" : v.view === "profile" ? "戻る" : "投稿一覧";
    return html`
      <header style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 12px 20px;gap:12px;border-bottom:1px solid #F4EEE6;position:sticky;top:0;background:#FFFFFF;z-index:6;min-height:44px">
        ${v.isFeed
          ? html`
              <button onClick=${() => this.replaySplash()} aria-label="COFFEE RUN" style="border:none;background:transparent;padding:0;cursor:pointer"><img src=${LOGO} alt="COFFEE RUN" style="height:30px;width:auto;display:block" /></button>
              <div style="display:flex;align-items:center;gap:8px">
                <button onClick=${() => this.go("compose", { draft: this.newDraft() })} class="hv-red" style="height:36px;padding:0 16px;border-radius:18px;border:none;background:#EF2027;color:#FFFFFF;font-size:13px;font-weight:700;cursor:pointer">＋ 投稿</button>
                <button onClick=${() => this.openProfile()} aria-label="アカウント" style="width:36px;height:36px;border-radius:50%;border:none;background:${v.me.color};color:#FFFFFF;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center">${v.meInitial}</button>
              </div>`
          : null}
        ${v.isSignup ? html`<img src=${LOGO} alt="COFFEE RUN" style="height:20px;width:auto;display:block" />` : null}
        ${v.isSub
          ? html`
              <button onClick=${() => this.back()} class="hv-back" style="height:36px;padding:0 14px 0 8px;border-radius:18px;border:none;background:#F4EEE6;color:#2C1710;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px"><span style="font-size:16px">‹</span>${backLabel}</button>
              <img src=${LOGO} alt="COFFEE RUN" style="height:20px;width:auto;display:block" />`
          : null}
      </header>`;
  }
  back() {
    if (history.state && history.length > 1 && location.search) history.back();
    else this.go("feed");
  }
  async openProfile() {
    this.go("profile", { pf: { ...this.state.me } });
    try {
      const j = await api("/api/me");
      this.setState({ me: j.me });
    } catch {}
  }

  // ---- フィード ----
  feedView(v) {
    const s = v.s, now = v.now;
    const isLocked = (p) => this.lockedAt(p, now);
    const postStatus = (p, c) =>
      !isLocked(p) ? ["募集中", "#F3EADF", "#A0643C"]
        : c.unpaid.length + c.reported.length ? ["未精算 " + (c.unpaid.length + c.reported.length), "#FBE6E4", "#A3161B"]
        : ["完了", "#E4F0DB", "#3F7A3A"];
    const tFg = (p) => (p.deadline - now < 5 * MIN ? "#A3161B" : "#2A1810");
    const all = s.posts.map((p) => ({ p, c: this.calc(p) }));
    const list = all.filter((x) => s.filter === "all" || (s.filter === "open" ? !isLocked(x.p) : x.c.unpaid.length + x.c.reported.length > 0));
    const ps = s.push;
    const showPushCard = !ps.on && !ps.dismissed && (ps.support.ok ? Notification.permission !== "denied" : ps.support.why === "ios");
    return html`
      <main data-screen-label="フィード" style="display:flex;flex-direction:column">
        <button onClick=${() => this.go("compose", { draft: this.newDraft() })} style="display:flex;align-items:center;gap:12px;padding:16px 20px;border:none;border-bottom:1px solid #F4EEE6;background:#FFFFFF;cursor:pointer;text-align:left">
          <${Av} size=${40} bg=${v.me.color} fs=${15}>${v.meInitial}<//>
          <span style="flex:1;display:flex;flex-direction:column;gap:3px">
            <span style="font-size:14px;font-weight:700">${v.me.name}</span>
            <span style="font-size:14px;color:#A09284">みんなもコーヒーいるかな？</span>
          </span>
          <span style="height:32px;padding:0 14px;border-radius:16px;border:1px solid #D6CCC0;color:#7A6A5E;font-size:12px;font-weight:700;display:flex;align-items:center">投稿</span>
        </button>

        ${showPushCard
          ? html`<div style="margin:12px 20px 0;padding:12px 12px 12px 14px;background:#F3EADF;border-radius:14px;display:flex;align-items:center;gap:10px">
              <span style="flex:1;min-width:0;font-size:12px;line-height:1.6;color:#3E2A20">${ps.support.ok
                ? html`<b style="color:#2C1710">通知をオンにしよう</b><br />新しい投稿と、締切5分前にお知らせします`
                : html`<b style="color:#2C1710">iPhoneで通知を受け取るには</b><br />共有ボタン →「ホーム画面に追加」して、そのアイコンから開いてください`}</span>
              ${ps.support.ok
                ? html`<button onClick=${() => this.togglePush()} class="hv-red" style="height:32px;padding:0 14px;border-radius:16px;border:none;background:#EF2027;color:#FFFFFF;font-size:12px;font-weight:700;cursor:pointer;flex:none">オンにする</button>`
                : null}
              <button onClick=${() => this.dismissPush()} aria-label="閉じる" class="hv-txt" style="width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:#A09284;font-size:16px;cursor:pointer;flex:none">×</button>
            </div>`
          : null}

        <div class="noscroll" style="display:flex;gap:6px;padding:12px 20px;border-bottom:1px solid #F4EEE6;overflow-x:auto">
          ${[["all", "すべて"], ["open", "募集中"], ["unpaid", "未精算あり"]].map(([k, label]) => {
            const c = sel(s.filter === k);
            return html`<button onClick=${() => this.setState({ filter: k })} aria-pressed=${s.filter === k} style="height:32px;padding:0 14px;border-radius:16px;border:1px solid ${c.bd};background:${c.bg};color:${c.fg};font-size:12px;font-weight:700;cursor:pointer;flex:none">${label}</button>`;
          })}
        </div>

        ${list.map(({ p, c }) => {
          const [stLabel, stBg, stFg] = postStatus(p, c);
          const goN = p.orders.filter((o) => o.mode === "go").length;
          const locked = isLocked(p);
          const org = this.nameOf(p.organizerId);
          const joinText = (p.orders.length ? p.orders.length + "人が注文" + (goN ? "・" + goN + "人同行" : "") : "まだ注文なし") + (p.msgs.length ? "・コメント" + p.msgs.length : "");
          return html`
            <article key=${p.id} onClick=${() => this.openPost(p.id)} onKeyDown=${(e) => e.key === "Enter" && this.openPost(p.id)} tabindex="0" class="hv-row" style="display:flex;gap:12px;padding:16px 20px 14px;border-bottom:1px solid #F4EEE6;cursor:pointer;transition:background 160ms ease">
              <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:none">
                <${Av} size=${40} bg=${this.colorOf(p.organizerId)} fs=${15}>${org.slice(0, 1)}<//>
                <span style="width:2px;flex:1;min-height:12px;background:#F4EEE6;border-radius:1px"></span>
              </div>
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:14px;font-weight:700">${org}</span>
                  <span style="font-size:12px;color:#A09284">${ago(p.createdAt, now)}</span>
                  <span style="margin-left:auto;font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:${stBg};color:${stFg}">${stLabel}</span>
                </div>
                <span style="font-size:18px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums">${p.title}</span>
                <span style="font-size:14px;line-height:1.6;color:#3E2A20;text-wrap:pretty;white-space:pre-wrap;word-break:break-word">${p.body}</span>
                <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #EAE2D8;border-radius:12px;margin-top:4px">
                  <span style="width:30px;height:30px;border-radius:50%;background:${c.st.markBg};color:#FFFFFF;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none">${c.st.mark}</span>
                  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px">
                    <span style="font-size:13px;font-weight:700">${c.st.label}</span>
                    <span style="font-size:11px;color:#7A6A5E;font-variant-numeric:tabular-nums">締切 ${hm(p.deadline)}・出発 ${hm(p.depart)}・${p.orders.length}杯</span>
                  </span>
                  ${!locked
                    ? html`<span style="flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:1px;padding-left:10px;border-left:1px dashed #EAE2D8">
                        <span style="font-size:9px;color:#7A6A5E;letter-spacing:0.08em">締切まで</span>
                        <span style="font-size:17px;font-family:'Archivo Black','Noto Sans JP',sans-serif;font-weight:400;color:${tFg(p)};font-variant-numeric:tabular-nums;line-height:1.1">${countdown(p.deadline - now)}</span>
                      </span>`
                    : null}
                </div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:2px">
                  <div style="display:flex;align-items:center">
                    ${p.orders.slice(0, 4).map(
                      (o) => html`<span style="width:24px;height:24px;border-radius:50%;background:#F3EADF;border:2px solid #FFFFFF;color:#EF2027;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-left:-6px;box-sizing:border-box">${this.nameOf(o.userId).slice(0, 1)}</span>`
                    )}
                  </div>
                  <span style="font-size:12px;color:#7A6A5E">${joinText}</span>
                  ${!locked ? html`<span style="margin-left:auto;height:30px;padding:0 14px;border-radius:15px;background:#EF2027;color:#FFFFFF;font-size:12px;font-weight:700;display:flex;align-items:center;flex:none">注文する</span>` : null}
                  ${locked && c.unpaid.length > 0 ? html`<span style="margin-left:auto;height:30px;padding:0 14px;border-radius:15px;border:1px solid #EF2027;color:#EF2027;font-size:12px;font-weight:700;display:flex;align-items:center;box-sizing:border-box;flex:none">精算する</span>` : null}
                </div>
              </div>
            </article>`;
        })}
        ${list.length === 0 ? html`<div style="padding:48px 20px;text-align:center;font-size:13px;color:#A09284">該当する投稿はありません</div>` : null}
      </main>`;
  }

  // ---- アカウント ----
  profileView(v) {
    const s = v.s;
    const pf = s.pf;
    const nameOk = !!pf.name.trim();
    const due = v.me.stats ? v.me.stats.due : 0;
    const ps = s.push;
    const save = () =>
      this.act(async () => {
        if (!nameOk) return;
        const body = { name: pf.name.trim(), paypayId: pf.paypayId.trim(), color: pf.color };
        if (v.isSignup) {
          const j = await api("/api/signup", { method: "POST", body });
          this.setState({ me: j.me });
          await this.refresh();
          this.connect();
          this.go("feed");
          this.showToast("ようこそ、" + j.me.name + "さん");
        } else {
          const j = await api("/api/me", { method: "POST", body });
          this.setState((x) => ({ me: j.me, profiles: { ...x.profiles, [j.me.id]: { id: j.me.id, name: j.me.name, paypayId: j.me.paypayId, color: j.me.color } } }));
          // 投稿画面から PayPay ID の登録に来たときは、投稿画面に戻す
          if (s.draft && j.me.paypayId) this.go("compose", { draft: s.draft });
          else this.go("feed");
          this.showToast("プロフィールを保存しました");
        }
      });
    const logout = () =>
      this.act(async () => {
        await pushDisable().catch(() => {});
        await api("/api/logout", { method: "POST" });
        try {
          if (this.ws) this.ws.close();
        } catch {}
        this.ws = null;
        this.setState({ me: null, posts: [], pf: { name: "", paypayId: "", color: RED }, draft: null, push: { ...ps, on: false } });
        this.go("signup");
      });
    const onKey = (e) => {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) save();
    };
    return html`
      <main data-screen-label="アカウント" style="padding:32px 20px 24px;display:flex;flex-direction:column;gap:22px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">
          <span style="width:76px;height:76px;border-radius:50%;background:${pf.color};color:#FFFFFF;font-size:30px;font-weight:700;display:flex;align-items:center;justify-content:center;transition:background 160ms ease">${(pf.name || "？").slice(0, 1)}</span>
          ${v.isSignup
            ? html`<div style="display:flex;flex-direction:column;gap:6px;align-items:center">
                <img src=${LOGO} alt="COFFEE RUN" style="width:100%;max-width:280px;height:auto;display:block;margin:4px 0 10px" />
                <span style="font-size:20px;font-weight:700">ようこそ！</span>
                <span style="font-size:13px;color:#7A6A5E;line-height:1.6">一度登録すれば、名前やPayPay IDの入力は毎回不要です</span>
              </div>`
            : null}
          ${v.isProfile ? html`<span style="font-size:20px;font-weight:700">アカウント</span>` : null}
        </div>

        ${v.isProfile
          ? html`<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
              <div style="background:#F4EEE6;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:2px"><span style="font-size:11px;color:#7A6A5E">これまでの注文</span><span style="font-size:20px;font-weight:700;font-variant-numeric:tabular-nums">${v.me.stats ? v.me.stats.count : 0}<span style="font-size:11px;font-weight:400;margin-left:2px">杯</span></span></div>
              <div style="background:${due ? "#FBE6E4" : "#F4EEE6"};border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:2px"><span style="font-size:11px;color:#7A6A5E">未払い</span><span style="font-size:20px;font-weight:700;color:${due ? "#A3161B" : "#2A1810"};font-variant-numeric:tabular-nums">¥${yen(due)}</span></div>
            </div>`
          : null}

        <div style="display:flex;flex-direction:column;gap:8px">
          <label for="pf-name" style="font-size:13px;font-weight:700;color:#2C1710">表示名</label>
          <input id="pf-name" class="inp" value=${pf.name} maxlength="20" autocomplete="nickname" onInput=${(e) => this.setState((x) => ({ pf: { ...x.pf, name: e.currentTarget.value } }))} onKeyDown=${onKey} placeholder="例：山田" style="height:48px;padding:0 14px;border:1px solid #D6CCC0;border-radius:10px;font-size:15px;outline:none" />
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label for="pf-paypay" style="font-size:13px;font-weight:700;color:#2C1710">PayPay ID<span style="font-weight:400;color:#A09284;margin-left:6px">投稿して立て替えるときに使用</span></label>
          <input id="pf-paypay" class="inp" value=${pf.paypayId} maxlength="40" autocapitalize="off" autocomplete="off" spellcheck="false" onInput=${(e) => this.setState((x) => ({ pf: { ...x.pf, paypayId: e.currentTarget.value } }))} onKeyDown=${onKey} placeholder="例：yamada-kc" style="height:48px;padding:0 14px;border:1px solid #D6CCC0;border-radius:10px;font-size:15px;outline:none" />
          <span style="font-size:11px;color:#A09284;line-height:1.6">PayPayアプリの「アカウント」→「PayPay ID」で確認できます</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <${Label}>アイコンの色<//>
          <div style="display:flex;gap:12px" role="radiogroup" aria-label="アイコンの色">
            ${COLORS.map(
              (cl) => html`<button onClick=${() => this.setState((x) => ({ pf: { ...x.pf, color: cl } }))} role="radio" aria-checked=${pf.color === cl} aria-label="色を選ぶ" style="width:40px;height:40px;border-radius:50%;border:3px solid ${pf.color === cl ? "#2A1810" : "transparent"};padding:3px;background:#FFFFFF;cursor:pointer;box-sizing:border-box"><span style="display:block;width:100%;height:100%;border-radius:50%;background:${cl}"></span></button>`
            )}
          </div>
        </div>

        ${v.isProfile
          ? html`<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #EAE2D8;border-radius:14px">
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
                <span style="font-size:13px;font-weight:700;color:#2C1710">通知</span>
                <span style="font-size:11px;color:#7A6A5E;line-height:1.5">${ps.support.ok
                  ? ps.on ? "オン：新しい投稿・締切5分前・精算のお知らせ" : "オフ"
                  : ps.support.why === "ios" ? "ホーム画面に追加して開くと使えます" : "このブラウザは対応していません"}</span>
              </div>
              ${ps.support.ok
                ? html`<button onClick=${() => this.togglePush()} style="height:32px;padding:0 12px;border-radius:16px;border:1px solid ${ps.on ? "#D6CCC0" : RED};background:#FFFFFF;color:${ps.on ? "#7A6A5E" : RED};font-size:12px;font-weight:700;cursor:pointer;flex:none">${ps.on ? "オフにする" : "オンにする"}</button>`
                : null}
            </div>`
          : null}

        <button onClick=${save} class="hv-dim" style="height:54px;border:none;border-radius:27px;background:${nameOk ? RED : "#D6CCC0"};color:#FFFFFF;font-size:16px;font-weight:700;cursor:pointer;margin-top:4px">${v.isSignup ? (nameOk ? "はじめる" : "表示名を入力") : "保存する"}</button>
        ${v.isProfile ? html`<button onClick=${logout} class="hv-txt" style="height:40px;border:none;background:transparent;color:#A09284;font-size:13px;cursor:pointer">ログアウト</button>` : null}
        <div style="font-size:11px;color:#A09284;line-height:1.6;text-align:center">この端末では、次回から自動でログインします。</div>
      </main>`;
  }

  // ---- 新規投稿 ----
  composeView(v) {
    const s = v.s, d = s.draft, me = v.me, stores = s.stores;
    const postOk = !!me.paypayId && !!d.title.trim();
    const departs = [0, 10, 15, 30];
    const post = () =>
      this.act(async () => {
        if (!postOk) {
          if (!me.paypayId) {
            this.go("profile", { pf: { ...me } });
            this.showToast("投稿にはPayPay IDの登録が必要です");
          }
          return;
        }
        const title = d.title.trim();
        const body = d.body.trim() || bodyFor(stores, d.store);
        const depart = d.deadline + d.departOff * MIN;
        // クリップボードは操作の直後でないと書けないブラウザがあるので、送信より先にコピーする
        await copy("☕ COFFEE RUN｜" + title + "\n" + body + "\n" + stores[d.store].label + "・注文締切 " + hm(d.deadline) + "／出発 " + hm(depart) + "\n支払いはPayPay（ID: " + me.paypayId + "）\n" + location.origin + "/");
        const j = await api("/api/posts", { method: "POST", body: { title, body, store: d.store, deadline: d.deadline, depart } });
        this.upsert(j.post);
        this.go("feed", { draft: null, filter: "all" });
        this.showToast("投稿しました。共有文をコピー済み");
      });
    return html`
      <main data-screen-label="新規投稿" style="padding:20px;display:flex;flex-direction:column;gap:22px">
        <div style="display:flex;gap:12px">
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:none">
            <${Av} size=${40} bg=${me.color} fs=${15}>${v.meInitial}<//>
            <span style="width:2px;flex:1;background:#EAE2D8;border-radius:1px"></span>
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px">
            <input value=${d.title} maxlength="40" aria-label="タイトル" onInput=${(e) => this.setDraft({ title: e.currentTarget.value })} placeholder="10/1（水）" style="border:none;outline:none;font-size:22px;font-weight:700;padding:6px 0 2px;font-variant-numeric:tabular-nums;min-width:0" />
            <textarea value=${d.body} maxlength="500" aria-label="本文" onInput=${(e) => this.setDraft({ body: e.currentTarget.value, bodyEdited: true })} rows="3" placeholder="マンモスコーヒー行きますが皆さんいけますか？" style="border:none;outline:none;resize:none;font-size:15px;line-height:1.6;padding:0;color:#3E2A20"></textarea>
            <div style="height:1px;background:#D8C2AC"></div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <${Label}>どこで買う？<//>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
            ${Object.entries(stores).map(([k, st]) => {
              const on = k === d.store;
              return html`<button onClick=${() => this.setDraft(d.bodyEdited ? { store: k } : { store: k, body: bodyFor(stores, k) })} aria-pressed=${on} style="position:relative;text-align:left;padding:16px 14px 14px;border-radius:14px;border:2px solid ${on ? RED : "#EAE2D8"};background:${on ? "#F3EADF" : "#FFFFFF"};cursor:pointer;display:flex;flex-direction:column;gap:10px;transition:border-color 160ms ease,background 160ms ease">
                <span style="width:40px;height:40px;border-radius:50%;background:${st.markBg};color:#FFFFFF;font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center">${st.mark}</span>
                <span style="display:flex;flex-direction:column;gap:3px">
                  <span style="font-size:15px;font-weight:700;color:#2A1810">${st.label}</span>
                  <span style="font-size:11px;color:#7A6A5E">${st.sub}</span>
                </span>
                ${on ? html`<span style="position:absolute;top:12px;right:12px;width:22px;height:22px;border-radius:50%;background:#EF2027;color:#FFFFFF;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">✓</span>` : null}
              </button>`;
            })}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <${Label}>注文の締切<//>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${this.slots().map((t) => html`<${Chip} on=${hm(t) === hm(d.deadline)} onClick=${() => this.setDraft({ deadline: t })}>${hm(t)}<//>`)}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <${Label}>出発時間<//>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${departs.map((m) => html`<${Chip} on=${m === d.departOff} onClick=${() => this.setDraft({ departOff: m })}>${hm(d.deadline + m * MIN) + (m ? "" : "（締切と同時）")}<//>`)}
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #EAE2D8;border-radius:14px">
          <${Av} size=${36} bg=${me.color} fs=${14}>${v.meInitial}<//>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
            <span style="font-size:11px;color:#7A6A5E">受取・立替</span>
            <span style="font-size:14px;font-weight:700">${me.name}<span style="font-weight:400;color:#2C1710;margin-left:8px;font-size:12px">PayPay ID: ${me.paypayId || "未登録"}</span></span>
          </div>
          <button onClick=${() => this.go("profile", { pf: { ...me } })} style="height:32px;padding:0 12px;border-radius:16px;border:1px solid #D6CCC0;background:#FFFFFF;color:#7A6A5E;font-size:12px;font-weight:700;cursor:pointer">変更</button>
        </div>

        <button onClick=${post} class="hv-dim" style="height:54px;border:none;border-radius:27px;background:${postOk ? RED : "#D6CCC0"};color:#FFFFFF;font-size:16px;font-weight:700;cursor:pointer">${postOk ? "投稿する" : !me.paypayId ? "PayPay IDを登録して投稿" : "タイトルを入力"}</button>
        <div style="font-size:11px;color:#A09284;line-height:1.6;text-align:center">投稿すると共有用の文面がコピーされます。Slack・Teamsに貼り付けてください。</div>
      </main>`;
  }

  // ---- 投稿詳細 ----
  detailView(v) {
    const s = v.s, p = v.p, now = v.now, me = v.me;
    const c = this.calc(p), st = c.st;
    const locked = this.lockedAt(p, now);
    const tFg = p.deadline - now < 5 * MIN ? "#A3161B" : "#2A1810";
    const org = this.nameOf(p.organizerId);
    const tabDefs = [["order", "注文する", 0, RED], ["list", "注文一覧", p.orders.length, SL], ["pay", "精算", c.unpaid.length, "#A3161B"], ["chat", "チャット", p.msgs.length, "#2C1710"]];
    const ctx = { s, p, now, me, c, st, locked, org, isOrg: p.organizerId === me.id };
    return html`
      <section style="padding:18px 20px 16px;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <${Av} size=${40} bg=${this.colorOf(p.organizerId)} fs=${15}>${org.slice(0, 1)}<//>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
            <div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;font-weight:700">${org}</span><span style="font-size:12px;color:#A09284">${ago(p.createdAt, now)}</span></div>
            <span style="font-size:20px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums">${p.title}</span>
            <span style="font-size:14px;line-height:1.6;color:#3E2A20;white-space:pre-wrap;word-break:break-word">${p.body}</span>
          </div>
        </div>
        <div style="background:#F3EADF;border-radius:16px;overflow:hidden">
          <div style="padding:14px 16px 12px;display:flex;gap:12px;align-items:center">
            <span style="width:40px;height:40px;border-radius:50%;background:${st.markBg};color:#FFFFFF;font-size:17px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none">${st.mark}</span>
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
              <span style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#A0643C">${locked ? "CLOSED・受付終了" : "NOW OPEN・募集中"}</span>
              <span style="font-size:15px;font-weight:700">${st.label}</span>
            </div>
            <div style="flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px">
              <span style="font-size:10px;color:#7A6A5E">${locked ? "受付" : "締切まで"}</span>
              <span style="font-size:26px;font-family:'Archivo Black','Noto Sans JP',sans-serif;font-weight:400;color:${locked ? "#A09284" : tFg};font-variant-numeric:tabular-nums;line-height:1">${locked ? "終了" : countdown(p.deadline - now)}</span>
            </div>
          </div>
          <div style="border-top:2px dashed #D8C2AC;margin:0 14px"></div>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:12px 16px 14px;gap:6px">
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:#7A6A5E">注文締切</span><span style="font-size:17px;font-weight:700;font-variant-numeric:tabular-nums">${hm(p.deadline)}</span></div>
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:#7A6A5E">出発</span><span style="font-size:17px;font-weight:700;font-variant-numeric:tabular-nums">${hm(p.depart)}</span></div>
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:#7A6A5E">注文</span><span style="font-size:17px;font-weight:700;font-variant-numeric:tabular-nums">${p.orders.length}<span style="font-size:11px;font-weight:400;margin-left:2px">杯</span></span></div>
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:#7A6A5E">合計</span><span style="font-size:17px;font-weight:700;font-variant-numeric:tabular-nums">¥${yen(c.total)}</span></div>
          </div>
        </div>
      </section>

      <nav style="padding:0 20px 4px;position:sticky;top:60px;background:#FFFFFF;z-index:5">
        <div role="tablist" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;background:#F4EEE6;border-radius:22px;padding:4px">
          ${tabDefs.map(([k, label, n, col]) => {
            const on = s.tab === k;
            return html`<button role="tab" aria-selected=${on} onClick=${() => this.setState({ tab: k })} style="height:36px;border:none;border-radius:18px;background:${on ? "#FFFFFF" : "transparent"};cursor:pointer;font-size:13px;font-weight:700;color:${on ? "#2A1810" : "#7A6A5E"};display:flex;justify-content:center;align-items:center;gap:6px;box-shadow:${on ? "0 1px 3px rgba(0,0,0,0.08)" : "none"};transition:background 160ms ease;padding:0;white-space:nowrap">
              ${label}
              ${n > 0 ? html`<span style="min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:${col};color:#FFFFFF;font-size:10px;line-height:18px;box-sizing:border-box">${n}</span>` : null}
            </button>`;
          })}
        </div>
      </nav>
      ${s.tab === "order" ? this.orderTab(ctx) : null}
      ${s.tab === "list" ? this.listTab(ctx) : null}
      ${s.tab === "pay" ? this.payTab(ctx) : null}
      ${s.tab === "chat" ? this.chatTab(ctx) : null}`;
  }

  // ---- 4a. 注文する ----
  orderTab({ s, p, me, st, locked }) {
    const f = s.form;
    const items = s.menu[p.store] || [];
    const isOther = f.itemId === "_other";
    const it = isOther ? OTHER : items.find((i) => i.id === f.itemId) || items[0] || OTHER;
    const size = isOther ? -1 : fit(it.p, f.size);
    const temp = it.t === "both" ? f.temp : it.t;
    const otherPrice = parseInt(String(f.otherPrice).replace(/[^0-9]/g, ""), 10) || 0;
    const formPrice = isOther ? otherPrice : it.p[size];
    const ok = !!me.name && !locked && (!isOther || (f.otherName.trim() && otherPrice > 0));
    const mine = p.orders.find((o) => o.userId === me.id);
    const last = (me.last || {})[p.store];
    const lastItem = last && (last.itemId === "_other" ? OTHER : items.find((i) => i.id === last.itemId));
    const lastLabel = lastItem
      ? (last.itemId === "_other" ? last.customName + " " + last.temp : lastItem.name + " " + st.sizes[fit(lastItem.p, last.size)] + " " + last.temp) + (last.note ? "（" + last.note + "）" : "")
      : "";
    const cats = [["all", "すべて"], ...st.cats.map((x) => [x, x]), ...(st.cats.includes("その他") ? [] : [["その他", "その他"]])];
    const shown = [...items, OTHER].filter((m) => f.cat === "all" || m.g === f.cat);
    const submit = () =>
      this.act(async () => {
        if (!ok) return;
        const j = await api("/api/posts/" + p.id + "/order", {
          method: "PUT",
          body: { mode: f.mode, itemId: it.id, size, temp, note: f.note.trim(), customName: isOther ? f.otherName.trim() : "", customPrice: isOther ? otherPrice : 0 },
        });
        this.upsert(j.post);
        this.setState({ me: j.me });
        this.showToast(j.changed ? "注文を変更しました" : "注文を受け付けました");
      });
    const useLast = () =>
      last &&
      this.setForm({ itemId: lastItem ? last.itemId : "_other", size: last.size ?? 1, temp: last.temp, note: last.note || "", mode: last.mode || "ask", otherName: last.customName || "", otherPrice: last.customPrice ? String(last.customPrice) : "", cat: "all" });
    return html`
      <main data-screen-label="注文する" style="padding:18px 20px 20px;display:flex;flex-direction:column;gap:22px">
        ${locked ? html`<div style="background:#2C1710;color:#FFFFFF;padding:12px 16px;font-size:13px;font-weight:700;border-radius:12px">受付は締め切られました。精算タブから支払いをお願いします。</div>` : null}
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
          ${[["go", "一緒に行ける！", "受け取りを手伝います"], ["ask", "お願いします！", "買ってきてほしい"]].map(([k, label, sub]) => {
            const on = f.mode === k;
            return html`<button onClick=${() => this.setForm({ mode: k })} aria-pressed=${on} style="position:relative;padding:14px 12px;border-radius:14px;border:2px solid ${on ? RED : "#EAE2D8"};background:${on ? "#F3EADF" : "#FFFFFF"};cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;transition:border-color 160ms ease,background 160ms ease">
              <span style="font-size:16px;font-weight:800;color:${on ? RED : "#3E2A20"}">${label}</span>
              <span style="font-size:11px;color:#7A6A5E">${sub}</span>
            </button>`;
          })}
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <${Av} size=${32} bg=${me.color} fs=${13}>${me.name.slice(0, 1)}<//>
            <span style="flex:1;font-size:14px;font-weight:700">${me.name}さんの注文</span>
            ${mine ? html`<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:#E4F0DB;color:#3F7A3A">注文済み</span>` : null}
          </div>
          ${lastItem && !locked
            ? html`<button onClick=${useLast} class="hv-tint" style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;border:1.5px dashed #D8C2AC;background:#FFFFFF;cursor:pointer;text-align:left">
                <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:#A0643C;color:#FFFFFF;flex:none">いつもの</span>
                <span style="flex:1;min-width:0;font-size:13px;color:#3E2A20">${lastLabel}</span>
                <span style="font-size:12px;font-weight:700;color:#EF2027;flex:none">これにする</span>
              </button>`
            : null}
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
            <label style="font-size:13px;font-weight:700;color:#2C1710">メニュー<span style="font-weight:400;color:#A09284;margin-left:6px">${items.length}品</span></label>
            <a href=${st.url} target="_blank" rel="noopener" style="font-size:12px;font-weight:700;color:#EF2027;text-decoration:none;display:flex;align-items:center;gap:4px">${st.label}の公式メニュー ↗</a>
          </div>
          <div class="noscroll" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">
            ${cats.map(([k, label]) => html`<${Chip} on=${f.cat === k} onClick=${() => this.setForm({ cat: k })} h=${30} fs=${12} r=${15} pad=${12}>${label}<//>`)}
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
            ${shown.map((m) => {
              const on = m.id === it.id;
              const [tint, lid, cup] = TINT[m.c] || TINT[0];
              const first = m.p.find((x) => x != null);
              return html`<button key=${m.id} onClick=${() => this.setForm({ itemId: m.id })} aria-pressed=${on} style="position:relative;display:flex;align-items:center;gap:10px;padding:10px;border-radius:14px;border:1.5px solid ${on ? RED : "#EAE2D8"};background:${on ? "#F3EADF" : "#FFFFFF"};cursor:pointer;text-align:left;transition:border-color 160ms ease,background 160ms ease">
                <span style="width:48px;height:48px;border-radius:12px;background:${tint};flex:none;position:relative;display:block">
                  <span style="position:absolute;left:13px;top:12px;width:20px;height:3px;border-radius:2px;background:${lid}"></span>
                  <span style="position:absolute;left:15px;top:14px;width:16px;height:22px;border-radius:2px 2px 7px 7px;background:${cup}"></span>
                  <span style="position:absolute;left:15px;top:21px;width:16px;height:5px;background:#FFFFFF;opacity:0.85"></span>
                </span>
                <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
                  <span style="font-size:13px;color:#2A1810;font-weight:700;line-height:1.3">${m.name}</span>
                  <span style="font-size:11px;color:#7A6A5E;font-variant-numeric:tabular-nums">${m.id === "_other" ? "自由入力" : "¥" + yen(first) + "〜"}・${m.t === "both" ? "HOT/ICED" : m.t}</span>
                </span>
                ${on ? html`<span style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#EF2027;color:#FFFFFF;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #FFFFFF">✓</span>` : null}
              </button>`;
            })}
          </div>
        </div>

        ${isOther
          ? html`<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px;background:#F3EADF;padding:12px;border-radius:14px">
              <input class="inp" value=${f.otherName} maxlength="40" aria-label="ドリンク名" onInput=${(e) => this.setForm({ otherName: e.currentTarget.value })} placeholder="ドリンク名（季節限定など）" style="height:44px;padding:0 12px;border:1px solid #D8C2AC;border-radius:10px;font-size:14px;outline:none;min-width:0;background:#FFFFFF" />
              <input class="inp" value=${f.otherPrice} inputmode="numeric" aria-label="金額" onInput=${(e) => this.setForm({ otherPrice: e.currentTarget.value })} placeholder="金額" style="height:44px;padding:0 12px;border:1px solid #D8C2AC;border-radius:10px;font-size:14px;outline:none;min-width:0;background:#FFFFFF" />
            </div>`
          : null}

        <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px">
          <div style="display:flex;flex-direction:column;gap:8px">
            <${Label}>サイズ<//>
            <div style="display:flex;gap:6px">
              ${st.sizes.map((z, i) => {
                const can = !isOther && it.p[i] != null;
                const c = sel(i === size);
                return html`<button onClick=${() => can && this.setForm({ size: i })} disabled=${!can} aria-pressed=${i === size} style="flex:1;min-width:0;height:44px;border-radius:22px;border:1px solid ${c.bd};background:${c.bg};color:${c.fg};font-size:14px;font-weight:700;cursor:${can ? "pointer" : "not-allowed"};opacity:${can ? 1 : 0.35};padding:0">${z}</button>`;
              })}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <${Label}>温度<//>
            <div style="display:flex;gap:6px">
              ${["HOT", "ICED"].map((t) => {
                const can = it.t === "both" || it.t === t;
                const c = sel(t === temp);
                return html`<button onClick=${() => can && this.setForm({ temp: t })} disabled=${!can} aria-pressed=${t === temp} style="flex:1;min-width:0;height:44px;border-radius:22px;border:1px solid ${c.bd};background:${c.bg};color:${c.fg};font-size:13px;font-weight:700;cursor:${can ? "pointer" : "not-allowed"};opacity:${can ? 1 : 0.35};padding:0">${t}</button>`;
              })}
            </div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <label for="od-note" style="font-size:13px;font-weight:700;color:#2C1710">カスタム・メモ<span style="font-weight:400;color:#A09284;margin-left:6px">任意</span></label>
          <input id="od-note" class="inp" value=${f.note} maxlength="80" onInput=${(e) => this.setForm({ note: e.currentTarget.value })} placeholder="例：オーツミルク変更 / 氷少なめ" style="height:46px;padding:0 14px;border:1px solid #D6CCC0;border-radius:10px;font-size:14px;outline:none" />
        </div>

        <div style="display:flex;align-items:center;gap:14px;padding-top:4px">
          <div style="display:flex;flex-direction:column">
            <span style="font-size:11px;color:#A09284">お支払い額</span>
            <span style="font-size:24px;font-weight:700;font-variant-numeric:tabular-nums">¥${yen(formPrice)}</span>
          </div>
          <button onClick=${submit} disabled=${locked} class=${ok ? "hv-dim" : ""} style="flex:1;height:52px;border:none;border-radius:26px;background:${ok ? RED : "#D6CCC0"};color:#FFFFFF;font-size:15px;font-weight:700;cursor:${ok ? "pointer" : "default"}">${locked ? "受付終了" : isOther && !ok ? "ドリンク名と金額を入力" : mine ? "注文を変更する" : "注文する"}</button>
        </div>
        <div style="font-size:11px;color:#A09284;line-height:1.6">脚注：価格は${st.note}</div>
      </main>`;
  }

  // ---- 4b. 注文一覧 ----
  listTab({ p, me, c, st, locked, org, isOrg }) {
    const MD = { go: ["一緒に行く", "#EF2027", "#FFFFFF"], ask: ["お願い", "#F4EEE6", "#2C1710"] };
    const groupsMap = {};
    p.orders.forEach((o) => {
      const k = this.short(o) + (o.note ? "（" + o.note + "）" : "");
      groupsMap[k] = (groupsMap[k] || 0) + 1;
    });
    const groups = Object.entries(groupsMap).map(([label, qty]) => ({ label, qty }));
    const goers = p.orders.filter((o) => o.mode === "go").map((o) => this.nameOf(o.userId) + "さん");
    const pastDeadline = this.state.now >= p.deadline;
    const onCopy = async () => {
      const t = "【" + st.label + " 注文】受取：" + org + "（出発 " + hm(p.depart) + "）\n" + groups.map((g) => "・" + g.label + " ×" + g.qty).join("\n") + "\n計" + p.orders.length + "杯 / ¥" + yen(c.total);
      await copy(t);
      this.showToast("注文内容をコピーしました");
    };
    const toggle = () =>
      this.act(async () => {
        if (pastDeadline) return;
        const j = await api("/api/posts/" + p.id + "/close", { method: "POST", body: { closed: !p.closed } });
        this.upsert(j.post);
        this.showToast(p.closed ? "受付を再開しました" : "受付を締め切りました");
      });
    const del = (o) =>
      this.act(async () => {
        if (!confirm(this.nameOf(o.userId) + "さんの注文を削除しますか？")) return;
        const j = await api("/api/orders/" + o.id, { method: "DELETE" });
        this.upsert(j.post);
        this.showToast("注文を削除しました");
      });
    return html`
      <main data-screen-label="注文一覧" style="padding:18px 20px 20px;display:flex;flex-direction:column;gap:20px">
        ${goers.length
          ? html`<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1.5px dashed #D8C2AC;border-radius:14px">
              <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:#EF2027;color:#FFFFFF;flex:none">一緒に行く</span>
              <span style="font-size:13px;font-weight:700">${goers.join("、")}</span>
            </div>`
          : null}

        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:13px;font-weight:700;color:#2C1710">オンライン注文用まとめ</span>
            <span style="font-size:11px;color:#A09284">同じ注文は自動で集計</span>
          </div>
          <div style="background:#F4EEE6;padding:4px 16px;border-radius:14px">
            ${groups.map(
              (g) => html`<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px dashed #D6CCC0">
                <span style="flex:1;font-size:14px">${g.label}</span>
                <span style="min-width:34px;height:24px;padding:0 8px;border-radius:12px;background:#EF2027;color:#FFFFFF;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;box-sizing:border-box;font-variant-numeric:tabular-nums">×${g.qty}</span>
              </div>`
            )}
            ${p.orders.length === 0
              ? html`<div style="padding:28px 0;display:flex;flex-direction:column;align-items:center;gap:10px"><${CupEmpty} /><span style="font-size:13px;color:#A09284">まだ注文がありません</span></div>`
              : null}
          </div>
          <div style="display:grid;grid-template-columns:repeat(${isOrg ? 2 : 1},minmax(0,1fr));gap:8px">
            <button onClick=${onCopy} class="hv-panel" style="height:46px;border:1px solid #2C1710;background:#FFFFFF;color:#2C1710;border-radius:23px;font-size:14px;font-weight:700;cursor:pointer">注文内容をコピー</button>
            ${isOrg
              ? html`<button onClick=${toggle} disabled=${pastDeadline} class=${pastDeadline ? "" : "hv-dim9"} style="height:46px;border:none;background:${pastDeadline ? "#D6CCC0" : "#2C1710"};color:#FFFFFF;border-radius:23px;font-size:14px;font-weight:700;cursor:${pastDeadline ? "default" : "pointer"}">${pastDeadline ? "受付終了" : p.closed ? "受付を再開" : "受付を締め切る"}</button>`
              : null}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <span style="font-size:13px;font-weight:700;color:#2C1710">個別の注文（受け取り時の確認用）</span>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${p.orders.map((o) => {
              const [mdLabel, mdBg, mdFg] = MD[o.mode] || MD.ask;
              const name = this.nameOf(o.userId);
              const canDel = isOrg || (o.userId === me.id && !locked);
              return html`<div key=${o.id} style="display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;border:1px solid #EAE2D8;border-radius:14px">
                <span style="width:38px;height:38px;border-radius:50%;background:#F3EADF;color:#EF2027;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">${name.slice(0, 1)}</span>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
                  <span style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;font-weight:700">${name}</span><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:9px;background:${mdBg};color:${mdFg}">${mdLabel}</span></span>
                  <span style="font-size:12px;color:#7A6A5E">${this.short(o)}</span>
                  ${o.note ? html`<span style="font-size:12px;color:#A0643C">${o.note}</span>` : null}
                </div>
                <span style="font-size:14px;font-variant-numeric:tabular-nums">¥${yen(o.price)}</span>
                ${canDel
                  ? html`<button onClick=${() => del(o)} aria-label="削除" class="hv-del" style="width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:#B5A897;font-size:18px;cursor:pointer;flex:none">×</button>`
                  : html`<span style="width:32px;flex:none"></span>`}
              </div>`;
            })}
          </div>
        </div>
      </main>`;
  }

  // ---- 4c. 精算 ----
  payTab({ p, me, c, org, isOrg }) {
    const ST = { unpaid: ["未払い", "#FBE6E4", "#A3161B"], reported: ["報告あり", "#EAE2D8", SL], done: ["確認済み", "#E4F0DB", "#3F7A3A"] };
    const list = p.orders;
    const paid = list.filter((o) => o.status === "done").reduce((a, o) => a + o.price, 0);
    const allPaid = list.length > 0 && c.unpaid.length === 0 && c.reported.length === 0;
    const setStatus = (o, status, msg) =>
      this.act(async () => {
        const j = await api("/api/orders/" + o.id + "/status", { method: "POST", body: { status } });
        this.upsert(j.post);
        if (msg) this.showToast(msg);
      });
    const remind = () =>
      this.act(async () => {
        if (!c.unpaid.length) return;
        const t = "☕ COFFEE RUN｜" + p.title + " 精算のお願い（PayPay：" + org + " / ID " + p.paypayId + "）\n" + c.unpaid.map((o) => this.nameOf(o.userId) + "さん ¥" + yen(o.price)).join("\n");
        await copy(t);
        await api("/api/posts/" + p.id + "/remind", { method: "POST" }).catch((e) => {
          if (e.code !== "too_many") throw e;
        });
        this.showToast("リマインド文をコピーしました");
      });
    return html`
      <main data-screen-label="精算" style="padding:18px 20px 20px;display:flex;flex-direction:column;gap:20px">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:13px;font-weight:700;color:#2C1710">回収状況</span>
            <span style="font-size:13px;font-variant-numeric:tabular-nums"><span style="font-size:22px;font-weight:700">¥${yen(paid)}</span><span style="color:#A09284"> / ¥${yen(c.total)}</span></span>
          </div>
          <div style="height:10px;background:#EAE2D8;border-radius:5px;overflow:hidden"><div style="height:100%;width:${c.total ? Math.round((paid / c.total) * 100) : 0}%;background:#EF2027;border-radius:5px;transition:width 300ms ease"></div></div>
          <div style="display:flex;gap:16px;font-size:12px;color:#7A6A5E">
            <span>確認済み ${list.length - c.unpaid.length - c.reported.length}</span><span>報告あり ${c.reported.length}</span><span style="color:#A3161B;font-weight:700">未払い ${c.unpaid.length}</span>
          </div>
        </div>

        ${allPaid
          ? html`<div style="background:#E4F0DB;border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:12px">
              <span style="width:32px;height:32px;border-radius:50%;background:#3F7A3A;color:#FFFFFF;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">✓</span>
              <span style="font-size:14px;font-weight:700;color:#3F7A3A">全員の支払いが完了しました</span>
            </div>`
          : null}

        <div style="background:#F3EADF;padding:14px 16px;border-radius:14px;display:flex;flex-direction:column;gap:4px">
          <span style="font-size:11px;color:#7A6A5E">PayPay送金先（投稿者）</span>
          <span style="display:flex;align-items:center;gap:8px"><span style="flex:1;min-width:0;font-size:15px;font-weight:700;word-break:break-all">${org}　<span style="font-weight:400;color:#2C1710">ID: ${p.paypayId}</span></span><button onClick=${async () => {
            await copy(p.paypayId);
            this.showToast("ID「" + p.paypayId + "」をコピーしました");
          }} style="height:30px;padding:0 12px;border-radius:15px;border:1px solid #D8C2AC;background:#FFFFFF;color:#7A6A5E;font-size:12px;font-weight:700;cursor:pointer;flex:none">IDをコピー</button></span>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          ${list.map((o) => {
            const [stLabel, stBg, stFg] = ST[o.status];
            const name = this.nameOf(o.userId);
            return html`<div key=${o.id} style="display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;border:1px solid #EAE2D8;border-radius:14px">
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
                <span style="display:flex;align-items:center;gap:8px"><span style="font-size:14px;font-weight:700">${name}</span><span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;background:${stBg};color:${stFg}">${stLabel}</span></span>
                <span style="font-size:12px;color:#7A6A5E">${this.short(o)}・¥${yen(o.price)}</span>
              </div>
              ${o.status === "unpaid" && o.userId === me.id
                ? html`<button onClick=${() => this.setState({ sheetId: o.id, sheetOpened: false })} class="hv-red" style="height:40px;padding:0 16px;border:none;border-radius:20px;background:#EF2027;color:#FFFFFF;font-size:13px;font-weight:700;cursor:pointer;flex:none">PayPayで払う</button>`
                : null}
              ${o.status === "reported" && isOrg
                ? html`<button onClick=${() => setStatus(o, "done", name + "さんの入金を確認しました")} class="hv-panel" style="height:40px;padding:0 16px;border:1px solid #2C1710;border-radius:20px;background:#FFFFFF;color:#2C1710;font-size:13px;font-weight:700;cursor:pointer;flex:none">入金を確認</button>`
                : null}
              ${o.status === "done" && isOrg && o.userId !== me.id
                ? html`<button onClick=${() => setStatus(o, "unpaid")} style="height:40px;padding:0 10px;border:none;background:transparent;color:#A09284;font-size:12px;cursor:pointer;flex:none">取り消す</button>`
                : null}
            </div>`;
          })}
          ${list.length === 0 ? html`<div style="padding:20px 0;text-align:center;font-size:13px;color:#A09284">まだ注文がありません</div>` : null}
        </div>

        ${isOrg
          ? html`<button onClick=${remind} class=${c.unpaid.length ? "hv-dim" : ""} style="height:50px;border:none;border-radius:25px;background:${c.unpaid.length ? SL : "#D6CCC0"};color:#FFFFFF;font-size:14px;font-weight:700;cursor:${c.unpaid.length ? "pointer" : "default"}">${c.unpaid.length ? "未払い" + c.unpaid.length + "名にリマインド" : "未払いの人はいません"}</button>
              <div style="font-size:11px;color:#A09284;line-height:1.6">脚注：リマインド文はクリップボードにコピーされます。Slack・Teams等に貼り付けて送信してください。通知をオンにしている人には、プッシュ通知も届きます。</div>`
          : null}
      </main>`;
  }

  // ---- PayPay ボトムシート ----
  sheetView(v) {
    const s = v.s, p = v.p;
    const o = p.orders.find((x) => x.id === s.sheetId);
    const org = this.nameOf(p.organizerId);
    const close = () => this.setState({ sheetId: null });
    // ① 送り先の ID をコピーして PayPay を開く。PayPay の「送る」→ ID 検索に貼り付ければよい。
    //    金額は短いので画面を見て入力（下の「金額をコピー」でもコピーできる）
    const openPayPay = async () => {
      await copy(p.paypayId);
      this.setState({ sheetOpened: true });
      this.showToast("ID「" + p.paypayId + "」をコピー → PayPayの「送る」で貼り付けて ¥" + yen(o.price));
      // PayPay アプリを開く（スマホのみ。インストールされていないと開けない）
      if (isMobile()) setTimeout(() => (location.href = "paypay://"), 900);
    };
    const copyPrice = async () => {
      await copy(String(o.price));
      this.showToast("¥" + yen(o.price) + " をコピーしました");
    };
    const report = () =>
      this.act(async () => {
        if (!s.sheetOpened) return;
        const j = await api("/api/orders/" + o.id + "/status", { method: "POST", body: { status: "reported" } });
        this.upsert(j.post);
        this.setState({ sheetId: null });
        this.showToast("送金を報告しました");
      });
    const rb = s.sheetOpened ? RED : "#D6CCC0";
    const rf = s.sheetOpened ? RED : "#A09284";
    return html`
      <div onClick=${close} style="position:fixed;inset:0;background:rgba(26,26,26,0.45);z-index:20;display:flex;align-items:flex-end;justify-content:center">
        <div onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="PayPayで支払う" style="width:100%;max-width:480px;background:#FFFFFF;border-radius:22px 22px 0 0;padding:12px 20px calc(28px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:16px;box-sizing:border-box">
          <div style="width:40px;height:4px;border-radius:2px;background:#EAE2D8;align-self:center"></div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:17px;font-weight:700">PayPayで支払う</span>
            <button onClick=${close} aria-label="閉じる" style="width:36px;height:36px;border:none;border-radius:50%;background:#F4EEE6;font-size:18px;color:#7A6A5E;cursor:pointer">×</button>
          </div>
          <div style="background:#F3EADF;border-radius:16px;padding:20px 16px 18px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px">
            <${CupRed} />
            <span style="font-size:12px;color:#7A6A5E">${this.nameOf(o.userId)}さん → ${org}さん</span>
            <span style="font-size:40px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.01em;line-height:1.1">¥${yen(o.price)}</span>
            <span style="font-size:12px;color:#7A6A5E">${this.short(o)}</span>
            <button onClick=${copyPrice} style="margin-top:4px;height:30px;padding:0 12px;border-radius:15px;border:1px solid #D8C2AC;background:#FFFFFF;color:#7A6A5E;font-size:12px;font-weight:700;cursor:pointer">金額をコピー</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button onClick=${openPayPay} class="hv-red" style="height:54px;border:none;border-radius:27px;background:#EF2027;color:#FFFFFF;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px"><span style="width:22px;height:22px;border-radius:50%;background:#FFFFFF;color:#EF2027;font-size:12px;line-height:22px">1</span>IDをコピーしてPayPayを開く</button>
            <button onClick=${report} aria-disabled=${!s.sheetOpened} style="height:54px;border:1.5px solid ${rb};border-radius:27px;background:#FFFFFF;color:${rf};font-size:15px;font-weight:700;cursor:${s.sheetOpened ? "pointer" : "default"};display:flex;align-items:center;justify-content:center;gap:10px"><span style="width:22px;height:22px;border-radius:50%;background:${rb};color:#FFFFFF;font-size:12px;line-height:22px">2</span>送金しました（報告する）</button>
          </div>
          <div style="font-size:11px;color:#A09284;line-height:1.6;text-align:center">送り先ID：${p.paypayId}　報告後、${org}さんの確認で「確認済み」になります。</div>
        </div>
      </div>`;
  }

  // ---- 4d. チャット ----
  chatTab({ s, p, me }) {
    const msgs = p.msgs.map((m, i, arr) => {
      const mine = m.userId === me.id;
      const prev = arr[i - 1];
      const cont = prev && prev.userId === m.userId;
      return { ...m, mine, showAv: !mine && !cont, name: this.nameOf(m.userId) };
    });
    const hasText = !!s.chatText.trim();
    return html`
      <main data-screen-label="チャット" style="padding:18px 20px 0;display:flex;flex-direction:column;gap:14px;flex:1">
        <div style="display:flex;flex-direction:column;gap:12px">
          ${msgs.map(
            (m) => html`<div key=${m.id} style="display:flex;gap:8px;align-items:flex-end;flex-direction:${m.mine ? "row-reverse" : "row"}">
              ${m.showAv ? html`<${Av} size=${30} bg=${this.colorOf(m.userId)} fs=${12}>${m.name.slice(0, 1)}<//>` : !m.mine ? html`<span style="width:30px;flex:none"></span>` : null}
              <div style="display:flex;flex-direction:column;gap:3px;max-width:75%;align-items:${m.mine ? "flex-end" : "flex-start"}">
                ${m.showAv ? html`<span style="font-size:11px;color:#7A6A5E">${m.name}</span>` : null}
                <span style="padding:10px 14px;border-radius:${m.mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px"};background:${m.mine ? "#EF2027" : "#F4EEE6"};color:${m.mine ? "#FFFFFF" : "#2A1810"};font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word">${m.text}</span>
                <span style="font-size:10px;color:#A09284;font-variant-numeric:tabular-nums">${hm(m.ts)}</span>
              </div>
            </div>`
          )}
          ${msgs.length === 0
            ? html`<div style="padding:36px 0;text-align:center;font-size:13px;color:#A09284;line-height:1.7">まだメッセージはありません。<br />集合場所や追加の注文はここで相談しよう</div>`
            : null}
        </div>
        <div style="position:sticky;bottom:0;background:#FFFFFF;padding:10px 0 calc(16px + env(safe-area-inset-bottom));margin-top:auto;display:flex;flex-direction:column;gap:8px;border-top:1px solid #F4EEE6">
          <div class="noscroll" style="display:flex;gap:6px;overflow-x:auto">
            ${QUICK.map((q) => html`<button onClick=${() => this.sendMsg(q)} class="hv-quick" style="height:30px;padding:0 12px;border-radius:15px;border:1px solid #D6CCC0;background:#FFFFFF;color:#3E2A20;font-size:12px;cursor:pointer;flex:none">${q}</button>`)}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="inp" value=${s.chatText} maxlength="500" aria-label="メッセージ" enterkeyhint="send" onInput=${(e) => this.setState({ chatText: e.currentTarget.value })} onKeyDown=${(e) => {
              if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                this.sendMsg(s.chatText);
              }
            }} placeholder="メッセージを入力" style="flex:1;min-width:0;height:44px;padding:0 16px;border:1px solid #D6CCC0;border-radius:22px;font-size:14px;outline:none;background:#FBF7F2" />
            <button onClick=${() => this.sendMsg(s.chatText)} aria-label="送信" style="width:44px;height:44px;border-radius:50%;border:none;background:${hasText ? "#EF2027" : "#D6CCC0"};color:#FFFFFF;font-size:18px;font-weight:700;cursor:pointer;flex:none">↑</button>
          </div>
        </div>
      </main>`;
  }
}

render(html`<${App} />`, document.getElementById("app"));
