// サーバーのルール（誰が何をできるか）と、プッシュ通知（新しい投稿・締切5分前）を確かめる
//   npx wrangler dev   を起動してから   node test/api.mjs [http://127.0.0.1:8787]
//   .dev.vars に ADMIN_TOKEN=... があれば、メニュー管理も確かめる
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { b64u } from "../src/push.js";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const ADMIN = (() => {
  try {
    return (readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_TOKEN=(.+)$/m) || [])[1];
  } catch {
    return null;
  }
})();
const MIN = 60e3;

function client() {
  let cookie = "";
  const call = async (path, { method = "GET", body, raw, headers = {} } = {}) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  };
  // JSON ではない返事（写真など）をそのまま受け取る
  call.raw = (path) => fetch(BASE + path, { headers: cookie ? { cookie } : {} });
  return call;
}
const step = (t) => console.log("・" + t);
const sfx = Date.now().toString(36).slice(-4);

// ---- プッシュを受け取るだけのサーバー ----
const got = [];
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    got.push({ path: req.url, auth: req.headers.authorization || "", enc: req.headers["content-encoding"], size: Buffer.concat(chunks).length });
    res.writeHead(201).end();
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const fakeSub = async (name) => {
  const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { endpoint: `http://127.0.0.1:${port}/${name}`, keys: { p256dh: b64u(await crypto.subtle.exportKey("raw", k.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
};

const org = client(), mem = client(), other = client();
step("登録・未ログイン");
assert.equal((await org("/api/me")).status, 401);
assert.equal((await org("/api/signup", { method: "POST", body: { name: "" } })).status, 400);
const o = await org("/api/signup", { method: "POST", body: { name: "幹事" + sfx, paypayId: "kanji-kc", color: "#2C1710" } });
assert.equal(o.status, 200);
assert.equal(o.me.color, "#2C1710");
const m = await mem("/api/signup", { method: "POST", body: { name: "メンバー" + sfx, color: "javascript:alert(1)" } });
assert.equal(m.me.color, "#EF2027", "知らない色は既定の赤になる");
await other("/api/signup", { method: "POST", body: { name: "ほか" + sfx, paypayId: "hoka" } });

step("アイコンの写真");
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
assert.equal((await mem("/api/me/photo", { method: "POST", raw: new TextEncoder().encode("<svg onload=alert(1)>"), headers: { "content-type": "image/jpeg" } })).error, "photo_type", "画像でないものは保存しない");
assert.equal((await mem("/api/me/photo", { method: "POST", raw: jpeg, headers: { "content-type": "image/png" } })).error, "photo_type", "中身と種類が合わないものも保存しない");
assert.equal((await mem("/api/me/photo", { method: "POST", raw: new Uint8Array(400 * 1024).fill(0xff), headers: { "content-type": "image/jpeg" } })).error, "photo_size");
let pr = await mem("/api/me/photo", { method: "POST", raw: jpeg, headers: { "content-type": "image/jpeg" } });
assert.ok(pr.me.photo > 0);
const photoPath = "/api/photo/" + m.me.id;
assert.equal((await fetch(BASE + photoPath)).status, 401, "ログインしていない人には見せない");
const got1 = await org.raw(photoPath);
assert.equal(got1.headers.get("content-type"), "image/jpeg");
assert.equal(got1.headers.get("x-content-type-options"), "nosniff");
assert.equal((await org("/api/boot")).profiles[m.me.id].photo, pr.me.photo, "ほかの人にも写真の版が届く");
pr = await mem("/api/me/photo", { method: "DELETE" });
assert.equal(pr.me.photo, 0);
assert.equal((await org.raw(photoPath)).status, 404);

step("プッシュの購読");
assert.equal((await mem("/api/push/subscribe", { method: "POST", body: { endpoint: "https://evil.example.com/x", keys: { p256dh: "a", auth: "b" } } })).status, 400);
assert.equal((await mem("/api/push/subscribe", { method: "POST", body: await fakeSub("mem") })).status, 200);
assert.equal((await org("/api/push/subscribe", { method: "POST", body: await fakeSub("org") })).status, 200);

step("投稿（PayPay ID が必要・締切は未来）");
const now = Date.now();
const dl = Math.ceil((now + 4 * MIN + 30e3) / MIN) * MIN; // 締切まで5分未満 → すぐに「5分前」が届く
assert.equal((await mem("/api/posts", { method: "POST", body: { title: "x", store: "sbux", deadline: dl, depart: dl } })).error, "paypay_required");
assert.equal((await org("/api/posts", { method: "POST", body: { title: "x", store: "sbux", deadline: now - MIN, depart: now } })).error, "deadline");
assert.equal((await org("/api/posts", { method: "POST", body: { title: "x", store: "doutor", deadline: dl, depart: dl } })).error, "store");
const created = await org("/api/posts", { method: "POST", body: { title: "10/1（木）", body: "", store: "mammoth", deadline: dl, depart: dl + 10 * MIN } });
assert.equal(created.status, 200);
const post = created.post;
assert.equal(post.body, "マンモスコーヒー行きますが皆さんいけますか？", "本文が空なら定型文");
assert.equal(post.paypayId, "kanji-kc");

step("注文（金額はサーバーがメニューから決める）");
let r = await mem(`/api/posts/${post.id}/order`, { method: "PUT", body: { itemId: "honey", size: 2, temp: "ICED", mode: "go", note: "氷少なめ", price: 1 } });
assert.equal(r.status, 200);
let mine = r.post.orders.find((x) => x.userId === m.me.id);
assert.deepEqual([mine.name, mine.sizeLabel, mine.temp, mine.price, mine.status, mine.mode], ["ハニーラテ", "M", "ICED", 430, "unpaid", "go"], "L が無いので M に寄せる");
assert.equal(r.me.last.mammoth.itemId, "honey", "いつもの");
r = await mem(`/api/posts/${post.id}/order`, { method: "PUT", body: { itemId: "snow", size: 0, temp: "HOT" } });
mine = r.post.orders.find((x) => x.userId === m.me.id);
assert.equal(r.post.orders.length, 1, "1人1注文（上書き）");
assert.deepEqual([mine.temp, mine.price], ["ICED", 380], "ICED のみの品は ICED");
assert.equal((await mem(`/api/posts/${post.id}/order`, { method: "PUT", body: { itemId: "nope" } })).error, "item");
assert.equal((await other(`/api/posts/${post.id}/order`, { method: "PUT", body: { itemId: "_other", customName: "季節のラテ", customPrice: "¥ 650" } })).status, 200);
r = await org(`/api/posts/${post.id}/order`, { method: "PUT", body: { itemId: "americano", size: 1 } });
assert.equal(r.post.orders.find((x) => x.userId === o.me.id).status, "done", "投稿者の分は確認済み");
const otherOrder = r.post.orders.find((x) => x.name === "季節のラテ");
assert.equal(otherOrder.price, 650);

step("締切・再開は投稿者だけ");
assert.equal((await mem(`/api/posts/${post.id}/close`, { method: "POST", body: { closed: true } })).status, 403);
assert.equal((await org(`/api/posts/${post.id}/close`, { method: "POST", body: { closed: true } })).post.closed, true);
assert.equal((await mem(`/api/posts/${post.id}/order`, { method: "PUT", body: { itemId: "latte" } })).error, "closed");

step("支払いの状態（unpaid → reported → done、done → unpaid は投稿者だけ）");
assert.equal((await other(`/api/orders/${mine.id}/status`, { method: "POST", body: { status: "reported" } })).status, 403, "他人の分は報告できない");
assert.equal((await mem(`/api/orders/${mine.id}/status`, { method: "POST", body: { status: "done" } })).status, 403, "自分で確認済みにはできない");
assert.equal((await mem(`/api/orders/${mine.id}/status`, { method: "POST", body: { status: "reported" } })).status, 200);
assert.equal((await mem(`/api/orders/${mine.id}/status`, { method: "POST", body: { status: "done" } })).status, 403);
assert.equal((await org(`/api/orders/${mine.id}/status`, { method: "POST", body: { status: "done" } })).status, 200);
assert.equal((await mem(`/api/orders/${mine.id}/status`, { method: "POST", body: { status: "unpaid" } })).status, 403);
assert.equal((await org(`/api/orders/${mine.id}/status`, { method: "POST", body: { status: "unpaid" } })).status, 200);
assert.equal((await mem(`/api/orders/${mine.id}`, { method: "DELETE" })).status, 403, "締切後は本人も消せない");
assert.equal((await other(`/api/posts/${post.id}/remind`, { method: "POST" })).status, 403);
assert.equal((await org(`/api/posts/${post.id}/remind`, { method: "POST" })).sent, 2);

step("チャット");
assert.equal((await mem(`/api/posts/${post.id}/messages`, { method: "POST", body: { text: "  " } })).status, 400);
r = await mem(`/api/posts/${post.id}/messages`, { method: "POST", body: { text: "着きました" } });
assert.equal(r.post.msgs.at(-1).text, "着きました");

step("アカウントの集計");
const me = await mem("/api/me");
assert.deepEqual(me.me.stats, { count: 1, due: 380 });

step("再開（締切前なら）と、締切5分前の通知");
assert.equal((await org(`/api/posts/${post.id}/close`, { method: "POST", body: { closed: false } })).post.closed, false);
const t0 = Date.now();
const count = (path) => got.filter((g) => g.path === path).length;
while (Date.now() - t0 < 15000 && (count("/mem") < 3 || count("/org") < 1)) await new Promise((r) => setTimeout(r, 300));
// 新しい投稿 → 投稿者以外（mem）。締切5分前 → 全員（org と mem）。リマインド → 未払いの mem
const toMem = count("/mem");
const toOrg = count("/org");
assert.ok(toMem >= 3, "mem に 新規投稿・リマインド・5分前 が届く（" + toMem + "）");
assert.ok(toOrg >= 1, "org に 5分前 が届く（" + toOrg + "）");
assert.ok(got.every((g) => g.enc === "aes128gcm" && g.auth.startsWith("vapid t=")), "暗号化と VAPID 署名つき");

if (ADMIN) {
  step("メニュー管理");
  assert.equal((await org("/api/admin/menu")).status, 401);
  const H = { authorization: "Bearer " + ADMIN };
  const cur = await org("/api/admin/menu", { headers: H });
  assert.equal(cur.menu.mammoth.length, 17);
  const items = cur.menu.mammoth.map((x) => (x.id === "americano" ? { ...x, p: [200, 260, 410] } : x));
  r = await org("/api/admin/menu", { method: "PUT", body: { store: "mammoth", items }, headers: H });
  assert.equal(r.menu.mammoth.find((x) => x.id === "americano").p[0], 200);
  assert.equal((await org("/api/admin/menu", { method: "PUT", body: { store: "mammoth", items: [{ id: "x", g: "a", name: "b", p: [null, null, null] }] }, headers: H })).error, "menu_price");
  const boot = await org("/api/boot");
  assert.equal(boot.posts.find((p) => p.id === post.id).orders.find((x) => x.userId === o.me.id).price, 250, "注文済みの金額は変わらない");
  // 元に戻す
  await org("/api/admin/menu", { method: "PUT", body: { store: "mammoth", items: cur.menu.mammoth }, headers: H });
}

step("投稿の削除は投稿者だけ（注文・チャットも消える）");
assert.equal((await mem(`/api/posts/${post.id}`, { method: "DELETE" })).status, 403);
assert.equal((await org(`/api/posts/${post.id}`, { method: "DELETE" })).ok, true);
assert.equal((await org("/api/boot")).posts.some((p) => p.id === post.id), false);
assert.equal((await mem(`/api/posts/${post.id}/messages`, { method: "POST", body: { text: "x" } })).status, 404);
assert.deepEqual((await mem("/api/me")).me.stats, { count: 0, due: 0 }, "消した投稿の注文は集計に残らない");

srv.close();
console.log("OK");
