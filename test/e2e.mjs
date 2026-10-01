// 2人（投稿者・注文者）で、登録 → 投稿 → 注文 → リアルタイム反映 → 締切 → 精算 → チャット を通して確かめる
//   npx wrangler dev   を起動してから   node test/e2e.mjs [http://127.0.0.1:8787]
//   スクリーンショットは test/screens/ に出る
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const SHOTS = new URL("./screens/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sfx = Date.now().toString(36).slice(-4);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ja-JP", timezoneId: "Asia/Tokyo", ignoreHTTPSErrors: !!process.env.E2E_IGNORE_HTTPS });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    console.error("pageerror", e);
    process.exitCode = 1;
  });
  return page;
};
const shot = (page, name, full = true) => page.screenshot({ path: SHOTS + name + ".png", fullPage: full });
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const step = (t) => console.log("・" + t);

const A = await mk(); // 投稿者
const B = await mk(); // 注文する人
const nameA = "山田" + sfx, nameB = "佐藤" + sfx;

// ---- 起動・登録 ----
step("スプラッシュ → 登録画面");
await A.goto(BASE);
await A.waitForTimeout(500);
await shot(A, "00-splash", false);
await A.waitForSelector("text=ようこそ！");
await A.waitForTimeout(2200);
await shot(A, "01-signup");
await A.fill("#pf-name", nameA);
await A.fill("#pf-paypay", "yamada-kc");
await A.click('button[aria-label="色を選ぶ"] >> nth=0');
// 写真をアイコンにする（登録と同時に保存される）
await A.setInputFiles("#pf-photo", new URL("../public/assets/icon-512.png", import.meta.url).pathname);
await A.waitForSelector('button[aria-label="写真を選ぶ"] img[src^="data:image/jpeg"]');
await A.click("text=はじめる");
await A.waitForSelector("text=みんなもコーヒーいるかな？");

await B.goto(BASE);
await B.locator(".splash").click({ timeout: 1500 }).catch(() => {});
await B.fill("#pf-name", nameB);
await B.click('button[aria-label="色を選ぶ"] >> nth=1');
await B.click("text=はじめる");
await B.waitForSelector("text=みんなもコーヒーいるかな？");

// ---- 投稿 ----
step("投稿をつくる（PayPay ID なしの人は登録へ）");
await B.click("text=＋ 投稿");
await B.waitForSelector("text=PayPay IDを登録して投稿");
await B.click("text=キャンセル");

await A.click("text=＋ 投稿");
await A.waitForSelector("text=どこで買う？");
await shot(A, "02-compose");
const body0 = await A.inputValue("textarea");
assert.equal(body0, "マンモスコーヒー行きますが皆さんいけますか？");
await A.click("text=スターバックス");
assert.equal(await A.inputValue("textarea"), "スターバックス行きますが皆さんいけますか？", "本文が店舗に追従する");
await A.click("text=マンモスコーヒー");
await A.click("text=投稿する");
await A.waitForSelector("text=投稿しました。共有文をコピー済み");
assert.match(await clip(A), /☕ COFFEE RUN｜.*\nマンモスコーヒー行きますが.*\nマンモスコーヒー・注文締切 \d+:\d\d／出発 \d+:\d\d\n支払いはPayPay（ID: yamada-kc）/);

step("もう1人の画面に、リロードなしで投稿が出る");
await B.waitForSelector(`article:has-text("${nameA}")`, { timeout: 5000 });
assert.match(await A.getAttribute('button[aria-label="アカウント"] img', "src"), /^\/api\/photo\/[a-f0-9]{20}\?v=\d+$/, "ヘッダーのアイコンが写真");
await B.waitForSelector(`article:has-text("${nameA}") img[src^="/api/photo/"]`);
assert.ok(await B.evaluate(() => [...document.querySelectorAll('img[src^="/api/photo/"]')].every((i) => i.complete && i.naturalWidth === 256)), "写真は 256px の正方形");
await B.waitForTimeout(300);
await shot(B, "03-feed");

// ---- 注文 ----
step("注文する（カフェラテ M ICED + メモ）");
await B.click(`article:has-text("${nameA}") >> nth=0`);
await B.waitForSelector("text=NOW OPEN・募集中");
await B.click('button:has-text("カフェラテ")');
await B.click('button:text-is("ICED")');
await B.fill("#od-note", "オーツミルク");
assert.equal(await B.textContent("text=お支払い額 >> xpath=following-sibling::span"), "¥380");
await shot(B, "04-order");
await B.click('main button:has-text("注文する")');
await B.waitForSelector("text=注文を受け付けました");
await B.waitForSelector("text=注文済み");

step("サイズが無い組み合わせは選べない（ハニーラテ L）");
await B.click('button:has-text("ハニーラテ")');
assert.equal(await B.isDisabled('main button:text-is("L")'), true);
await B.click('button:has-text("カフェラテ")');

step("投稿者も注文 → 自分の分は確認済み");
await A.click(`article:has-text("${nameA}") >> nth=0`);
await A.waitForSelector("text=NOW OPEN・募集中");
await A.click('button:has-text("アメリカーノ")');
await A.click('main button:has-text("注文する")');
await A.waitForSelector("text=注文を受け付けました");

step("注文一覧（リアルタイム・まとめ）");
await A.click('button[role="tab"]:has-text("注文一覧")');
await A.waitForSelector("text=カフェラテ M ICED（オーツミルク）");
await A.click("text=注文内容をコピー");
assert.match(await clip(A), /【マンモスコーヒー 注文】受取：.*\n・.*×1\n・.*×1\n計2杯 \/ ¥630/);
await shot(A, "05-list");

step("受付を締め切る → 注文者の画面も受付終了");
await A.click("text=受付を締め切る");
await A.waitForSelector("text=受付を再開");
await B.waitForSelector("text=CLOSED・受付終了");
await B.click('button[role="tab"]:has-text("注文する")');
await B.waitForSelector("text=受付は締め切られました。精算タブから支払いをお願いします。");

// ---- 精算 ----
step("精算：PayPay シート → 報告");
await B.click('button[role="tab"]:has-text("精算")');
await B.click("text=PayPayで払う");
await B.waitForSelector("text=IDをコピーしてPayPayを開く");
await B.click("text=送金しました（報告する）", { force: true }); // ①の前は押しても何も起きない
assert.equal(await B.isVisible("text=IDをコピーしてPayPayを開く"), true);
await shot(B, "06-sheet", false);
await B.click("text=金額をコピー");
assert.equal(await clip(B), "380");
await B.click("text=IDをコピーしてPayPayを開く");
assert.equal(await clip(B), "yamada-kc", "送り先の ID がコピーされる");
await B.click("text=送金しました（報告する）");
await B.waitForSelector("text=送金を報告しました");

step("投稿者が入金を確認 → 完了");
await A.click('button[role="tab"]:has-text("精算")');
await A.waitForSelector("text=入金を確認");
await shot(A, "07-pay-before");
await A.click("text=入金を確認");
await A.waitForSelector("text=全員の支払いが完了しました");
await B.waitForSelector("text=全員の支払いが完了しました");
await shot(A, "08-pay-done");

// ---- チャット ----
step("チャット（定型文・Enter送信）");
await B.click('button[role="tab"]:has-text("チャット")');
await B.waitForSelector("text=まだメッセージはありません。");
await B.click('button:text-is("着きました")');
await B.fill('input[aria-label="メッセージ"]', "1階で待ってます");
await B.press('input[aria-label="メッセージ"]', "Enter");
await A.click('button[role="tab"]:has-text("チャット")');
await A.waitForSelector("text=1階で待ってます");
await A.fill('input[aria-label="メッセージ"]', "了解です！");
await A.click('button[aria-label="送信"]');
await B.waitForSelector("text=了解です！");
await shot(B, "09-chat", false);

// ---- フィード・アカウント ----
step("フィードのフィルタとアカウント");
await A.click("text=投稿一覧");
await A.waitForSelector(`article:has-text("${nameA}")`);
await A.click('button:text-is("未精算あり")');
await A.click('button:text-is("すべて")');
await shot(A, "10-feed-done");
await B.click("text=投稿一覧");
await B.click('button[aria-label="アカウント"]');
await B.waitForSelector("text=これまでの注文");
await shot(B, "11-account");

step("「いつもの」が出る");
await A.click("text=＋ 投稿");
await A.click("text=投稿する");
await A.waitForSelector("text=投稿しました。共有文をコピー済み");
await B.click("text=戻る");
await B.click(`article:has-text("${nameA}") >> nth=0`);
await B.waitForSelector("text=いつもの");
await B.waitForSelector("text=カフェラテ M ICED（オーツミルク）");
await shot(B, "12-usual");

step("投稿者が投稿を削除 → 開いていた人はフィードに戻る");
assert.equal(await B.isVisible('main button:text-is("削除")'), false, "投稿者以外には削除ボタンが出ない");
await A.click(`article:has-text("${nameA}") >> nth=0`);
A.once("dialog", (d) => d.accept());
await A.click('button:text-is("削除")');
await A.waitForSelector("text=投稿を削除しました");
await B.waitForSelector("text=この投稿は削除されました");
await B.waitForSelector("text=みんなもコーヒーいるかな？");

await browser.close();
console.log(process.exitCode ? "NG" : "OK");
