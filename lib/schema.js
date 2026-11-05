export const SCHEMA = `
create table if not exists farms(id text primary key, name text not null, created_at timestamptz default now());
create table if not exists users(
  id text primary key, farm_id text not null, username text unique not null, display_name text not null,
  password_hash text not null, role text not null, buyer_id text, houses jsonb default '[]'::jsonb,
  line_user_id text, active boolean default true, created_at timestamptz default now(), last_login timestamptz);
create table if not exists docs(
  farm_id text not null, path text not null, collection text not null, doc_id text not null,
  data jsonb not null, version int not null default 1, updated_at timestamptz not null default clock_timestamp(),
  updated_by text, source text, primary key(farm_id, path));
create index if not exists docs_coll on docs(farm_id, collection);
create index if not exists docs_upd on docs(farm_id, updated_at);
create table if not exists doc_deletes(farm_id text not null, path text not null, collection text, deleted_at timestamptz not null default clock_timestamp());
create index if not exists doc_del_at on doc_deletes(farm_id, deleted_at);
create table if not exists files(id text primary key, farm_id text, mime text, size int, data bytea, created_at timestamptz default now(), created_by text);
alter table files add column if not exists blob_path text;
create table if not exists settings(farm_id text not null, key text not null, value jsonb, secret text, updated_at timestamptz default now(), primary key(farm_id, key));
create table if not exists api_keys(id text primary key, farm_id text not null, name text not null, provider text, secret text not null, last4 text, created_at timestamptz default now());
create table if not exists intake(
  id text primary key, farm_id text not null, source text, file_id text, chat_id text, sender_id text, sender_name text,
  doc_type text, status text not null, confidence real, ocr_text text, fields jsonb, checks jsonb, committed jsonb,
  ask jsonb, error text, created_at timestamptz default now(), updated_at timestamptz default now(), reviewed_by text);
create index if not exists intake_status on intake(farm_id, status, created_at);
create table if not exists intake_events(id bigserial primary key, intake_id text, at timestamptz default now(), actor text, action text, detail jsonb);
create table if not exists line_chats(farm_id text not null, chat_id text not null, kind text, name text, last_seen timestamptz, primary key(farm_id, chat_id));
create table if not exists ai_calls(id bigserial primary key, farm_id text, feature text, provider text, model text, ms int, ok boolean, error text, at timestamptz default now());
insert into farms(id, name) values ('main', 'ฟาร์มของฉัน') on conflict do nothing;
`;
