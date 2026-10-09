// 同じ人の重複アカウントをまとめる（一度だけ。済んだら kv に記録）
//   グループの中で一番最近使われたアカウントを残し、ほかのアカウントの注文・投稿・チャット・ログイン中の端末・通知の登録を移してから消す
//   まだ注文も投稿もしていないアカウントは、まとめずにそのまま残す
//   「使われた」＝注文・投稿・チャット・ログイン・写真の保存・登録のうち一番新しい時刻
export const MERGES = {
  key: "merge_2026_10_08",
  groups: [
    ["5d63313da341ea273e02", "281887b65ccc1e80dd42", "6e65eb57f1de799e66d2", "ce2a033a3e0260b1ad19"], // 鈴木隆太・Ryuta・すずき
    ["58f14da4c9e67dba86ca", "f35d083afce216a82ab3"], // あさみ
    ["5bba06d54b1132fe4d93", "f1418f572f1ab461efc2"], // きもと・木本
    ["cc1f089471cf8c042fd9", "98cf8371421ec185b95a"], // りな・さとりな
    ["e949bfad6d49bc849b43", "55bae44810e834e17a3c"], // りの
    ["4dc2cc83a45ebf658365", "adc75f3f7e1abeecf788"], // saya amano
    ["ee03e76e66513cfd0af3", "3ba76eac1434c34a712d"], // Yumi
    ["b76a1266a985b741834b", "afab9db63948b7258fed"], // Maki Tomita
    ["138440f2414af7b88182", "c5ce33b10483acb0f82d"], // いしだ・けんと
  ],
};

const okPaypay = (v) => !!v && !/^https?:/i.test(v);

export function mergeProfiles(db, { key, groups }) {
  if (db.one("SELECT v FROM kv WHERE k=?", key)) return null;
  const lastUsed = (uid) =>
    Math.max(
      0,
      ...[
        "SELECT MAX(created_at) t FROM orders WHERE user_id=?",
        "SELECT MAX(created_at) t FROM posts WHERE organizer_id=?",
        "SELECT MAX(created_at) t FROM messages WHERE user_id=?",
        "SELECT MAX(ts) t FROM sessions WHERE uid=?",
        "SELECT MAX(photo) t FROM profiles WHERE id=?",
        "SELECT MAX(created_at) t FROM profiles WHERE id=?",
      ].map((q) => (db.one(q, uid) || {}).t || 0)
    );
  const log = [];
  for (const ids of groups) {
    const rows = ids.map((id) => db.one("SELECT * FROM profiles WHERE id=?", id)).filter(Boolean);
    if (rows.length < 2) continue;
    rows.sort((a, b) => lastUsed(b.id) - lastUsed(a.id));
    const keep = rows[0];
    const gone = rows.slice(1);
    // まとめるのは、注文か投稿をしたことのあるアカウントだけ
    const merged = gone.filter((g) => db.one("SELECT 1 FROM orders WHERE user_id=? UNION SELECT 1 FROM posts WHERE organizer_id=? LIMIT 1", g.id, g.id));
    for (const g of gone) if (!merged.includes(g)) log.push({ skip: g.id, name: g.name });
    // PayPay ID：残すアカウントのもの。空かリンクなら、まとめるアカウントの新しいもの
    const paypay = okPaypay(keep.paypay_id) ? keep.paypay_id : (merged.find((g) => okPaypay(g.paypay_id)) || {}).paypay_id || keep.paypay_id;
    let last = {};
    for (const r of [...merged].reverse().concat(keep)) {
      try {
        Object.assign(last, JSON.parse(r.last_orders || "{}"));
      } catch {}
    }
    let photo = keep.photo || 0;
    for (const g of merged) {
      // 写真がなければ、ほかのアカウントの写真を使う
      if (!photo && g.photo && db.one("SELECT 1 FROM photos WHERE uid=?", g.id)) {
        db.run("DELETE FROM photos WHERE uid=?", keep.id);
        db.run("UPDATE photos SET uid=? WHERE uid=?", keep.id, g.id);
        photo = g.photo;
      }
      // 同じ投稿に両方で注文していたら、残すアカウントの注文を残す
      const moved = db.q("SELECT id FROM orders WHERE user_id=?", g.id).length;
      db.run("UPDATE OR IGNORE orders SET user_id=? WHERE user_id=?", keep.id, g.id);
      db.run("DELETE FROM orders WHERE user_id=?", g.id);
      db.run("UPDATE posts SET organizer_id=? WHERE organizer_id=?", keep.id, g.id);
      db.run("UPDATE messages SET user_id=? WHERE user_id=?", keep.id, g.id);
      db.run("UPDATE sessions SET uid=? WHERE uid=?", keep.id, g.id);
      db.run("UPDATE push_subs SET uid=? WHERE uid=?", keep.id, g.id);
      db.run("DELETE FROM photos WHERE uid=?", g.id);
      db.run("DELETE FROM profiles WHERE id=?", g.id);
      log.push({ from: g.id, name: g.name, to: keep.id, orders: moved });
    }
    // まとめた結果、自分の投稿への自分の注文になったものは支払いなし
    db.run("UPDATE orders SET status='done' WHERE user_id=? AND post_id IN (SELECT id FROM posts WHERE organizer_id=?)", keep.id, keep.id);
    db.run("UPDATE profiles SET paypay_id=?, last_orders=?, photo=? WHERE id=?", paypay, JSON.stringify(last), photo, keep.id);
  }
  db.run("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)", key, JSON.stringify({ at: Date.now(), log }));
  return log;
}
