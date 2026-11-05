-- Denúncias não são prova de violação. Decisões e apelações são atômicas e humanas.
create table if not exists public.report_appeals (
 id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade,
 appellant_id text not null references public.identities(user_id) on delete cascade,
 appellant_role text not null check (appellant_role in ('reporter','reported')),
 reason text not null check (reason in ('mistake','context','other')),
 note_ciphertext bytea not null,
 status text not null default 'open' check (status in ('open','accepted','rejected')),
 created_at timestamptz not null default now(), decided_at timestamptz, decided_by text,
 unique(report_id,appellant_id)
);
alter table public.report_appeals enable row level security;
revoke all on public.report_appeals from public, anon, authenticated;
create table if not exists public.case_quota (user_id text primary key references public.identities(user_id) on delete cascade, window_start timestamptz not null, uses integer not null);
alter table public.case_quota enable row level security;
revoke all on public.case_quota from public, anon, authenticated;
create or replace function public.take_case_quota(p_user text) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer; begin
 insert into case_quota as q(user_id,window_start,uses) values(p_user,now(),1)
 on conflict(user_id) do update set window_start=case when q.window_start <= now()-interval '1 minute' then now() else q.window_start end,
 uses=case when q.window_start <= now()-interval '1 minute' then 1 else q.uses+1 end
 where q.window_start <= now()-interval '1 minute' or q.uses<20 returning uses into n;
 return n is not null;
end $$;
revoke all on function public.take_case_quota(text) from public, anon, authenticated;
grant execute on function public.take_case_quota(text) to service_role;

create or replace function public.review_report(p_id uuid,p_action text,p_actor text) returns text language plpgsql security definer set search_path=public as $$
declare r reports%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into r from reports where id=p_id for update;
 if not found then return 'not_found'; end if;
 if r.status in ('actioned','dismissed') then return 'already'; end if;
 if p_action='review' then
   if r.status='open' then update reports set status='reviewing' where id=p_id; insert into audit_log(actor,action,target) values(p_actor,'report_reviewing',p_id::text); end if;
   return 'reviewing';
 end if;
 if p_action not in ('approve','reject') then return 'invalid'; end if;
 if p_action='approve' and (r.category <> 'csam' or not r.verified) then return 'scope'; end if;
 if p_action='approve' then
   insert into bans(user_id,reason,report_id) select r.reported_id,'report_approved:csam',p_id where not exists(select 1 from bans where report_id=p_id);
   update identities set banned_at=coalesce(banned_at,now()) where user_id=r.reported_id;
   update reports set status='actioned',decided_by=p_actor,decided_at=now() where id=p_id;
 else
   delete from bans where report_id=p_id;
   if not exists(select 1 from bans where user_id=r.reported_id) then update identities set banned_at=null where user_id=r.reported_id; end if;
   update reports set status='dismissed',decided_by=p_actor,decided_at=now() where id=p_id;
 end if;
 insert into audit_log(actor,action,target) values(p_actor,case when p_action='approve' then 'report_approved' else 'report_rejected' end,p_id::text);
 return case when p_action='approve' then 'actioned' else 'dismissed' end;
end $$;
revoke all on function public.review_report(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_report(uuid,text,text) to service_role;

create or replace function public.review_appeal(p_id uuid,p_action text,p_actor text) returns text language plpgsql security definer set search_path=public as $$
declare a report_appeals%rowtype; r reports%rowtype; begin
 select * into a from report_appeals where id=p_id;
 if not found then return 'not_found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.report_id::text,0));
 select * into a from report_appeals where id=p_id for update;
 select * into r from reports where id=a.report_id for update;
 if a.status <> 'open' then return 'already'; end if;
 -- Um único administrador pode decidir apelações; não há revisão independente.

 if p_action not in ('accept','reject') then return 'invalid'; end if;
 if p_action='accept' then
   if a.appellant_role='reported' then
     if r.status <> 'actioned' then return 'stale'; end if;
     delete from bans where report_id=r.id;
     if not exists(select 1 from bans where user_id=r.reported_id) then update identities set banned_at=null where user_id=r.reported_id; end if;
     update reports set status='dismissed',decided_by=p_actor,decided_at=now() where id=r.id;
   else
     if r.status <> 'dismissed' then return 'stale'; end if;
     update reports set status='reviewing',decided_by=null,decided_at=null where id=r.id;
   end if;
 end if;
 update report_appeals set status=case when p_action='accept' then 'accepted' else 'rejected' end,decided_by=p_actor,decided_at=now() where id=p_id;
 insert into audit_log(actor,action,target) values(p_actor,case when p_action='accept' then 'appeal_accepted' else 'appeal_rejected' end,p_id::text);
 return case when p_action='accept' then 'accepted' else 'rejected' end;
end $$;
revoke all on function public.review_appeal(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_appeal(uuid,text,text) to service_role;
