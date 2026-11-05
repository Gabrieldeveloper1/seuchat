-- Anexos (vídeos, arquivos e áudios longos).
-- O conteúdo é cifrado no aparelho antes do envio: o servidor guarda apenas bytes ilegíveis.
-- A chave viaja dentro da mensagem cifrada de ponta a ponta.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400) -- 25 MB
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null references public.identities(user_id) on delete cascade,
  size        bigint not null check (size > 0 and size <= 26214400),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);
create index if not exists attachments_owner_created on public.attachments (owner_id, created_at);
create index if not exists attachments_expires on public.attachments (expires_at);

-- Sem políticas: só as Edge Functions (service role) leem ou gravam.
alter table public.attachments enable row level security;
