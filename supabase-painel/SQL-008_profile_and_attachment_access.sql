-- Perfil cifrado: a função é a única forma de acesso; o servidor não recebe a chave.
create table if not exists public.profile_snapshots (
  user_id text primary key references public.identities(user_id) on delete cascade,
  revision bigint not null check (revision > 0),
  nonce text not null check (length(nonce) <= 64),
  ciphertext text not null check (length(ciphertext) <= 260000),
  updated_at timestamptz not null default now()
);
alter table public.profile_snapshots enable row level security;
-- CAS transacional: duas gravações concorrentes nunca se sobrepõem silenciosamente.
create or replace function public.save_profile_snapshot(p_user text, p_expected bigint, p_nonce text, p_ciphertext text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user, 0));
  select revision into v_revision from profile_snapshots where user_id = p_user;
  if coalesce(v_revision, 0) <> p_expected then return 0; end if;
  v_revision := coalesce(v_revision, 0) + 1;
  insert into profile_snapshots(user_id, revision, nonce, ciphertext, updated_at)
  values (p_user, v_revision, p_nonce, p_ciphertext, now())
  on conflict(user_id) do update set revision = excluded.revision, nonce = excluded.nonce, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at;
  return v_revision;
end $$;
revoke all on function public.save_profile_snapshot(text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.save_profile_snapshot(text,bigint,text,text) to service_role;

-- Só dono e destinatários explicitamente registrados podem pedir URL de download.
create table if not exists public.attachment_recipients (
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  user_id text not null references public.identities(user_id) on delete cascade,
  primary key(attachment_id, user_id)
);
create index if not exists attachment_recipients_user on public.attachment_recipients(user_id);
alter table public.attachment_recipients enable row level security;
