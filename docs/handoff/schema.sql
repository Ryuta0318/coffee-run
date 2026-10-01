-- COFFEE RUN — 推奨スキーマ（Supabase / PostgreSQL）
-- 認証は「名前だけ」: Supabase Anonymous Sign-in で端末ごとにユーザーを発行し、profiles に表示名を保存する。

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  paypay_id text,
  color text not null default '#EF2027',
  last_orders jsonb not null default '{}'::jsonb, -- { "sbux": {item_id,size,temp,note,mode}, "mammoth": {...} }
  created_at timestamptz not null default now()
);

create type store_kind as enum ('sbux', 'mammoth');

create table menu_items (
  id text not null,
  store store_kind not null,
  category text not null,
  name text not null,
  prices int[] not null,          -- サイズ順。提供なしは null（sbux: S,T,G,V / mammoth: S,M,L）
  temp text not null check (temp in ('both','HOT','ICED')),
  tone smallint not null default 0, -- アイコン色 0 coffee / 1 milk / 2 tea / 3 sweet
  sort int not null default 0,
  active boolean not null default true,
  primary key (store, id)
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references profiles(id),
  title text not null,            -- 例 "10/1（水）"
  body text not null,
  store store_kind not null,
  deadline_at timestamptz not null,
  depart_at timestamptz not null,
  closed boolean not null default false,
  notified_5min boolean not null default false,
  created_at timestamptz not null default now()
);

create type order_mode as enum ('go', 'ask');            -- 一緒に行ける！ / お願いします！
create type pay_status as enum ('unpaid', 'reported', 'done');

create table orders (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id),
  mode order_mode not null default 'ask',
  item_id text,                   -- null の場合は custom_*
  size_index smallint,
  temp text not null,
  note text not null default '',
  custom_name text,
  custom_price int,
  price int not null,             -- 注文時点の金額を確定保存
  status pay_status not null default 'unpaid',
  created_at timestamptz not null default now(),
  unique (post_id, user_id)       -- 1投稿1人1注文（再注文は上書き）
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id),
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

-- RLS 方針（概要）
-- profiles: 全員 select 可 / 本人のみ update
-- posts: 全員 select / insert は本人（paypay_id 必須）/ update(closed) は投稿者のみ
-- orders: 全員 select / insert・update(内容) は本人かつ受付中のみ
--         status: 本人は unpaid→reported のみ、投稿者は reported→done / done→unpaid
-- messages: 全員 select / insert は本人
-- Realtime: orders, messages, posts を publication に追加
