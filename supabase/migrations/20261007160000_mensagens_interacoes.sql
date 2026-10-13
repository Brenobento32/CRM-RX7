-- ===========================================================================
-- Camada de interações da conversa WhatsApp: responder, encaminhar, excluir
-- (pra mim) e reações — tudo CRM-only nesta fase (delivery/Signal do
-- whatsapp-service está pausado pela restrição de 24h; nada aqui chama
-- Baileys nem altera o ciclo pendente→enviando→enviado/falhou).
--
-- Responder e Encaminhar são colunas em `mensagens`, preenchidas só no
-- INSERT de uma mensagem nova — a policy `mensagens_insert` já cobre
-- qualquer coluna nova nullable, sem precisar de alteração. Excluir-pra-mim
-- e Reações são tabelas próprias, cada uma com a RLS mais estreita possível
-- (nunca um UPDATE/DELETE amplo em `mensagens`).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- mensagens: responder (com snapshot) e encaminhar
--
-- `resposta_a_id` é só pra "clique leva à mensagem original" (localizar no
-- array já carregado, nunca uma query nova — ver PainelConversa). O preview
-- em si (tipo/conteúdo/direção) é um SNAPSHOT tirado no momento da resposta,
-- porque a mensagem original pode mais tarde ser excluída (pra quem a
-- excluiu) ou estar fora da página atualmente carregada — o snapshot nunca
-- depende de nenhuma das duas coisas. `resposta_a_direcao` entra além do que
-- foi pedido (resposta_a_tipo/resposta_a_conteudo) só pra decidir "Você" vs.
-- nome do cliente no preview sem precisar de outra coluna/join.
-- ---------------------------------------------------------------------------
alter table public.mensagens
  add column resposta_a_id uuid references public.mensagens (id) on delete set null,
  add column resposta_a_tipo public.tipo_mensagem,
  add column resposta_a_conteudo text,
  add column resposta_a_direcao public.direcao_mensagem,
  add column encaminhada_de_id uuid references public.mensagens (id) on delete set null;

comment on column public.mensagens.resposta_a_id is
  'Referência pra "ir até a mensagem original" — null se a original foi excluída (on delete set null) ou a mensagem nunca foi uma resposta.';
comment on column public.mensagens.resposta_a_tipo is
  'Snapshot do tipo da mensagem original no momento da resposta — sobrevive à exclusão/paginação da original.';
comment on column public.mensagens.resposta_a_conteudo is
  'Snapshot do texto/legenda (ou rótulo genérico tipo "Imagem" pra mídia sem legenda) no momento da resposta.';
comment on column public.mensagens.resposta_a_direcao is
  'Snapshot da direção da original — só pra decidir "Você" vs. nome do cliente no preview, sem precisar de outra consulta.';
comment on column public.mensagens.encaminhada_de_id is
  'Mensagem de origem quando esta foi criada por "Encaminhar" — só pra exibir a etiqueta "Encaminhada"; null se a origem foi excluída ou nunca foi um encaminhamento.';

-- ---------------------------------------------------------------------------
-- mensagem_reacoes — uma reação (emoji) por usuário por mensagem.
-- ---------------------------------------------------------------------------
create table public.mensagem_reacoes (
  id           uuid primary key default gen_random_uuid(),
  mensagem_id  uuid not null references public.mensagens (id) on delete cascade,
  usuario_id   uuid not null references public.profiles (id) on delete cascade,
  emoji        text not null check (length(btrim(emoji)) > 0),
  created_at   timestamptz not null default now(),
  unique (mensagem_id, usuario_id)
);

comment on table public.mensagem_reacoes is
  'Reação (emoji) de um usuário do CRM a uma mensagem — só interno ao CRM nesta fase, nunca sincronizado com o WhatsApp. unique(mensagem_id, usuario_id): escolher outro emoji substitui a reação anterior (upsert), igual ao comportamento do WhatsApp.';

-- Suporta o join mensagem_reacoes→mensagens (busca em lote por conversa) e o
-- "on delete cascade" quando uma mensagem é apagada — sem isso cada delete
-- em `mensagens` faria um scan sequencial pra achar reações órfãs.
create index mensagem_reacoes_mensagem_idx on public.mensagem_reacoes (mensagem_id);

alter table public.mensagem_reacoes enable row level security;

create policy mensagem_reacoes_select on public.mensagem_reacoes
  for select to authenticated
  using (
    exists (
      select 1 from public.mensagens m
        join public.conversas cv on cv.id = m.conversa_id
      where m.id = mensagem_reacoes.mensagem_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id and c.owner_id = (select auth.uid())
          )
        )
    )
  );

create policy mensagem_reacoes_insert on public.mensagem_reacoes
  for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and exists (
      select 1 from public.mensagens m
        join public.conversas cv on cv.id = m.conversa_id
      where m.id = mensagem_reacoes.mensagem_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id and c.owner_id = (select auth.uid())
          )
        )
    )
  );

-- Upsert (trocar de emoji) é INSERT ... ON CONFLICT DO UPDATE — precisa de
-- UPDATE habilitado pro caminho de conflito, mesmo a UI só "trocando emoji".
-- Mesma regra de posse de `mensagem_reacoes_select`/`_insert` — sem isso,
-- um usuário continuaria podendo alterar a própria reação numa mensagem de
-- uma conversa que ele já não vê mais (ex.: cliente reatribuído a outro
-- closer), mais permissivo do que o resto do sistema.
create policy mensagem_reacoes_update on public.mensagem_reacoes
  for update to authenticated
  using (
    usuario_id = (select auth.uid())
    and exists (
      select 1 from public.mensagens m
        join public.conversas cv on cv.id = m.conversa_id
      where m.id = mensagem_reacoes.mensagem_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id and c.owner_id = (select auth.uid())
          )
        )
    )
  )
  with check (
    usuario_id = (select auth.uid())
    and exists (
      select 1 from public.mensagens m
        join public.conversas cv on cv.id = m.conversa_id
      where m.id = mensagem_reacoes.mensagem_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id and c.owner_id = (select auth.uid())
          )
        )
    )
  );

create policy mensagem_reacoes_delete on public.mensagem_reacoes
  for delete to authenticated
  using (usuario_id = (select auth.uid()));

revoke all on table public.mensagem_reacoes from anon;
grant select, insert, update, delete on table public.mensagem_reacoes to authenticated;

-- `REPLICA IDENTITY DEFAULT` (a padrão) só manda a PK (`id`) no `old` record
-- de UPDATE/DELETE via Realtime — o listener de DELETE no `PainelConversa`
-- precisa de `mensagem_id`/`usuario_id` em `payload.old` pra saber qual
-- reação remover da tela quando alguém tira a própria reação em outra
-- sessão. `FULL` manda a linha inteira antes da mudança, não só a PK.
alter table public.mensagem_reacoes replica identity full;

alter publication supabase_realtime add table public.mensagem_reacoes;

-- ---------------------------------------------------------------------------
-- mensagem_exclusoes — "excluir pra mim": por usuário, nunca apaga a linha
-- original nem afeta quem mais vê a mesma conversa (gerente, outro closer
-- com acesso). A consulta de mensagens (DAL) filtra por uma VIEW que exclui
-- o que o usuário atual marcou — nunca um UPDATE em `mensagens`.
-- ---------------------------------------------------------------------------
create table public.mensagem_exclusoes (
  mensagem_id  uuid not null references public.mensagens (id) on delete cascade,
  usuario_id   uuid not null references public.profiles (id) on delete cascade,
  deleted_at   timestamptz not null default now(),
  primary key (mensagem_id, usuario_id)
);

comment on table public.mensagem_exclusoes is
  '"Excluir pra mim" — oculta a mensagem só pra quem excluiu, nunca pra quem mais acompanha a conversa. A chave primária composta já serve de índice pra "esta mensagem está oculta pra este usuário?" (ver mensagens_visiveis, abaixo) sem precisar de índice extra.';

alter table public.mensagem_exclusoes enable row level security;

create policy mensagem_exclusoes_select on public.mensagem_exclusoes
  for select to authenticated
  using (usuario_id = (select auth.uid()));

create policy mensagem_exclusoes_insert on public.mensagem_exclusoes
  for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and exists (
      select 1 from public.mensagens m
        join public.conversas cv on cv.id = m.conversa_id
      where m.id = mensagem_exclusoes.mensagem_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id and c.owner_id = (select auth.uid())
          )
        )
    )
  );

create policy mensagem_exclusoes_delete on public.mensagem_exclusoes
  for delete to authenticated
  using (usuario_id = (select auth.uid()));

revoke all on table public.mensagem_exclusoes from anon;
grant select, insert, delete on table public.mensagem_exclusoes to authenticated;

-- Nunca entra no supabase_realtime de propósito: exclusão é só local (a UI
-- já remove a mensagem da própria tela assim que a Action confirma), nunca
-- precisa de broadcast pra ninguém.

-- ---------------------------------------------------------------------------
-- View usada no lugar de `mensagens` pelas duas leituras paginadas da DAL
-- (carga inicial e "mensagens anteriores") — nunca pelos INSERTs de envio,
-- que continuam direto na tabela. `security_invoker` faz a view rodar com o
-- papel/RLS de quem está consultando (preserva mensagens_select de verdade,
-- e `auth.uid()` dentro da view resolve pro usuário real da sessão) — sem
-- isso, filtrar "o que ESTE usuário excluiu" dentro de uma view exigiria uma
-- policy própria pra view, redundante com a de `mensagens`. NOT EXISTS
-- correlacionado usa a mesma PK composta de `mensagem_exclusoes`
-- (mensagem_id, usuario_id) como índice — sem custo extra de leitura por
-- mensagem, mesmo em conversas longas.
-- ---------------------------------------------------------------------------
create view public.mensagens_visiveis
  with (security_invoker = true)
  as
  select m.*
  from public.mensagens m
  where not exists (
    select 1 from public.mensagem_exclusoes me
    where me.mensagem_id = m.id
      and me.usuario_id = (select auth.uid())
  );

comment on view public.mensagens_visiveis is
  'Mesmas linhas de `mensagens`, exceto as que o usuário atual marcou como "excluir pra mim" (ver mensagem_exclusoes). security_invoker: RLS de `mensagens_select` continua valendo por baixo, isto só soma o filtro de exclusão pessoal. Usada só pelas leituras do PainelConversa — nunca pelo whatsapp-service (service_role já ignora RLS e views security_invoker, não precisa e não deve passar por aqui).';

grant select on public.mensagens_visiveis to authenticated;
