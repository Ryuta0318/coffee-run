// メニューの初期データ（デザインのプロトタイプ `STORES` から移植）
//   スタバ: 公式サイトのメニュー（menu.starbucks.co.jp）で確認したレギュラー（scripts/check-sbux-menu.mjs で最新と比べられる）
//   マンモス: 公式サイトに一覧がないため、店舗レポート等で確認したもの（参考）
//   ここを書き換えて MENU_VERSION を上げてデプロイすると、データベースのメニューが入れ替わる。
//   デプロイせずに直すときは /admin.html（ADMIN_TOKEN が必要）から。
//   p: サイズ順の価格。提供なしは null（sbux: S,T,G,V / mammoth: S,M,L）
//   t: 'both' | 'HOT' | 'ICED'
//   c: アイコン色 0 coffee / 1 milk / 2 tea / 3 sweet

export const MENU_VERSION = 2;

export const STORES = {
  sbux: {
    label: "スターバックス",
    sub: "モバイルオーダー",
    mark: "S",
    markBg: "#2C1710",
    sizes: ["S", "T", "G", "V"],
    url: "https://product.starbucks.co.jp/beverage/",
    note: "2026年10月8日に公式サイトで確認した価格（店内・税込）。季節限定は「その他」から入力。",
    cats: ["コーヒー", "エスプレッソ", "フラペチーノ", "ティー", "その他"],
  },
  mammoth: {
    label: "マンモスコーヒー",
    sub: "モバイルオーダー",
    mark: "M",
    markBg: "#EF2027",
    sizes: ["S", "M", "L"],
    url: "https://mmth.co.jp/menu",
    note: "公式の一覧がないため、2026年の店舗レポート等で確認した価格（参考）。季節限定は「その他」から入力。",
    cats: ["コーヒー", "ラテ", "シグネチャー", "ティー・ソーダ", "フラッペ"],
  },
};

export const MENU = {
  sbux: [
    // 2026年10月8日に公式サイト（menu.starbucks.co.jp）で確認。全店で買えるレギュラーだけ（季節限定・一部店舗限定は「その他」から）
    { id: "drip", g: "コーヒー", name: "ブリュード コーヒー", p: [394, 440, 485, 530], t: "both", c: 0 },
    { id: "misto", g: "コーヒー", name: "カフェ ミスト", p: [449, 495, 540, 585], t: "HOT", c: 1 },
    { id: "cold", g: "コーヒー", name: "コールドブリュー コーヒー", p: [451, 490, 535, 580], t: "ICED", c: 0 },
    { id: "sweetmilk", g: "コーヒー", name: "スイート ミルクコーヒー", p: [530, 570, 616, 660], t: "ICED", c: 1 },
    { id: "latte", g: "エスプレッソ", name: "スターバックス ラテ", p: [460, 500, 545, 590], t: "both", c: 1 },
    { id: "soylatte", g: "エスプレッソ", name: "ソイ ラテ", p: [460, 500, 545, 590], t: "both", c: 1 },
    { id: "almondlatte", g: "エスプレッソ", name: "アーモンドミルク ラテ", p: [460, 500, 545, 590], t: "both", c: 1 },
    { id: "oatlatte", g: "エスプレッソ", name: "オーツミルク ラテ", p: [460, 500, 545, 590], t: "both", c: 1 },
    { id: "cappuccino", g: "エスプレッソ", name: "カプチーノ", p: [460, 500, 545, 590], t: "both", c: 1 },
    { id: "americano", g: "エスプレッソ", name: "カフェ アメリカーノ", p: [451, 490, 535, 580], t: "both", c: 0 },
    { id: "mocha", g: "エスプレッソ", name: "カフェ モカ", p: [515, 555, 600, 645], t: "both", c: 3 },
    { id: "whitemocha", g: "エスプレッソ", name: "ホワイト モカ", p: [515, 555, 600, 645], t: "both", c: 3 },
    { id: "caramel", g: "エスプレッソ", name: "キャラメル マキアート", p: [540, 580, 625, 671], t: "both", c: 3 },
    { id: "triple", g: "エスプレッソ", name: "トリプルエスプレッソ ラテ", p: [null, 580, null, null], t: "both", c: 1 },
    { id: "faffogato", g: "フラペチーノ", name: "エスプレッソ アフォガート フラペチーノ", p: [600, 640, 685, 730], t: "ICED", c: 0 },
    { id: "fcoffee", g: "フラペチーノ", name: "コーヒー フラペチーノ", p: [515, 555, 600, 645], t: "ICED", c: 0 },
    { id: "fdark", g: "フラペチーノ", name: "ダーク モカ チップ フラペチーノ", p: [555, 595, 640, 685], t: "ICED", c: 3 },
    { id: "fcaramel", g: "フラペチーノ", name: "キャラメル フラペチーノ", p: [570, 610, 655, 700], t: "ICED", c: 3 },
    { id: "fmatcha", g: "フラペチーノ", name: "抹茶 クリーム フラペチーノ", p: [555, 595, 640, 685], t: "ICED", c: 2 },
    { id: "fvanilla", g: "フラペチーノ", name: "バニラ クリーム フラペチーノ", p: [570, 610, 655, 700], t: "ICED", c: 1 },
    { id: "fmango", g: "フラペチーノ", name: "マンゴー パッション ティー フラペチーノ", p: [550, 590, 635, 680], t: "ICED", c: 2 },
    { id: "earl", g: "ティー", name: "アールグレイ ブーケ & ティー ラテ", p: [540, 580, 625, 671], t: "both", c: 2 },
    { id: "hojicha", g: "ティー", name: "ほうじ茶 & クラシックティー ラテ", p: [530, 570, 616, 660], t: "both", c: 1 },
    { id: "yuzu", g: "ティー", name: "ゆず シトラス & ティー", p: [510, 550, 595, 640], t: "both", c: 2 },
    { id: "chai", g: "ティー", name: "チャイ ティー ラテ", p: [510, 550, 595, 640], t: "both", c: 1 },
    { id: "matcha", g: "ティー", name: "抹茶 ティー ラテ", p: [510, 550, 595, 640], t: "both", c: 2 },
    { id: "ebtealatte", g: "ティー", name: "イングリッシュ ブレックファスト ティー ラテ", p: [510, 550, 595, 640], t: "HOT", c: 1 },
    { id: "chamomile", g: "ティー", name: "カモミール ティー ラテ", p: [510, 550, 595, 640], t: "HOT", c: 2 },
    { id: "oolonglatte", g: "ティー", name: "ゼンクラウド ウーロン ティー ラテ", p: [510, 550, 595, 640], t: "HOT", c: 1 },
    { id: "icedtea", g: "ティー", name: "アイスティー（ブラック）", p: [445, 485, 530, 575], t: "ICED", c: 2 },
    { id: "passiontea", g: "ティー", name: "アイスティー（パッション）", p: [445, 485, 530, 575], t: "ICED", c: 2 },
    { id: "ebtea", g: "ティー", name: "イングリッシュ ブレックファスト", p: [485, 485, 530, 575], t: "HOT", c: 2 },
    { id: "chamomiletea", g: "ティー", name: "カモミール", p: [485, 485, 530, 575], t: "HOT", c: 2 },
    { id: "youthberry", g: "ティー", name: "ユースベリー", p: [485, 485, 530, 575], t: "HOT", c: 2 },
    { id: "oolong", g: "ティー", name: "ゼンクラウド ウーロン", p: [485, 485, 530, 575], t: "HOT", c: 2 },
    { id: "whitechoco", g: "その他", name: "ホワイト チョコレート ミルク", p: [460, 500, 545, 590], t: "both", c: 3 },
    { id: "cocoa", g: "その他", name: "ココア", p: [460, 500, 545, 590], t: "both", c: 3 },
    { id: "steamed", g: "その他", name: "ミルク", p: [405, 445, 490, 535], t: "both", c: 1 },
  ],
  mammoth: [
    { id: "americano", g: "コーヒー", name: "アメリカーノ", p: [190, 250, 400], t: "both", c: 0 },
    { id: "decafmocha", g: "コーヒー", name: "ディカフェヘーゼルナッツモカ", p: [460, 500, null], t: "both", c: 3 },
    { id: "latte", g: "ラテ", name: "カフェラテ", p: [310, 380, 600], t: "both", c: 1 },
    { id: "honey", g: "ラテ", name: "ハニーラテ", p: [360, 430, null], t: "both", c: 1 },
    { id: "vanilla", g: "ラテ", name: "バニララテ", p: [360, 430, 650], t: "both", c: 1 },
    { id: "mocha", g: "ラテ", name: "カフェモカ", p: [410, 480, 700], t: "both", c: 3 },
    { id: "caramel", g: "ラテ", name: "ソルティッドキャラメルマキアート", p: [410, 480, 700], t: "both", c: 3 },
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
