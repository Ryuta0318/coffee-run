// 店舗の情報と、サイズの寄せ方
//   メニュー（品目・価格）は src/menu-data.js。公式サイトとのすり合わせは scripts/sync-menu.mjs
//   （毎週月曜・金曜に自動で実行し、変わっていれば書き換えて公開する）
//   デプロイせずに直すときは /admin.html（ADMIN_TOKEN が必要。次の同期で上書きされる）
import { MENU, MENU_VERSION, MENU_SYNCED, CATS } from "./menu-data.js";
export { MENU, MENU_VERSION, MENU_SYNCED };

export const STORES = {
  sbux: {
    label: "スターバックス",
    sub: "モバイルオーダー",
    mark: "S",
    markBg: "#2C1710",
    sizes: ["S", "T", "G", "V"],
    url: "https://product.starbucks.co.jp/beverage/",
    note: `公式サイトの価格（店内・税込、${MENU_SYNCED} 時点）。全店で買えるものだけ。ないものは「その他」から入力。`,
    cats: CATS.sbux,
  },
  mammoth: {
    label: "マンモスコーヒー",
    sub: "モバイルオーダー",
    mark: "M",
    markBg: "#EF2027",
    sizes: ["S", "M", "L"],
    url: "https://mmth.co.jp/menu",
    note: `公式サイトの価格（${MENU_SYNCED} 時点）。提供のないサイズは選べません。ないものは「その他」から入力。`,
    cats: CATS.mammoth,
  },
};

// 選んだサイズに提供がなければ、近い（小さい側の）サイズに寄せる。プロトタイプの fit と同じ
export function fitSize(prices, size) {
  let i = Math.min(Math.max(0, size | 0), prices.length - 1);
  while (i > 0 && prices[i] == null) i--;
  if (prices[i] == null) i = prices.findIndex((x) => x != null);
  return i;
}
