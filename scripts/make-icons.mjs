// アプリのアイコン（PNG）を書き出す: node scripts/make-icons.mjs
//   ロゴ（public/assets/coffee-run-logo.svg）を「COFFEE / RUN」の2段に組んで、正方形にする。
//   Playwright（Chromium）で描いてスクリーンショットする
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const logo = readFileSync(new URL("../public/assets/coffee-run-logo.svg", import.meta.url), "utf8");
const path = (fill) => (logo.match(new RegExp(`<path fill="${fill}" d="([^"]+)"`)) || [])[1];
const BROWN = path("#2C1710"); // COFFEE と速度線
const RED = path("#EF2027"); // RUN
if (!BROWN || !RED) throw new Error("logo paths not found");
const SPLIT = 640; // これより右の茶色は RUN の速度線

// 1段目 COFFEE（x 0〜640）・2段目 RUN（x 590〜962）。どちらも高さ 275
const COFFEE_W = SPLIT, RUN_X = 590, RUN_W = 372, H = 275, GAP = 18;
const mark = `
  <defs>
    <clipPath id="left"><rect x="0" y="0" width="${SPLIT}" height="${H}"/></clipPath>
    <clipPath id="right"><rect x="${SPLIT}" y="0" width="400" height="${H}"/></clipPath>
  </defs>
  <g clip-path="url(#left)"><path fill="#2C1710" fill-rule="evenodd" d="${BROWN}"/></g>
  <g transform="translate(${(COFFEE_W - RUN_W) / 2 - RUN_X} ${H + GAP})">
    <g clip-path="url(#right)"><path fill="#2C1710" fill-rule="evenodd" d="${BROWN}"/></g>
    <path fill="#EF2027" fill-rule="evenodd" d="${RED}"/>
  </g>`;
const MARK_W = COFFEE_W, MARK_H = H * 2 + GAP;

// box: 512 の正方形のうち、ロゴを収める幅（maskable は丸く切られても欠けないよう小さめ）
const svg = (size, box) => {
  const s = box / Math.max(MARK_W, MARK_H);
  const x = (512 - MARK_W * s) / 2, y = (512 - MARK_H * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="#FBF7F2"/>
    <g transform="translate(${x} ${y}) scale(${s})">${mark}</g>
  </svg>`;
};

// Android の通知バッジは白黒（透明の上に白）なので、ロゴではなくカップの形
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 512 512"><g fill="#FFFFFF">
  <rect x="196" y="96" width="22" height="60" rx="11"/><rect x="236" y="108" width="22" height="48" rx="11"/><rect x="276" y="96" width="22" height="60" rx="11"/>
  <rect x="128" y="172" width="236" height="26" rx="13"/><path d="M146 196 h200 v92 a100 100 0 0 1 -100 100 a100 100 0 0 1 -100 -100 z"/>
  <path d="M340 220 a52 52 0 1 1 0 104" fill="none" stroke="#FFFFFF" stroke-width="26"/></g></svg>`;

const out = [
  ["public/assets/icon-512.png", 512, svg(512, 430)],
  ["public/assets/icon-192.png", 192, svg(192, 430)],
  ["public/assets/icon-180.png", 180, svg(180, 430)],
  ["public/assets/icon-maskable-512.png", 512, svg(512, 330)],
  ["public/assets/badge-96.png", 96, badge],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
for (const [file, size, markup] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.locator("svg").screenshot({ path: file, omitBackground: true });
  console.log("wrote", file);
}
await browser.close();
