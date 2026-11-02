-- 003: diretório de telefones (opcional) para achar contatos pelo número, estilo WhatsApp.
-- Guardamos só HMAC(pepper, número E.164); o número em si não fica no servidor.
create table if not exists public.phone_directory (
  phone_hash  bytea primary key check (octet_length(phone_hash) = 32),
  user_id     text not null unique references public.identities(user_id) on delete cascade,
  verified    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.phone_directory enable row level security;
-- sem policies: só as Edge Functions (service_role) leem e escrevem
revoke all on public.phone_directory from anon, authenticated;
