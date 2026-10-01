-- ===========================================================================
-- WhatsApp — fase 1: somente RECEBER mensagens.
--
-- Só o schema para o `whatsapp-service` (processo Node separado, fora do
-- Next.js) gravar o que chega do WhatsApp. Nada aqui cria negociação, cliente
-- ("lead") ou envia mensagem — isso é fase futura.
--
--   whatsapp_conexoes — status da única conexão (1 WhatsApp por empresa).
--                       Linha única de convenção: o whatsapp-service sempre
--                       faz upsert no id fixo `00000000-0000-0000-0000-000000000001`.
--                       Sem credencial nenhuma aqui — a sessão do Baileys
--                       fica em disco no próprio serviço.
--   conversas         — uma por telefone. `cliente_id` é preenchido só se já
--                       existir um cadastro com esse telefone/whatsapp;
--                       nunca cria cliente.
--   mensagens         — uma linha por mensagem. Nesta fase só `direcao =
--                       'entrada'` é gravada; a coluna já cobre 'saida' para
--                       não exigir outra migration quando o envio existir.
--
-- Escrita só pela `service_role`, que o whatsapp-service usa — nunca o
-- Next.js (mesma regra do `agenda-google`/`admin-usuarios`: RLS aqui só
-- autoriza LEITURA para authenticated; nenhuma policy de INSERT/UPDATE/DELETE
-- é criada para authenticated, então só a service_role escreve).
-- ===========================================================================

create type public.status_conexao_whatsapp as enum ('desconectado', 'conectando', 'conectado');
create type public.direcao_mensagem        as enum ('entrada', 'saida');
create type public.tipo_mensagem           as enum ('texto', 'imagem', 'documento', 'audio', 'video');

-- ---------------------------------------------------------------------------
-- whatsapp_conexoes
-- ---------------------------------------------------------------------------
create table public.whatsapp_conexoes (
  id            uuid primary key default gen_random_uuid(),
  numero        text,
  status        public.status_conexao_whatsapp not null default 'desconectado',
  conectado_em  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.whatsapp_conexoes is
  'Status da conexão WhatsApp da empresa (1 número). Linha única — o '
  'whatsapp-service faz upsert sempre no mesmo id. Sem credencial: a sessão '
  'do Baileys fica em disco no próprio serviço, não no banco.';

create trigger whatsapp_conexoes_set_updated_at
  before update on public.whatsapp_conexoes
  for each row
  execute function public.set_updated_at();

alter table public.whatsapp_conexoes enable row level security;

create policy whatsapp_conexoes_select on public.whatsapp_conexoes
  for select to authenticated
  using (true);

revoke all on table public.whatsapp_conexoes from anon;
grant select on table public.whatsapp_conexoes to authenticated;

-- ---------------------------------------------------------------------------
-- conversas
-- ---------------------------------------------------------------------------
create table public.conversas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid references public.clientes (id) on delete set null,
  telefone            text not null check (telefone ~ '^[0-9]{10,13}$'),
  ultima_mensagem_em  timestamptz,
  created_at          timestamptz not null default now()
);

comment on table public.conversas is
  'Uma conversa por telefone do WhatsApp. cliente_id só é preenchido quando '
  'já existe um cadastro com esse telefone/whatsapp — esta tabela NUNCA cria '
  'cliente.';

create unique index conversas_telefone_unica on public.conversas (telefone);
create index conversas_cliente_idx on public.conversas (cliente_id) where cliente_id is not null;

alter table public.conversas enable row level security;

-- Mesma regra de clientes/negociações: gerente vê tudo; closer só a conversa
-- de um cliente que já é dele. Conversa sem cliente vinculado (telefone
-- desconhecido) só aparece para gerente.
create policy conversas_select on public.conversas
  for select to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.clientes c
      where c.id = conversas.cliente_id
        and c.owner_id = (select auth.uid())
    )
  );

revoke all on table public.conversas from anon;
grant select on table public.conversas to authenticated;

-- ---------------------------------------------------------------------------
-- mensagens
-- ---------------------------------------------------------------------------
create table public.mensagens (
  id                   uuid primary key default gen_random_uuid(),
  conversa_id          uuid not null references public.conversas (id) on delete cascade,
  direcao              public.direcao_mensagem not null,
  tipo                 public.tipo_mensagem not null default 'texto',
  conteudo             text,
  whatsapp_message_id  text,
  created_at           timestamptz not null default now()
);

comment on table public.mensagens is
  'Uma linha por mensagem de WhatsApp. Fase 1: só direcao=entrada é gravada '
  'pelo whatsapp-service. saida existe no enum para não exigir outra '
  'migration quando o envio for implementado.';
comment on column public.mensagens.whatsapp_message_id is
  'Id da mensagem no WhatsApp (msg.key.id) — usado só para deduplicar '
  'reentregas do Baileys; sem garantia de unicidade forte nesta fase.';

create index mensagens_conversa_idx on public.mensagens (conversa_id, created_at);
create index mensagens_whatsapp_id_idx on public.mensagens (whatsapp_message_id) where whatsapp_message_id is not null;

alter table public.mensagens enable row level security;

create policy mensagens_select on public.mensagens
  for select to authenticated
  using (
    exists (
      select 1 from public.conversas cv
      where cv.id = mensagens.conversa_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id
              and c.owner_id = (select auth.uid())
          )
        )
    )
  );

revoke all on table public.mensagens from anon;
grant select on table public.mensagens to authenticated;
