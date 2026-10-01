// メニューの初期データ（デザインのプロトタイプ `STORES` から移植）
//   価格は参考値。スタバ: 2026年2月改定時点（10/9 改定予定）/ マンモス: 報道等ベースで一部推定
//   ここを書き換えて MENU_VERSION を上げてデプロイすると、データベースのメニューが入れ替わる。
//   デプロイせずに直すときは /admin.html（ADMIN_TOKEN が必要）から。
//   p: サイズ順の価格。提供なしは null（sbux: S,T,G,V / mammoth: S,M,L）
//   t: 'both' | 'HOT' | 'ICED'
//   c: アイコン色 0 coffee / 1 milk / 2 tea / 3 sweet

export const MENU_VERSION = 1;

export const STORES = {
  sbux: {
    label: "スターバックス",
    sub: "モバイルオーダー",
    mark: "S",
    markBg: "#2C1710",
    sizes: ["S", "T", "G", "V"],
    url: "https://product.starbucks.co.jp/beverage/",
    note: "2026年2月改定時の価格（参考）。季節限定は「その他」から入力。",
    cats: ["コーヒー", "エスプレッソ", "フラペチーノ", "ティー", "その他"],
  },
  mammoth: {
    label: "マンモスコーヒー",
    sub: "モバイルオーダー",
    mark: "M",
    markBg: "#EF2027",
    sizes: ["S", "M", "L"],
    url: "https://mmth.co.jp/menu",
    note: "虎ノ門店の報道価格等（参考）。提供のないサイズは選べません。",
    cats: ["コーヒー", "ラテ", "シグネチャー", "ティー・ソーダ", "フラッペ"],
  },
};

export const MENU = {
  sbux: [
    { id: "drip", g: "コーヒー", name: "ドリップ コーヒー", p: [394, 440, 485, 530], t: "both", c: 0 },
    { id: "cold", g: "コーヒー", name: "コールドブリュー", p: [451, 490, 535, 580], t: "ICED", c: 0 },
    { id: "misto", g: "コーヒー", name: "カフェ ミスト", p: [449, 495, 540, 585], t: "HOT", c: 1 },
    { id: "latte", g: "エスプレッソ", name: "スターバックス ラテ", p: [460, 500, 545, 590], t: "both", c: 1 },
    { id: "americano", g: "エスプレッソ", name: "カフェ アメリカーノ", p: [451, 490, 535, 580], t: "both", c: 0 },
    { id: "cappuccino", g: "エスプレッソ", name: "カプチーノ", p: [460, 500, 545, 590], t: "HOT", c: 1 },
    { id: "mocha", g: "エスプレッソ", name: "カフェ モカ", p: [505, 545, 590, 635], t: "both", c: 3 },
    { id: "whitemocha", g: "エスプレッソ", name: "ホワイト モカ", p: [505, 545, 590, 635], t: "both", c: 3 },
    { id: "caramel", g: "エスプレッソ", name: "キャラメル マキアート", p: [520, 560, 605, 650], t: "both", c: 3 },
    { id: "honeyoat", g: "エスプレッソ", name: "ハニー オーツ ラテ", p: [520, 560, 605, 650], t: "both", c: 1 },
    { id: "fcoffee", g: "フラペチーノ", name: "コーヒー フラペチーノ", p: [null, 525, 570, 615], t: "ICED", c: 0 },
    { id: "fcaramel", g: "フラペチーノ", name: "キャラメル フラペチーノ", p: [null, 560, 605, 650], t: "ICED", c: 3 },
    { id: "fmatcha", g: "フラペチーノ", name: "抹茶 クリーム フラペチーノ", p: [null, 560, 605, 650], t: "ICED", c: 2 },
    { id: "fdark", g: "フラペチーノ", name: "ダーク モカ チップ フラペチーノ", p: [null, 560, 605, 650], t: "ICED", c: 3 },
    { id: "fvanilla", g: "フラペチーノ", name: "バニラ クリーム フラペチーノ", p: [null, 525, 570, 615], t: "ICED", c: 1 },
    { id: "icedtea", g: "ティー", name: "アイス ティー", p: [445, 485, 530, 575], t: "ICED", c: 2 },
    { id: "yuzu", g: "ティー", name: "ゆず シトラス ＆ ティー", p: [495, 540, 585, 630], t: "both", c: 2 },
    { id: "matcha", g: "ティー", name: "抹茶 ティー ラテ", p: [505, 545, 590, 635], t: "both", c: 2 },
    { id: "chai", g: "ティー", name: "チャイ ティー ラテ", p: [505, 545, 590, 635], t: "both", c: 1 },
    { id: "earl", g: "ティー", name: "アールグレイ ティー ラテ", p: [480, 520, 565, 610], t: "both", c: 2 },
    { id: "hojicha", g: "ティー", name: "ほうじ茶 ティー ラテ", p: [505, 545, 590, 635], t: "both", c: 1 },
    { id: "chamomile", g: "ティー", name: "カモミール ティー ラテ", p: [480, 520, 565, 610], t: "HOT", c: 2 },
    { id: "cocoa", g: "その他", name: "ココア", p: [450, 490, 535, 580], t: "both", c: 3 },
    { id: "steamed", g: "その他", name: "スチーム ミルク", p: [380, 420, 465, 510], t: "HOT", c: 1 },
  ],
  mammoth: [
    { id: "americano", g: "コーヒー", name: "アメリカーノ", p: [190, 250, 400], t: "both", c: 0 },
    { id: "decafmocha", g: "コーヒー", name: "ディカフェヘーゼルナッツモカ", p: [460, 500, null], t: "both", c: 3 },
    { id: "latte", g: "ラテ", name: "カフェラテ", p: [310, 380, 600], t: "both", c: 1 },
    { id: "honey", g: "ラテ", name: "ハニーラテ", p: [360, 430, null], t: "both", c: 1 },
    { id: "vanilla", g: "ラテ", name: "バニララテ", p: [360, 430, 650], t: "both", c: 1 },
    { id: "mocha", g: "ラテ", name: "カフェモカ", p: [410, 480, 700], t: "both", c: 3 },
    { id: "caramel", g: "ラテ", name: "キャラメルマキアート", p: [410, 480, 700], t: "both", c: 3 },
    { id: "oat", g: "ラテ", name: "穀物オーツラテ", p: [410, 480, null], t: "both", c: 1 },
    { id: "matcha", g: "ラテ", name: "抹茶ラテ", p: [410, 480, null], t: "both", c: 2 },
    { id: "choco", g: "ラテ", name: "チョコラテ", p: [380, 450, null], t: "both", c: 3 },
    { id: "snow", g: "シグネチャー", name: "スノーマンモス", p: [380, 450, null], t: "ICED", c: 3 },
    { id: "dalgona", g: "シグネチャー", name: "ダルゴナラテ", p: [410, 480, 700], t: "ICED", c: 3 },
    { id: "sweetpotato", g: "シグネチャー", name: "さつまいもラテ", p: [410, 480, null], t: "both", c: 3 },
    { id: "earl", g: "ティー・ソーダ", name: "アールグレイティー", p: [360, 430, null], t: "both", c: 2 },
    { id: "yuzu", g: "ティー・ソーダ", name: "ゆずソーダ", p: [360, 430, null], t: "ICED", c: 2 },
    { id: "mintchoco", g: "フラッペ", name: "ミントチョコフラッペ", p: [480, 580, null], t: "ICED", c: 2 },
    { id: "cookie", g: "フラッペ", name: "クッキーフラッペ", p: [480, 580, null], t: "ICED", c: 3 },
  ],
};

// 選んだサイズに提供がなければ、近い（小さい側の）サイズに寄せる。プロトタイプの fit と同じ
export function fitSize(prices, size) {
  let i = Math.min(Math.max(0, size | 0), prices.length - 1);
  while (i > 0 && prices[i] == null) i--;
  if (prices[i] == null) i = prices.findIndex((x) => x != null);
  return i;
}
