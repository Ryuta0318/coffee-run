// アプリのアイコン（PNG）を書き出す: node scripts/make-icons.mjs
//   Playwright（Chromium）で SVG を描いてスクリーンショットする
import { chromium } from "playwright";

// 速度線つきの赤いカップ（ロゴの色: 茶 #2C1710 / 赤 #EF2027、背景 #FBF7F2）
const cup = (fg = "#EF2027", line = "#2C1710", steam = "#D8C2AC") => `
  <g transform="translate(30 0)">
    <rect x="40" y="214" width="84" height="20" rx="10" fill="${line}"/>
    <rect x="62" y="262" width="62" height="20" rx="10" fill="${fg}"/>
    <rect x="84" y="310" width="40" height="20" rx="10" fill="${line}"/>
    <rect x="196" y="96" width="22" height="60" rx="11" fill="${steam}"/>
    <rect x="236" y="108" width="22" height="48" rx="11" fill="${steam}" opacity=".7"/>
    <rect x="276" y="96" width="22" height="60" rx="11" fill="${steam}"/>
    <rect x="128" y="172" width="236" height="26" rx="13" fill="${line}"/>
    <path d="M146 196 h200 v92 a100 100 0 0 1 -100 100 a100 100 0 0 1 -100 -100 z" fill="${fg}"/>
    <path d="M340 220 a52 52 0 1 1 0 104" fill="none" stroke="${fg}" stroke-width="26"/>
    <rect x="146" y="240" width="200" height="30" fill="#FFFFFF" opacity=".9"/>
  </g>`;
const svg = (size, { pad = 0, bg = "#FBF7F2", body = cup() } = {}) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    ${bg ? `<rect width="512" height="512" fill="${bg}"/>` : ""}
    <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -270)">${body}</g>
  </svg>`;

const out = [
  ["public/assets/icon-512.png", 512, { pad: 0.06 }],
  ["public/assets/icon-192.png", 192, { pad: 0.06 }],
  ["public/assets/icon-180.png", 180, { pad: 0.06 }],
  ["public/assets/icon-maskable-512.png", 512, { pad: 0.24 }],
  // Android の通知バッジは白黒（透明の上に白）
  ["public/assets/badge-96.png", 96, { pad: 0.04, bg: "", body: cup("#FFFFFF", "#FFFFFF", "#FFFFFF") }],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
for (const [file, size, opt] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, opt)}</body></html>`);
  await page.locator("svg").screenshot({ path: file, omitBackground: true });
  console.log("wrote", file);
}
await browser.close();
