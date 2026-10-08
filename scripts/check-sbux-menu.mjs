// スターバックスのメニューを、公式サイト（menu.starbucks.co.jp）と見比べる
//   node scripts/check-sbux-menu.mjs           … 違いだけを表示（何も書き換えない）
//   node scripts/check-sbux-menu.mjs --json    … 公式のレギュラーを src/menu.js の形で表示（貼り替え用）
//
// 「レギュラー」の決め方（公式サイトのデータの印から）
//   ・サイズ違いの価格がある（「¥460〜」のように〜がつく）… 季節限定・新作は〜がつかない
//   ・一部店舗限定ではない（リザーブ・ロースタリー・地域限定は除く）
// 価格は商品ページの Short / Tall / Grande / Venti（店内・税込）。HOT / ICED も商品ページから。
import { execFileSync } from "node:child_process";
import { MENU } from "../src/menu.js";

const CATS = { drip: "コーヒー", espresso: "エスプレッソ", frappuccino: "フラペチーノ", tea: "ティー", "beverage-others": "その他" };
// 注文のとりまとめに向かないもの（量り売り・キッズ・サイズが違う体系のもの）
const SKIP = [/ポットサービス/, /コーヒートラベラー/, /コーヒー プレス/, /^キッズ/, /kids/i, /^エスプレッソ$/];
const SIZES = ["Short", "Tall", "Grande", "Venti"];

// fetch が使えない環境（社内プロキシなど）では curl で取る
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 coffee-run menu check" } });
      if (r.ok) return await r.text();
    } catch {
      try {
        return execFileSync("curl", ["-sS", "-f", "-m", "40", "-A", "Mozilla/5.0", url], { encoding: "utf8", maxBuffer: 20e6 });
      } catch {}
    }
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
  }
  throw new Error("取得できませんでした: " + url);
}
const norm = (s) => s.replace(/[®™​]/g, "").replace(/[（(]/g, "（").replace(/[）)]/g, "）").replace(/\s+/g, " ").trim();
const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&yen;/g, "¥").replace(/&#165;/g, "¥").replace(/&nbsp;/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean);

async function official() {
  const out = [];
  for (const [code, g] of Object.entries(CATS)) {
    const list = JSON.parse(await get(`https://menu.starbucks.co.jp/api/v1/list?category_code=${code}&limit=100`)).item;
    for (const it of list) {
      const name = norm(it.item_name);
      if (it.certain_stores || !it.price_starts_from || SKIP.some((re) => re.test(name))) continue;
      const L = text(await get("https://menu.starbucks.co.jp/" + it.item_code));
      const k = Math.max(0, L.indexOf("お気に入り一覧を見る"));
      const seg = L.slice(k, k + 16);
      const tl = seg.find((l) => /^(ホット|アイス)( \/ (ホット|アイス))?$/.test(l)) || "アイス";
      const p = SIZES.map((sz) => {
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
      const t = tl.includes("ホット") && tl.includes("アイス") ? "both" : tl.includes("ホット") ? "HOT" : "ICED";
      out.push({ name, g, p, t, code: it.item_code });
    }
  }
  return out;
}

const off = await official();
const mine = MENU.sbux.map((x) => ({ ...x, key: norm(x.name) }));
if (process.argv.includes("--json")) {
  for (const o of off) {
    const m = mine.find((x) => x.key === o.name);
    console.log(`    { id: "${m ? m.id : "new_" + o.code.slice(-5)}", g: "${o.g}", name: "${o.name}", p: [${o.p.map((v) => (v == null ? "null" : v)).join(", ")}], t: "${o.t}", c: ${m ? m.c : 0} },`);
  }
  process.exit(0);
}
const added = off.filter((o) => !mine.some((m) => m.key === o.name));
const gone = mine.filter((m) => !off.some((o) => o.name === m.key));
const changed = off
  .map((o) => ({ o, m: mine.find((m) => m.key === o.name) }))
  .filter(({ o, m }) => m && (JSON.stringify(o.p) !== JSON.stringify(m.p) || o.t !== m.t));
console.log(`公式のレギュラー ${off.length}品 / アプリ ${mine.length}品\n`);
console.log("■ 公式にあって、アプリにないもの（追加候補）");
added.forEach((o) => console.log(`  + ${o.g}｜${o.name}  [${o.p.join(", ")}] ${o.t}`));
console.log("\n■ アプリにあって、公式のレギュラーにないもの（終了・季節限定の可能性）");
gone.forEach((m) => console.log(`  - ${m.g}｜${m.name}`));
console.log("\n■ 価格・HOT/ICED が違うもの");
changed.forEach(({ o, m }) => console.log(`  * ${o.name}  アプリ [${m.p.join(", ")}] ${m.t} → 公式 [${o.p.join(", ")}] ${o.t}`));
if (!added.length && !gone.length && !changed.length) console.log("\n違いはありません ✓");
