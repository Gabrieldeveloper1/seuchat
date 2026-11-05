-- Limite atômico por identidade autenticada. Somente a função de servidor pode usá-lo.
create table if not exists public.nodia_quota (
  user_id text primary key references public.identities(user_id) on delete cascade,
  window_start timestamptz not null default now(),
  uses integer not null default 0
);
alter table public.nodia_quota enable row level security;
revoke all on public.nodia_quota from public, anon, authenticated;
create or replace function public.take_nodia_quota(p_user text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.nodia_quota as q (user_id, window_start, uses) values (p_user, now(), 1)
  on conflict (user_id) do update set
    window_start = case when q.window_start <= now() - interval '1 minute' then now() else q.window_start end,
    uses = case when q.window_start <= now() - interval '1 minute' then 1 else q.uses + 1 end
  where q.window_start <= now() - interval '1 minute' or q.uses < 8
  returning uses into n;
  return n is not null;
end; $$;
revoke all on function public.take_nodia_quota(text) from public, anon, authenticated;
grant execute on function public.take_nodia_quota(text) to service_role;
