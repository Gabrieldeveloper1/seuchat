-- Canal restrito de atendimento. Mensagens são cifradas em repouso pelo servidor,
-- não são criptografia ponta a ponta. Apenas Edge Function (service_role) acessa.
create table if not exists public.case_messages (
 id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade,
 sender_id text not null references public.identities(user_id), sender_role text not null check(sender_role in ('reporter','admin')),
 body_ciphertext bytea not null, proof_id text not null, created_at timestamptz not null default now(), unique(sender_id,proof_id)
);
create index if not exists case_messages_report_created on public.case_messages(report_id,created_at);
alter table public.case_messages enable row level security;
revoke all on public.case_messages from public,anon,authenticated;
create table if not exists public.case_attendance (
 report_id uuid primary key references public.reports(id) on delete cascade, active_until timestamptz not null
);
alter table public.case_attendance enable row level security;
revoke all on public.case_attendance from public,anon,authenticated;
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
