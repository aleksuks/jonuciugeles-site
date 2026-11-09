-- Run once in the Supabase SQL editor. anon may only insert.

create table if not exists public.inquiries (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 2 and 120),
  phone       text not null check (char_length(phone) between 8 and 40),
  email       text not null default '' check (char_length(email) <= 200),
  needed_by   text not null default '' check (char_length(needed_by) <= 80),
  delivery    boolean not null default false,
  address     text not null default '' check (char_length(address) <= 300),
  message     text not null check (char_length(message) between 5 and 2000),
  handled     boolean not null default false
);

alter table public.inquiries enable row level security;

drop policy if exists "site can send inquiries" on public.inquiries;
create policy "site can send inquiries" on public.inquiries
  for insert to anon
  with check (handled = false);

-- ponytail: no rate limit or email alert; add an Edge Function (captcha, notify) when needed.
