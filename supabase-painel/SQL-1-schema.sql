-- SeuChatSeguro: migração inicial (Supabase / Postgres)
-- O servidor só guarda chaves públicas, texto cifrado e metadados mínimos.
-- O JWT é emitido pela Edge Function de login (claim "sub" = user_id).

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- Helper: user_id vindo do JWT customizado
create or replace function public.current_user_id()
returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

-- ---------------------------------------------------------------
-- 1. Identidades (apenas chaves públicas)
-- ---------------------------------------------------------------
create table public.identities (
  user_id            text primary key check (user_id ~ '^[a-z2-7]{26}$'),  -- base32 de 16 bytes do hash da chave
  identity_key       bytea not null check (octet_length(identity_key) = 32),    -- Ed25519 pública
  signed_prekey      bytea not null check (octet_length(signed_prekey) = 32),   -- X25519 pública
  signed_prekey_sig  bytea not null check (octet_length(signed_prekey_sig) = 64),
  attestation_hash   text,          -- hash salgado do token App Attest / Play Integrity
  created_at         timestamptz not null default now(),
  banned_at          timestamptz
);

create table public.one_time_prekeys (
  id        bigserial primary key,
  user_id   text not null references public.identities(user_id) on delete cascade,
  prekey    bytea not null check (octet_length(prekey) = 32)
);
create index on public.one_time_prekeys (user_id);

-- ---------------------------------------------------------------
-- 2. Fila de relay (apagada na entrega)
-- ---------------------------------------------------------------
create table public.relay_messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     text not null references public.identities(user_id) on delete cascade,
  recipient_id  text not null references public.identities(user_id) on delete cascade,
  ciphertext    bytea not null check (octet_length(ciphertext) <= 262144),   -- 256 KB
  -- Franking (ver edge function report-verify)
  franking_tag  bytea not null check (octet_length(franking_tag) = 32),
  server_mac    bytea not null check (octet_length(server_mac) = 32),
  sender_sig    bytea not null check (octet_length(sender_sig) = 64),
  sent_at       bigint not null,                                  -- ms epoch, definido pelo servidor
  expires_at    timestamptz not null default now() + interval '30 days'
);
create index on public.relay_messages (recipient_id, sent_at);
create index on public.relay_messages (expires_at);

-- ---------------------------------------------------------------
-- 3. Denúncias, bans, tokens de push
-- ---------------------------------------------------------------
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   text not null,
  reported_id   text not null,
  category      text not null check (category in ('csam','harassment','spam','other')),
  evidence      bytea not null,          -- evidência cifrada com a chave pública da moderação
  verified      boolean not null default false,
  status        text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  created_at    timestamptz not null default now(),
  -- Evidência de CSAM NÃO entra no fluxo de limpeza automática
  legal_hold    boolean not null default false
);

create table public.bans (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null,
  attestation_hash  text,
  reason            text not null,
  report_id         uuid references public.reports(id),
  created_at        timestamptz not null default now()
);
create index on public.bans (attestation_hash);

create table public.push_tokens (
  user_id   text not null references public.identities(user_id) on delete cascade,
  platform  text not null check (platform in ('ios','android','web')),
  token     text not null,
  primary key (user_id, token)
);

create table public.audit_log (          -- trilha de auditoria da moderação
  id bigserial primary key,
  actor text not null,
  action text not null,
  target text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------
alter table public.identities       enable row level security;
alter table public.one_time_prekeys enable row level security;
alter table public.relay_messages   enable row level security;
alter table public.reports          enable row level security;
alter table public.bans             enable row level security;
alter table public.push_tokens      enable row level security;
alter table public.audit_log        enable row level security;

-- identities: chaves públicas legíveis por usuários autenticados; ninguém escreve direto
-- (registro e rotação passam por Edge Functions com service_role)
create policy identities_read on public.identities
  for select to authenticated using (banned_at is null);

-- one_time_prekeys: o dono repõe os seus; ninguém lê direto (consumo via função abaixo)
create policy otpk_insert_own on public.one_time_prekeys
  for insert to authenticated with check (user_id = public.current_user_id());

-- relay_messages: destinatário lê e apaga; ENVIO só via Edge Function send-message
create policy relay_read_recipient on public.relay_messages
  for select to authenticated using (recipient_id = public.current_user_id());
create policy relay_delete_recipient on public.relay_messages
  for delete to authenticated using (recipient_id = public.current_user_id());

-- push_tokens: o dono gerencia os seus
create policy push_own on public.push_tokens
  for all to authenticated
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- reports, bans, audit_log: sem policies = nenhum acesso do cliente (só service_role)

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------
-- 5. Consumo atômico de one-time prekey (X3DH)
-- ---------------------------------------------------------------
create or replace function public.claim_prekey_bundle(target_user text)
returns table (
  identity_key bytea, signed_prekey bytea, signed_prekey_sig bytea, one_time_prekey bytea
)
language plpgsql security definer set search_path = public as $$
declare
  claimed_id bigint;
  claimed_key bytea;
begin
  select o.id, o.prekey into claimed_id, claimed_key
  from one_time_prekeys o
  where o.user_id = target_user
  order by o.id
  for update skip locked
  limit 1;

  if claimed_id is not null then
    delete from one_time_prekeys where id = claimed_id;
  end if;

  return query
    select i.identity_key, i.signed_prekey, i.signed_prekey_sig, claimed_key
    from identities i
    where i.user_id = target_user and i.banned_at is null;
end $$;

revoke all on function public.claim_prekey_bundle(text) from public, anon;
grant execute on function public.claim_prekey_bundle(text) to authenticated;

-- ---------------------------------------------------------------
-- 6. Limpeza automática (mensagens não entregues após 30 dias)
-- ---------------------------------------------------------------
select cron.schedule(
  'purge-expired-relay',
  '*/15 * * * *',
  $$ delete from public.relay_messages where expires_at < now() $$
);

-- Denúncias comuns antigas e sem legal_hold podem ser expiradas; as com legal_hold, nunca.
select cron.schedule(
  'purge-old-reports',
  '0 3 * * *',
  $$ delete from public.reports
     where legal_hold = false and status in ('dismissed','actioned')
       and created_at < now() - interval '180 days' $$
);
