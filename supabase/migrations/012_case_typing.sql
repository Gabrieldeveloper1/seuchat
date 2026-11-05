-- Indicador temporário; apenas a função de atendimento acessa esta tabela.
create table if not exists public.case_typing (report_id uuid primary key references public.reports(id) on delete cascade, typing_until timestamptz not null);
alter table public.case_typing enable row level security;
revoke all on public.case_typing from public, anon, authenticated;
grant select,insert,update,delete on public.case_typing to service_role;
create or replace function public.take_case_quota(p_user text) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer; begin
 insert into case_quota as q(user_id,window_start,uses) values(p_user,now(),1)
 on conflict(user_id) do update set window_start=case when q.window_start <= now()-interval '1 minute' then now() else q.window_start end,
 uses=case when q.window_start <= now()-interval '1 minute' then 1 else q.uses+1 end
 where q.window_start <= now()-interval '1 minute' or q.uses<60 returning uses into n;
 return n is not null;
end $$;
revoke all on function public.take_case_quota(text) from public, anon, authenticated;
grant execute on function public.take_case_quota(text) to service_role;
