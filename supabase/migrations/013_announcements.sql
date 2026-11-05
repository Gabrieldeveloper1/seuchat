-- Comunicados públicos do aplicativo: apenas a Edge Function com service_role acessa.
create table if not exists public.global_announcements (
 id uuid primary key default gen_random_uuid(),
 title text not null check (char_length(title) between 1 and 80),
 body text not null check (char_length(body) between 1 and 500),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 author_id text not null references public.identities(user_id)
);
create index if not exists global_announcements_active_idx on public.global_announcements (created_at desc) where revoked_at is null;
alter table public.global_announcements enable row level security;
revoke all on public.global_announcements from public, anon, authenticated;
grant select,insert,update on public.global_announcements to service_role;
create table if not exists public.announcement_quota (
 user_id text primary key references public.identities(user_id) on delete cascade,
 window_start timestamptz not null default now(), uses integer not null default 0
);
alter table public.announcement_quota enable row level security;
revoke all on public.announcement_quota from public, anon, authenticated;
create or replace function public.take_announcement_quota(p_user text) returns boolean
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into public.announcement_quota as q (user_id,window_start,uses) values (p_user,now(),1)
 on conflict(user_id) do update set
  window_start=case when q.window_start<=now()-interval '1 minute' then now() else q.window_start end,
  uses=case when q.window_start<=now()-interval '1 minute' then 1 else q.uses+1 end
 where q.window_start<=now()-interval '1 minute' or q.uses<5 returning uses into n;
 return n is not null;
end; $$;
revoke all on function public.take_announcement_quota(text) from public, anon, authenticated;
grant execute on function public.take_announcement_quota(text) to service_role;
