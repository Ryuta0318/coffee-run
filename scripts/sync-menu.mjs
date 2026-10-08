// メニューを公式とすり合わせる（スターバックス・マンモスコーヒー）
//   node scripts/sync-menu.mjs           … 公式との違いを表示（何も書き換えない）
//   node scripts/sync-menu.mjs --write   … 違いがあれば src/menu-data.js を書き換え、MENU_VERSION を上げる
//
// 取り込み元（どちらも公式サイトが表示に使っているデータ）
//   スターバックス：menu.starbucks.co.jp のメニュー一覧 API と各商品ページ（サイズ別の価格・HOT/ICED）
//     レギュラー … 全店で買える・サイズ違いの価格がある（「¥460〜」の〜つき）
//     季節限定   … 全店で買える・〜がつかない（新作・期間限定）→「季節限定」カテゴリに入れる
//     一部店舗限定（リザーブ・ロースタリー・地域限定）とキッズ・量り売りは入れない
//   マンモスコーヒー：mmth.co.jp/menu が読み込んでいる CMS（STUDIO）のメニュー
//     名前が「(NEW…)」で始まるものは季節限定
// 終了した商品はメニューから消える（過去の注文はそのまま残る）。商品の id は変えない（いつもの・過去の注文のため）
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { MENU, MENU_VERSION } from "../src/menu-data.js";

const WRITE = process.argv.includes("--write");
const DATA_FILE = new URL("../src/menu-data.js", import.meta.url);

// ---- 通信（fetch が使えない環境では curl） ----
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (coffee-run menu sync)" } });
      if (r.ok) return await r.text();
    } catch {
      try {
        return execFileSync("curl", ["-sS", "-f", "-L", "-m", "40", "-A", "Mozilla/5.0", url], { encoding: "utf8", maxBuffer: 30e6 });
      } catch {}
    }
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
  }
  throw new Error("取得できませんでした: " + url);
}
const norm = (s) =>
  String(s)
    .replace(/[®™​]/g, "")
    .replace(/[(（]/g, "（").replace(/[)）]/g, "）")
    .replace(/＆/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const lines = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&yen;|&#165;/g, "¥").replace(/&nbsp;/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean);
// アイコンの色: 0 coffee / 1 milk / 2 tea / 3 sweet
const tone = (name) =>
  /抹茶|ティー|ソーダ|レモン|ゆず|ハーブ|ミント|ハイビスカス|ウーロン|カモミール|ユースベリー|マンゴー|ピーチ/.test(name) ? 2
  : /チョコ|モカ|キャラメル|バニラ|フラッペ|フラペチーノ|ストロベリー|バナナ|ダルゴナ|スノー|蜜|パンプキン|ハニー|ココア|スイート|甘/.test(name) ? 3
  : /ラテ|ミルク|オーツ|カプチーノ|ミスト/.test(name) ? 1
  : 0;

// ---- スターバックス ----
const SB_CATS = { drip: "コーヒー", espresso: "エスプレッソ", frappuccino: "フラペチーノ", tea: "ティー", "beverage-others": "その他" };
const SB_SKIP = [/ポットサービス/, /コーヒートラベラー/, /コーヒー プレス/, /^キッズ/, /kids/i, /^エスプレッソ$/];
async function starbucks() {
  const out = [];
  for (const [code, g] of Object.entries(SB_CATS)) {
    const list = JSON.parse(await get(`https://menu.starbucks.co.jp/api/v1/list?category_code=${code}&limit=100`)).item;
    for (const it of list) {
      const name = norm(it.item_name).replace(/ フラペチーノ$/, " フラペチーノ");
      if (it.certain_stores || SB_SKIP.some((re) => re.test(name))) continue;
      const L = lines(await get("https://menu.starbucks.co.jp/" + it.item_code));
      const k = Math.max(0, L.indexOf("お気に入り一覧を見る"));
      const seg = L.slice(k, k + 16);
      const tl = seg.find((l) => /^(ホット|アイス)( \/ (ホット|アイス))?$/.test(l)) || "アイス";
      const p = ["Short", "Tall", "Grande", "Venti"].map((sz) => {
        for (let i = 0; i < seg.length; i++) {
          const m = seg[i].match(new RegExp("^" + sz + "®?\\s*¥([\\d,]+)"));
          if (m) return Number(m[1].replace(/,/g, ""));
          if (seg[i].replace("®", "") === sz) {
            const m2 = (seg[i + 1] || "").match(/^¥([\d,]+)/);
            if (m2) return Number(m2[1].replace(/,/g, ""));
          }
        }
        return null;
      });
      if (p.every((v) => v == null)) p[1] = it.price_in_vat_min; // サイズの表示がない商品は Tall の位置に
      const t = tl.includes("ホット") && tl.includes("アイス") ? "both" : tl.includes("ホット") ? "HOT" : "ICED";
      out.push({ key: "s_" + it.item_code.slice(-6), g: it.price_starts_from ? g : "季節限定", name, p, t });
    }
  }
  return out;
}

// ---- マンモスコーヒー ----
const MM_SHOWN = 50; // mmth.co.jp/menu に表示される件数
const MM_CATS = { COFFEE: "コーヒー", "DECAF ESPRESSO": "ディカフェ", OTHERS: "ノンコーヒー", "FRAPPE・SMOOTHIE": "フラッペ・スムージー", "TEA & SODA": "ティー・ソーダ" };
async function mammoth() {
  // 公式ページと同じ問い合わせ（並び順どおり51件を取り、画面に出るのは先頭の50件）。それより後ろはページに出ないので入れない
  const q = Buffer.from(JSON.stringify({ uid: String(Date.now()), project_id: "cCxNQZHPBaqX6xKN3r1f", schema_key: "JZ0iKANt", orders: "order", offset: 0, limit: 51 })).toString("base64url");
  const docs = JSON.parse(await get("https://api.cms.studiodesignapp.com/v2/search?q=" + q)).slice(0, MM_SHOWN);
  const out = [];
  for (const d of docs) {
    const f = d.document.fields.default.mapValue.fields;
    const v = (k) => (f[k] && f[k].stringValue) || "";
    const raw = norm(v("title"));
    if (!raw) continue;
    const isNew = /^（NEW/i.test(raw);
    const name = raw.replace(/^（NEW[^）]*）\s*/i, "");
    const temp = v("A9FOWh54");
    const t = temp.includes("ホット") && temp.includes("アイス") ? "both" : temp.includes("ホット") ? "HOT" : "ICED";
    const price = v("sjEwGLVq");
    const p = ["S", "M", "L"].map((sz) => {
      const m = price.match(new RegExp(sz + "\\+?\\s*[:：]\\s*¥\\s*([\\d,]+)"));
      return m ? Number(m[1].replace(/,/g, "")) : null;
    });
    if (p.every((x) => x == null)) continue;
    const cat = v("ChGOCMs9").trim().toUpperCase();
    let g = isNew ? "季節限定" : MM_CATS[cat] || "ノンコーヒー";
    if (!isNew && /^(デ|ディ)カフェ/.test(name)) g = "ディカフェ";
    out.push({ key: "m_" + (v("slug") || d.document.name).slice(0, 12), g, name, p, t });
  }
  return out;
}

// ---- まとめる ----
function merge(store, cur, off, order) {
  const used = new Set();
  const items = off.map((o) => {
    const old = cur.find((x) => norm(x.name) === o.name && !used.has(x.id)) || cur.find((x) => x.id === o.key && !used.has(x.id));
    const id = old ? old.id : o.key.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
    used.add(id);
    return { id, g: o.g, name: o.name, p: o.p, t: o.t, c: old ? old.c : tone(o.name) };
  });
  items.sort((a, b) => order.indexOf(a.g) - order.indexOf(b.g));
  const cats = order.filter((g) => items.some((x) => x.g === g));
  const added = items.filter((x) => !cur.some((c) => c.id === x.id));
  const gone = cur.filter((c) => !items.some((x) => x.id === c.id));
  const changed = items.filter((x) => {
    const c = cur.find((y) => y.id === x.id);
    return c && (JSON.stringify(c.p) !== JSON.stringify(x.p) || c.t !== x.t || c.g !== x.g || c.name !== x.name);
  });
  return { store, items, cats, added, gone, changed, cur };
}
const fmt = (x) => `${x.g}｜${x.name} [${x.p.map((v) => (v == null ? "-" : v)).join("/")}] ${x.t}`;

const [sb, mm] = await Promise.all([starbucks(), mammoth()]);
// 取り込みが壊れていそうなとき（件数が極端に少ない）は書き換えない
if (sb.length < 20 || mm.length < 15) {
  console.error(`取り込んだ件数が少なすぎます（スタバ ${sb.length} / マンモス ${mm.length}）。サイトの作りが変わった可能性があるので、書き換えません。`);
  process.exit(2);
}
const results = [
  merge("sbux", MENU.sbux, sb, ["季節限定", "コーヒー", "エスプレッソ", "フラペチーノ", "ティー", "その他"]),
  merge("mammoth", MENU.mammoth, mm, ["季節限定", "コーヒー", "ディカフェ", "ノンコーヒー", "フラッペ・スムージー", "ティー・ソーダ"]),
];
let diff = 0;
for (const r of results) {
  const label = r.store === "sbux" ? "スターバックス" : "マンモスコーヒー";
  console.log(`\n=== ${label}：公式 ${r.items.length}品（いまのアプリ ${r.cur.length}品）`);
  r.added.forEach((x) => console.log("  + 追加 " + fmt(x)));
  r.gone.forEach((x) => console.log("  - 終了 " + fmt(x)));
  r.changed.forEach((x) => {
    const c = r.cur.find((y) => y.id === x.id);
    console.log("  * 変更 " + fmt(c) + "  →  " + fmt(x));
  });
  const n = r.added.length + r.gone.length + r.changed.length;
  if (!n) console.log("  違いはありません ✓");
  diff += n;
}
if (!WRITE) process.exit(0);
if (!diff) {
  console.log("\n書き換えるものはありません");
  process.exit(0);
}
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const js = (items) => items.map((x) => `    { id: ${JSON.stringify(x.id)}, g: ${JSON.stringify(x.g)}, name: ${JSON.stringify(x.name)}, p: [${x.p.map((v) => (v == null ? "null" : v)).join(", ")}], t: ${JSON.stringify(x.t)}, c: ${x.c} },`).join("\n");
const out = `// このファイルは scripts/sync-menu.mjs が公式サイトから作っています（手で直したら、次の同期で上書きされます）
// 最終同期: ${today}（日本時間）
//   p: サイズ順の価格。提供なしは null（sbux: S,T,G,V / mammoth: S,M,L）  t: 'both' | 'HOT' | 'ICED'
//   c: アイコン色 0 coffee / 1 milk / 2 tea / 3 sweet

export const MENU_VERSION = ${MENU_VERSION + 1};
export const MENU_SYNCED = ${JSON.stringify(today)};

export const CATS = {
  sbux: ${JSON.stringify(results[0].cats)},
  mammoth: ${JSON.stringify(results[1].cats)},
};

export const MENU = {
  sbux: [
${js(results[0].items)}
  ],
  mammoth: [
${js(results[1].items)}
  ],
};
`;
writeFileSync(DATA_FILE, out);
console.log(`\nsrc/menu-data.js を書き換えました（MENU_VERSION ${MENU_VERSION} → ${MENU_VERSION + 1}）`);
