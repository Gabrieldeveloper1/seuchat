-- 002: consulta de identidade sem enumeração + Realtime na fila de relay

-- Remove a leitura aberta da tabela (permitiria listar todos os usuários)
drop policy if exists identities_read on public.identities;

-- Consulta pontual por ID: só devolve chaves PÚBLICAS de quem não está banido
create or replace function public.get_identity(target_user text)
returns table (identity_key bytea, signed_prekey bytea, signed_prekey_sig bytea)
language sql stable security definer set search_path = public as $$
  select i.identity_key, i.signed_prekey, i.signed_prekey_sig
  from identities i
  where i.user_id = target_user and i.banned_at is null
$$;

revoke all on function public.get_identity(text) from public, anon;
grant execute on function public.get_identity(text) to authenticated;

-- Realtime: o destinatário recebe aviso de nova mensagem (a RLS continua valendo)
do $$
begin
  alter publication supabase_realtime add table public.relay_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
