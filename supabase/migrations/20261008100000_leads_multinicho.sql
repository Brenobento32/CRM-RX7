-- ===========================================================================
-- Leads multi-nicho: arquivamento/reativação/exclusão de negociação, nicho +
-- formulário + perguntas/respostas genéricas, e a função que a Edge Function
-- `ingestao-lead` chama para dar entrada automática num lead vindo do
-- Google Sheets (via Google Apps Script). NADA aqui toca whatsapp-service,
-- auth_info_baileys, delivery/ACK/retry, Storage de WhatsApp ou o player de
-- áudio — só schema de CRM (clientes/negociações/funil) e a Edge Function de
-- ingestão, que é outro arquivo (supabase/functions/ingestao-lead/).
--
-- Ordem do arquivo:
--   1. Tipos novos (tipo_pergunta, origem_negociacao).
--   2. nichos / formularios / perguntas — catálogo, nunca DELETE físico de
--      pergunta; nicho/formulário só excluem se nunca usados (senão desativa).
--   3. respostas_lead — uma resposta por pergunta por negociação.
--   4. negociacoes: nicho_id/formulario_id/origem/external_id + ciclo de
--      arquivamento/exclusão (mesmo padrão 3 camadas de `clientes`, ver
--      20260930170000_clientes_exclusao.sql).
--   5. clientes.instagram.
--   6. criar_negociacao ganha p_origem; criar_cliente_whatsapp passa
--      p_origem := 'whatsapp' (senão todo lead de WhatsApp nasceria como
--      "manual" — regressão silenciosa que o pill verde do card não detectaria).
--   7. Etapa real "Lead Novo" no Funil Principal (idempotente) — formulário
--      e reativação passam a exigir essa etapa por nome, sem fallback.
--   8. ingerir_lead_formulario — upsert atômico cliente+negociação+respostas,
--      chamado só pela Edge Function (service_role).
--   9. funil_cards ganha nicho/origem/formulário e passa a esconder
--      negociação arquivada.
--  10. Dados iniciais: nicho "Instituição de Ensino" + o formulário/perguntas
--      reais que já existem hoje (ver docs/GOOGLE-APPS-SCRIPT-LEADS.md).
--
-- RLS de tudo que é novo entra junto de cada tabela (seção 2/3), não como
-- passo separado.
--
-- Decisão de arquitetura que fica registrada aqui: leads automáticos
-- (WhatsApp e, agora, formulário) continuam usando o MESMO responsável e
-- funil padrão já configurados em `whatsapp_conexoes` — uma única fonte de
-- verdade para "quem recebe lead automático", em vez de duplicar a
-- configuração numa tabela nova. Se um dia precisar de responsável/funil
-- diferentes por nicho, essa é a extensão natural (fora do escopo desta fase).
--
-- Exclusão permanente de negociação NUNCA é um DELETE físico: `fechamentos`,
-- `historico_etapas` e `negociacao_servicos` têm FK `on delete cascade` pra
-- `negociacoes` (confirmado por inspeção do schema) — um DELETE real
-- apagaria fechamento (venda) e histórico de etapas. Por isso "excluir
-- permanentemente" aqui é exatamente o mesmo soft delete com auditoria que
-- `clientes` já usa: `excluida_em`/`excluida_por`/`motivo_exclusao`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos novos.
-- ---------------------------------------------------------------------------
create type public.tipo_pergunta as enum ('texto_livre', 'escolha_unica', 'escolha_multipla');

create type public.origem_negociacao as enum ('whatsapp', 'formulario', 'manual');

-- ---------------------------------------------------------------------------
-- 2. nichos / formularios / perguntas.
--
-- `nichos.cor` reaproveita o enum `cor_etapa` (já usado pelas etapas do
-- funil) em vez de criar uma paleta nova — mesma convenção do projeto
-- ("paleta fixa, mapeada no app"), e já cobre laranja/azul/vermelho que o
-- pedido original usa como exemplo.
-- ---------------------------------------------------------------------------
create table public.nichos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) between 1 and 80),
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  cor         public.cor_etapa not null,
  ativo       boolean not null default true,
  ordem       numeric not null default 1000,
  created_at  timestamptz not null default now()
);

comment on table public.nichos is
  'Segmento de mercado do lead (Instituição de Ensino, Clínica, Ótica, …). '
  'Catálogo global — nunca por carteira. Cor decide a borda do card no Kanban.';
comment on column public.nichos.slug is
  'Identificador estável usado pelo payload da Edge Function de ingestão '
  '(nicho_slug) — nunca o nome, que pode ser editado.';

create unique index nichos_slug_unico on public.nichos (slug);
create unique index nichos_nome_ativo_unico on public.nichos (lower(btrim(nome))) where ativo;

create table public.formularios (
  id          uuid primary key default gen_random_uuid(),
  nicho_id    uuid not null references public.nichos (id) on delete restrict,
  nome        text not null check (length(btrim(nome)) between 1 and 120),
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.formularios is
  'Um formulário de captação dentro de um nicho. Um nicho pode ter mais de '
  'um formulário ao longo do tempo (nova versão de perguntas), sem afetar '
  'leads já capturados pela versão anterior.';
comment on column public.formularios.slug is
  'Identificador estável do payload da Edge Function (formulario_slug).';

create unique index formularios_slug_unico on public.formularios (slug);
create index formularios_nicho_idx on public.formularios (nicho_id);

create table public.perguntas (
  id             uuid primary key default gen_random_uuid(),
  formulario_id  uuid not null references public.formularios (id) on delete restrict,
  texto          text not null check (length(btrim(texto)) between 1 and 500),
  tipo           public.tipo_pergunta not null,
  opcoes         jsonb,
  ordem          numeric not null default 1000,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),

  -- texto_livre nunca tem opções; escolha_unica/escolha_multipla sempre têm
  -- um array (mesmo que de um item só) — nunca um objeto ou string solta.
  constraint perguntas_opcoes_por_tipo check (
    (tipo = 'texto_livre' and opcoes is null)
    or (tipo in ('escolha_unica', 'escolha_multipla') and jsonb_typeof(opcoes) = 'array')
  )
);

comment on table public.perguntas is
  'Pergunta de qualificação de um formulário. Nunca excluída fisicamente '
  '(sem policy/grant de DELETE) — perguntas antigas continuam referenciadas '
  'por respostas_lead de leads antigos; desativa-se com ativo = false.';
comment on column public.perguntas.texto is
  'Casado com `pergunta_externa` do payload de ingestão pelo texto exato '
  '(btrim) — é assim que o Apps Script mapeia o header da planilha pra esta '
  'pergunta, sem precisar de uma segunda chave externa.';

create index perguntas_formulario_idx on public.perguntas (formulario_id, ordem);

alter table public.nichos      enable row level security;
alter table public.formularios enable row level security;
alter table public.perguntas   enable row level security;

create policy nichos_select on public.nichos for select to authenticated using (true);
create policy nichos_insert on public.nichos for insert to authenticated with check (public.is_gerente());
create policy nichos_update on public.nichos for update to authenticated
  using (public.is_gerente()) with check (public.is_gerente());
create policy nichos_delete on public.nichos for delete to authenticated using (public.is_gerente());

create policy formularios_select on public.formularios for select to authenticated using (true);
create policy formularios_insert on public.formularios for insert to authenticated with check (public.is_gerente());
create policy formularios_update on public.formularios for update to authenticated
  using (public.is_gerente()) with check (public.is_gerente());
create policy formularios_delete on public.formularios for delete to authenticated using (public.is_gerente());

create policy perguntas_select on public.perguntas for select to authenticated using (true);
create policy perguntas_insert on public.perguntas for insert to authenticated with check (public.is_gerente());
create policy perguntas_update on public.perguntas for update to authenticated
  using (public.is_gerente()) with check (public.is_gerente());
-- Sem policy nem grant de DELETE: perguntas nunca são excluídas (ver comment acima).

revoke all on table public.nichos      from anon;
revoke all on table public.formularios from anon;
revoke all on table public.perguntas   from anon;
grant select, insert, update, delete on table public.nichos      to authenticated;
grant select, insert, update, delete on table public.formularios to authenticated;
grant select, insert, update          on table public.perguntas  to authenticated;

-- Nicho/formulário só excluem se nunca tiverem sido usados — mesma regra de
-- `etapas_funil_regras`/`funis_regras`: o que já foi usado se desativa.
create or replace function public.nichos_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.negociacoes n where n.nicho_id = old.id)
     or exists (select 1 from public.formularios f where f.nicho_id = old.id)
  then
    raise exception 'O nicho "%" já está em uso. Desative-o em vez de excluir.', old.nome
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger nichos_regras
  before delete on public.nichos
  for each row
  execute function public.nichos_regras();

create or replace function public.formularios_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.negociacoes n where n.formulario_id = old.id)
     or exists (select 1 from public.perguntas p where p.formulario_id = old.id)
  then
    raise exception 'O formulário "%" já está em uso. Desative-o em vez de excluir.', old.nome
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger formularios_regras
  before delete on public.formularios
  for each row
  execute function public.formularios_regras();

-- ---------------------------------------------------------------------------
-- 3. respostas_lead — uma linha por pergunta respondida por negociação.
--
-- `resposta_opcao` também guarda a resposta de `escolha_multipla`: múltiplas
-- opções marcadas entram como texto único (ex.: opções separadas por " | ").
-- Não existe hoje nenhuma pergunta desse tipo nos 3 formulários reais — o
-- tipo já está no enum para o dia em que existir, sem precisar de nova coluna.
-- ---------------------------------------------------------------------------
create table public.respostas_lead (
  id              uuid primary key default gen_random_uuid(),
  negociacao_id   uuid not null references public.negociacoes (id) on delete cascade,
  pergunta_id     uuid not null references public.perguntas (id) on delete restrict,
  resposta_texto  text,
  resposta_opcao  text,
  created_at      timestamptz not null default now(),

  unique (negociacao_id, pergunta_id),
  constraint respostas_lead_conteudo check (coalesce(resposta_texto, resposta_opcao) is not null)
);

comment on table public.respostas_lead is
  'Resposta de qualificação de uma negociação a uma pergunta de formulário. '
  'unique(negociacao_id, pergunta_id): reenvio da mesma pergunta substitui a '
  'resposta anterior (upsert), nunca duplica.';

create index respostas_lead_negociacao_idx on public.respostas_lead (negociacao_id);
create index respostas_lead_pergunta_idx   on public.respostas_lead (pergunta_id);

alter table public.respostas_lead enable row level security;

-- Mesma regra de posse de `negociacoes` (owner ou gerente), via
-- `negociacao_owner()` — já existe desde 20260923120400, SECURITY DEFINER,
-- sem passar pela RLS de negociacoes dentro da checagem.
create policy respostas_lead_select on public.respostas_lead
  for select to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy respostas_lead_insert on public.respostas_lead
  for insert to authenticated
  with check (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy respostas_lead_update on public.respostas_lead
  for update to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy respostas_lead_delete on public.respostas_lead
  for delete to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

revoke all on table public.respostas_lead from anon;
grant select, insert, update, delete on table public.respostas_lead to authenticated;

-- ---------------------------------------------------------------------------
-- 4. negociacoes: nicho/formulário/origem/external_id + ciclo de 3 camadas
-- (ativa / arquivada / excluída), espelhando exatamente
-- 20260930170000_clientes_exclusao.sql:
--   ativa      — arquivada_em is null
--   arquivada  — arquivada_em is not null and excluida_em is null
--   excluída   — excluida_em is not null
-- Só se exclui quem já está arquivada; restaurar uma excluída volta pra
-- arquivada — regra na DAL (lib/dal/negociacoes.ts), não aqui, mesmo padrão.
-- Motivo é obrigatório tanto pra arquivar (pedido explícito do fluxo
-- "Desqualificar lead" no Kanban) quanto pra excluir — diferente de
-- `clientes`, onde só a exclusão exige motivo.
-- ---------------------------------------------------------------------------
alter table public.negociacoes
  add column nicho_id            uuid references public.nichos (id) on delete set null,
  add column formulario_id       uuid references public.formularios (id) on delete set null,
  add column origem              public.origem_negociacao not null default 'manual',
  add column external_id         text,
  add column arquivada_em        timestamptz,
  add column motivo_arquivamento text,
  add column excluida_em         timestamptz,
  add column excluida_por        uuid references public.profiles (id) on delete set null,
  add column motivo_exclusao     text;

-- Backfill: toda negociação cujo cliente já tem uma conversa de WhatsApp
-- nasceu de lá (único jeito hoje de `conversas.cliente_id` ser preenchido é
-- `criar_cliente_whatsapp`). Sem isso, leads de WhatsApp já existentes
-- virariam "manual" pelo default da coluna — perderiam o indicador verde do
-- card sem nunca terem sido editados.
update public.negociacoes n
   set origem = 'whatsapp'
 where exists (
   select 1 from public.conversas cv where cv.cliente_id = n.cliente_id
 );

-- O UPDATE acima enfileira o constraint trigger deferido
-- `negociacoes_exige_fechamento` (dispara em QUALQUER update de
-- `negociacoes`, sem lista de colunas — ver 20260923120500_fechamentos.sql)
-- — e o Postgres não altera uma tabela com eventos pendentes (55006).
-- Dispara a checagem agora (não muda etapa_id, então a invariante "ganha tem
-- fechamento" já valia antes do UPDATE e continua valendo) e volta ao modo
-- deferido — mesma solução já usada em 20260923200000_etapas_funil.sql e em
-- 20260929120000_funis.sql.
set constraints all immediate;
set constraints all deferred;

alter table public.negociacoes
  add constraint negociacoes_motivo_arquivamento_obrigatorio
    check (arquivada_em is null or motivo_arquivamento is not null),
  add constraint negociacoes_motivo_exclusao_obrigatorio
    check (excluida_em is null or motivo_exclusao is not null);

comment on column public.negociacoes.arquivada_em is
  'Desqualificar lead (soft delete) — nunca apaga a negociação. RLS não '
  'filtra por esta coluna (igual a clientes.deleted_at); quem filtra é a '
  'view funil_cards (fora do Kanban) e a DAL (tela de Leads Arquivados).';
comment on column public.negociacoes.excluida_em is
  'Soft delete "definitivo" — nunca DELETE físico (fechamentos e '
  'historico_etapas cascateiam a partir de negociacoes; apagar de verdade '
  'destruiria histórico comercial). Exige já estar arquivada (regra na DAL) '
  'e motivo preenchido (constraint acima).';
comment on column public.negociacoes.external_id is
  'Identificador da fonte externa (linha/submissão do formulário) usado pra '
  'dedup — ver índice único (origem, external_id) abaixo. Null para leads '
  'manuais/WhatsApp.';

-- Mesmo external_id não cria duas negociações para a mesma origem — é a
-- idempotência que a Edge Function de ingestão depende.
create unique index negociacoes_origem_external_id_unico
  on public.negociacoes (origem, external_id)
  where external_id is not null;

create index negociacoes_nicho_idx on public.negociacoes (nicho_id);

-- Tela de Leads Arquivados: só as arquivadas-não-excluídas, por dono.
create index negociacoes_arquivadas_idx
  on public.negociacoes (owner_id, arquivada_em)
  where arquivada_em is not null and excluida_em is null;

-- RLS de negociacoes NÃO muda: arquivar/reativar/excluir são UPDATEs comuns,
-- já cobertos pela policy negociacoes_update (owner_id = auth.uid() ou
-- is_gerente()) criada em 20260923120400.

-- ---------------------------------------------------------------------------
-- 5. clientes.instagram — preserva todos os campos existentes, só soma um.
-- `criar_cliente` ganha p_instagram (default null, parâmetro novo no fim —
-- compatível com a chamada existente de `criarCliente` em lib/dal/clientes.ts
-- depois de somar o argumento lá).
-- ---------------------------------------------------------------------------
alter table public.clientes add column instagram text;

-- `create or replace function` só substitui quando a lista de tipos de
-- parâmetro é IDÊNTICA — como p_instagram é um 13º parâmetro novo, sem o
-- DROP abaixo isto criaria uma SEGUNDA função `criar_cliente` sobrecarregada
-- (coexistindo com a de 12 parâmetros já aplicada em 20260923130000/
-- 20260923200000), e o `comment on function` mais abaixo ficaria ambíguo
-- entre as duas (42725) — foi exatamente o que aconteceu na primeira
-- tentativa de aplicar esta migration. Sem CASCADE: a única coisa que
-- dependeria desta assinatura exata seria outra função chamando-a
-- positionalmente, o que não é o caso em nenhum lugar do código.
drop function if exists public.criar_cliente(
  public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, uuid
);

create or replace function public.criar_cliente(
  p_tipo_cliente public.tipo_cliente,
  p_nome         text,
  p_empresa      text default null,
  p_cpf          text default null,
  p_cnpj         text default null,
  p_telefone     text default null,
  p_whatsapp     text default null,
  p_email        text default null,
  p_responsavel  text default null,
  p_cargo        text default null,
  p_observacoes  text default null,
  p_owner_id     uuid default null,
  p_instagram    text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_cliente_id uuid;
begin
  insert into public.clientes (
    tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
    responsavel, cargo, observacoes, owner_id, instagram
  )
  values (
    p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone, p_whatsapp,
    p_email, p_responsavel, p_cargo, p_observacoes,
    coalesce(p_owner_id, (select auth.uid())), p_instagram
  )
  returning id into v_cliente_id;

  insert into public.negociacoes (cliente_id, owner_id, etapa_id)
  values (
    v_cliente_id,
    coalesce(p_owner_id, (select auth.uid())),
    public.etapa_id_por_chave('reuniao_agendada')
  );

  return v_cliente_id;
end;
$$;

comment on function public.criar_cliente is
  'Cria o cliente e a negociação inicial (reuniao_agendada) na mesma transação. p_instagram opcional.';

-- ---------------------------------------------------------------------------
-- 6. criar_negociacao ganha p_origem (default 'manual', compatível com as
-- chamadas existentes); criar_cliente_whatsapp passa 'whatsapp' explicitamente.
--
-- Mesmo motivo do DROP acima: p_origem é um 5º parâmetro novo, então sem o
-- DROP da assinatura de 4 parâmetros (20260929120000) ficaríamos com duas
-- funções `criar_negociacao` sobrecarregadas. Sem CASCADE.
-- ---------------------------------------------------------------------------
drop function if exists public.criar_negociacao(
  uuid, uuid, numeric, public.temperatura_negociacao
);

create or replace function public.criar_negociacao(
  p_cliente_id      uuid,
  p_funil_id        uuid,
  p_valor_estimado  numeric default null,
  p_temperatura     public.temperatura_negociacao default null,
  p_origem          public.origem_negociacao default 'manual'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_negociacao_id uuid;
  v_etapa_id      uuid;
begin
  if not exists (select 1 from public.clientes c where c.id = p_cliente_id and c.deleted_at is null) then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.funis f where f.id = p_funil_id and f.ativo) then
    raise exception 'Funil não encontrado ou desativado.' using errcode = 'P0002';
  end if;

  select e.id into v_etapa_id
    from public.etapas_funil e
   where e.funil_id = p_funil_id
     and e.tipo = 'aberta'
     and e.ativo
   order by e.ordem
   limit 1;

  if v_etapa_id is null then
    raise exception 'O funil não tem etapa aberta disponível para receber a negociação.'
      using errcode = '23514';
  end if;

  insert into public.negociacoes (cliente_id, owner_id, etapa_id, valor_estimado, temperatura, origem)
  values (p_cliente_id, (select auth.uid()), v_etapa_id, p_valor_estimado, p_temperatura, p_origem)
  returning id into v_negociacao_id;

  return v_negociacao_id;
end;
$$;

comment on function public.criar_negociacao is
  'Nova entrada do Kanban: negociação nova para um cliente já existente. '
  'Nunca cria cliente. Entra na primeira etapa aberta do funil escolhido. '
  'p_origem default "manual" — leads automáticos (WhatsApp, formulário) '
  'passam a origem explicitamente.';

create or replace function public.criar_cliente_whatsapp(
  p_telefone     text,
  p_nome         text,
  p_conversa_id  uuid
)
returns table (cliente_id uuid, negociacao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa               public.conversas%rowtype;
  v_funil_id               uuid;
  v_responsavel_padrao_id  uuid;
  v_cliente_id             uuid;
  v_negociacao_id          uuid;
begin
  select * into v_conversa
    from public.conversas
   where id = p_conversa_id
     for update;

  if v_conversa.id is null then
    raise exception 'Conversa % não encontrada.', p_conversa_id using errcode = 'P0002';
  end if;

  if v_conversa.telefone <> p_telefone then
    raise exception 'Telefone informado não corresponde à conversa %.', p_conversa_id
      using errcode = '22023';
  end if;

  if v_conversa.cliente_id is not null then
    select n.id into v_negociacao_id
      from public.negociacoes n
     where n.cliente_id = v_conversa.cliente_id
     order by n.created_at
     limit 1;

    return query select v_conversa.cliente_id, v_negociacao_id;
    return;
  end if;

  select c.funil_id, c.responsavel_padrao_id
    into v_funil_id, v_responsavel_padrao_id
    from public.whatsapp_conexoes c
   where c.id = '00000000-0000-0000-0000-000000000001';

  if v_funil_id is null or v_responsavel_padrao_id is null then
    raise exception 'Configuração do WhatsApp (funil/responsável padrão) não encontrada.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.funis f
     where f.id = v_funil_id and f.ativo and f.whatsapp_habilitado
  ) then
    raise exception 'Funil % não está ativo ou não tem WhatsApp habilitado.', v_funil_id
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_responsavel_padrao_id and p.ativo) then
    raise exception 'Responsável padrão % inválido ou inativo.', v_responsavel_padrao_id
      using errcode = '23514';
  end if;

  insert into public.clientes (tipo_cliente, nome, telefone, whatsapp, owner_id)
  values ('pessoa_fisica', p_nome, p_telefone, p_telefone, v_responsavel_padrao_id)
  returning id into v_cliente_id;

  v_negociacao_id := public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'whatsapp');

  update public.conversas
     set cliente_id = v_cliente_id
   where id = p_conversa_id;

  return query select v_cliente_id, v_negociacao_id;
end;
$$;

comment on function public.criar_cliente_whatsapp is
  'Cria cliente + negociação (origem whatsapp, primeira etapa aberta do '
  'funil configurado em whatsapp_conexoes) a partir de uma conversa sem '
  'cliente vinculado — atômico. Só o whatsapp-service chama (service_role); '
  'idempotente por conversa_id.';

revoke all on function public.criar_cliente_whatsapp(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.criar_cliente_whatsapp(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Etapa "Lead Novo" no Funil Principal — real, não um apelido de
-- "Reunião agendada" (que preserva seu significado atual intocado). Entra
-- como etapa aberta personalizada (sistema=false): inserir como etapa de
-- SISTEMA exigiria desabilitar o trigger `etapas_funil_regras`, que já
-- existe e rejeita `sistema=true`/`chave` não nulo em qualquer INSERT
-- comum — mais arriscado que necessário aqui. Ordem 500: antes de "Reunião
-- agendada" (1000), continua antes do marco `chave = 'negociacao'` (4000).
-- Idempotente: só insere se não existir uma etapa com esse nome no funil
-- (o índice único `etapas_funil_nome_ativo_unico` também garante isso no
-- banco, mesmo que esta checagem um dia seja removida).
--
-- `ingerir_lead_formulario` (criação) e `reativarNegociacao`
-- (lib/dal/negociacoes.ts, reativação) passam a resolver esta etapa POR
-- NOME, sem fallback para "primeira etapa aberta" — se um funil não tiver
-- "Lead Novo", a operação falha alto em vez de entrar silenciosamente em
-- outra etapa.
-- ---------------------------------------------------------------------------
do $$
declare
  v_funil_principal_id uuid;
begin
  select id into v_funil_principal_id from public.funis where padrao;

  if v_funil_principal_id is null then
    raise exception 'Funil Principal não encontrado — migração abortada.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.etapas_funil
     where funil_id = v_funil_principal_id
       and lower(btrim(nome)) = 'lead novo'
  ) then
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_principal_id, 'Lead Novo', 'turquesa', 500, 'aberta');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. ingerir_lead_formulario — chamada só pela Edge Function `ingestao-lead`
-- (service_role). Upsert atômico: cliente (dedup telefone/e-mail), negociação
-- (dedup origem+external_id) e respostas (upsert por pergunta).
--
-- SECURITY DEFINER pelo mesmo motivo de criar_cliente_whatsapp: quem chama
-- não é um usuário autenticado do CRM (é a Edge Function com service_role,
-- sem auth.uid()), então a escrita em clientes/negociacoes precisa ignorar a
-- RLS por dentro da função — o EXECUTE restrito a service_role é a proteção
-- real, não a RLS das tabelas.
-- ---------------------------------------------------------------------------
create or replace function public.ingerir_lead_formulario(
  p_external_id      text,
  p_formulario_slug  text,
  p_nicho_slug       text,
  p_nome             text,
  p_telefone         text default null,
  p_email            text default null,
  p_empresa          text default null,
  p_instagram        text default null,
  p_respostas        jsonb default '[]'::jsonb
)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_formulario_id   uuid;
  v_nicho_id        uuid;
  v_funil_id        uuid;
  v_responsavel_id  uuid;
  v_etapa_id        uuid;
  v_cliente_id      uuid;
  v_negociacao_id   uuid;
  v_criado          boolean := false;
  v_item            jsonb;
  v_pergunta_id     uuid;
  v_resposta        text;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id é obrigatório.' using errcode = '22023';
  end if;
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Nome é obrigatório.' using errcode = '22023';
  end if;
  if p_telefone is null and p_email is null then
    raise exception 'Informe ao menos telefone ou e-mail.' using errcode = '22023';
  end if;

  select f.id into v_formulario_id from public.formularios f
   where f.slug = p_formulario_slug and f.ativo;
  if v_formulario_id is null then
    raise exception 'Formulário "%" não encontrado ou desativado.', p_formulario_slug
      using errcode = 'P0002';
  end if;

  select n.id into v_nicho_id from public.nichos n
   where n.slug = p_nicho_slug and n.ativo;
  if v_nicho_id is null then
    raise exception 'Nicho "%" não encontrado ou desativado.', p_nicho_slug using errcode = 'P0002';
  end if;

  -- Idempotência primária: `for update` serializa reenvios concorrentes do
  -- mesmo external_id, mesmo padrão (sem advisory lock) de criar_cliente_whatsapp.
  select n.cliente_id, n.id into v_cliente_id, v_negociacao_id
    from public.negociacoes n
   where n.origem = 'formulario' and n.external_id = p_external_id
   for update;

  if v_negociacao_id is not null then
    -- Reenvio/correção da mesma linha: atualiza os dados cadastrais e as
    -- respostas, mas NUNCA cria uma segunda negociação nem reabre uma que
    -- já foi arquivada/excluída manualmente.
    update public.clientes
       set nome      = p_nome,
           empresa   = coalesce(p_empresa, empresa),
           telefone  = coalesce(p_telefone, telefone),
           email     = coalesce(p_email, email),
           instagram = coalesce(p_instagram, instagram)
     where id = v_cliente_id and deleted_at is null;
  else
    -- Dedup secundária: telefone/e-mail já pertence a um cliente ativo?
    -- Reaproveita o cliente (nunca duplica) — a negociação nova entra na
    -- carteira de quem já é o dono dele, nunca no responsável padrão.
    select c.id into v_cliente_id
      from public.clientes c
     where c.deleted_at is null
       and (
         (p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
         or (p_email is not null and lower(c.email) = lower(p_email))
       )
     order by c.created_at
     limit 1
     for update;

    if v_cliente_id is null then
      -- Responsável/funil padrão de leads automáticos — mesma config já
      -- usada pelo WhatsApp (ver cabeçalho do arquivo).
      select c.funil_id, c.responsavel_padrao_id
        into v_funil_id, v_responsavel_id
        from public.whatsapp_conexoes c
       where c.id = '00000000-0000-0000-0000-000000000001';

      if v_funil_id is null or v_responsavel_id is null then
        raise exception 'Configuração de responsável/funil padrão para leads automáticos não encontrada.'
          using errcode = 'P0002';
      end if;

      insert into public.clientes (tipo_cliente, nome, empresa, telefone, email, instagram, owner_id)
      values ('pessoa_fisica', p_nome, p_empresa, p_telefone, p_email, p_instagram, v_responsavel_id)
      returning id into v_cliente_id;
    else
      select n.funil_id into v_funil_id
        from public.negociacoes n
       where n.cliente_id = v_cliente_id
       order by n.created_at
       limit 1;

      if v_funil_id is null then
        select c.funil_id into v_funil_id
          from public.whatsapp_conexoes c
         where c.id = '00000000-0000-0000-0000-000000000001';
      end if;
    end if;

    -- Lead de formulário SEMPRE entra em "Lead Novo" — nunca "a primeira
    -- etapa aberta" genérica. Sem fallback: se o funil resolvido não tiver
    -- essa etapa, falha alto (P0002) em vez de entrar silenciosamente em
    -- outra coluna do Kanban.
    select e.id into v_etapa_id
      from public.etapas_funil e
     where e.funil_id = v_funil_id
       and lower(btrim(e.nome)) = 'lead novo'
       and e.tipo = 'aberta'
       and e.ativo
     limit 1;

    if v_etapa_id is null then
      raise exception 'Etapa "Lead Novo" não encontrada (ou desativada) no funil %.', v_funil_id
        using errcode = 'P0002';
    end if;

    -- INSERT direto (não via criar_negociacao, que escolheria "a primeira
    -- etapa aberta" por ordem): os triggers de negociacoes (owner a partir
    -- do cliente, funil_id a partir da etapa, histórico de etapa) disparam
    -- igual, independente do caminho de inserção.
    insert into public.negociacoes (
      cliente_id, owner_id, etapa_id, origem, nicho_id, formulario_id, external_id
    )
    values (
      v_cliente_id, (select auth.uid()), v_etapa_id, 'formulario', v_nicho_id, v_formulario_id, p_external_id
    )
    returning id into v_negociacao_id;

    v_criado := true;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb))
  loop
    select p.id into v_pergunta_id
      from public.perguntas p
     where p.formulario_id = v_formulario_id
       and p.ativo
       and btrim(p.texto) = btrim(v_item ->> 'pergunta_externa');

    -- Pergunta desconhecida/desativada ou resposta vazia: ignora essa
    -- resposta, não interrompe a ingestão do lead (a Edge Function loga).
    continue when v_pergunta_id is null;

    v_resposta := v_item ->> 'resposta';
    continue when v_resposta is null or btrim(v_resposta) = '';

    insert into public.respostas_lead (negociacao_id, pergunta_id, resposta_texto, resposta_opcao)
    select
      v_negociacao_id,
      v_pergunta_id,
      case when p.tipo = 'texto_livre' then v_resposta end,
      case when p.tipo <> 'texto_livre' then v_resposta end
    from public.perguntas p
    where p.id = v_pergunta_id
    on conflict (negociacao_id, pergunta_id) do update
      set resposta_texto = excluded.resposta_texto,
          resposta_opcao = excluded.resposta_opcao;
  end loop;

  return query select v_cliente_id, v_negociacao_id, v_criado;
end;
$$;

comment on function public.ingerir_lead_formulario is
  'Upsert atômico de lead vindo de formulário externo (Google Sheets via '
  'Apps Script → Edge Function ingestao-lead): cliente (dedup telefone/'
  'e-mail), negociação (dedup origem=formulario + external_id) e respostas '
  '(upsert por pergunta, casada pelo texto exato). Nunca cria segunda '
  'negociação pro mesmo external_id. SECURITY DEFINER — só service_role chama.';

revoke all on function public.ingerir_lead_formulario(text, text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingerir_lead_formulario(text, text, text, text, text, text, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. funil_cards: nicho/origem/formulário no fim (create or replace view não
-- reordena colunas existentes) + esconde negociação arquivada/excluída.
-- ---------------------------------------------------------------------------
create or replace view public.funil_cards
with (security_invoker = true)
as
select
  n.id,
  n.etapa_id,
  e.nome            as etapa_nome,
  e.cor             as etapa_cor,
  e.tipo            as etapa_tipo,
  n.posicao,
  n.valor_estimado,
  n.temperatura,
  n.data_entrada_etapa,
  n.owner_id,
  p.nome            as responsavel_nome,
  c.id              as cliente_id,
  c.nome            as cliente_nome,
  c.empresa         as cliente_empresa,
  pa.titulo         as proxima_acao_titulo,
  pa.data           as proxima_acao_data,
  ua.tipo           as ultima_atividade_tipo,
  ua.data           as ultima_atividade_data,
  ua.descricao      as ultima_atividade_descricao,
  n.funil_id,
  f.valor_vendido,
  coalesce(
    (select array_agg(ns.servico_id order by ns.servico_id)
       from public.negociacao_servicos ns
      where ns.negociacao_id = n.id),
    '{}'
  ) as servico_ids,
  n.nicho_id,
  nc.nome           as nicho_nome,
  nc.cor            as nicho_cor,
  n.origem,
  n.formulario_id,
  fo.nome           as formulario_nome,
  c.telefone        as cliente_telefone
from public.negociacoes n
join public.etapas_funil e
  on e.id = n.etapa_id
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
left join public.profiles p
  on p.id = n.owner_id
left join public.fechamentos f
  on f.negociacao_id = n.id
left join public.nichos nc
  on nc.id = n.nicho_id
left join public.formularios fo
  on fo.id = n.formulario_id
left join lateral (
  select x.titulo, x.data
  from (
    select a.titulo, a.data
    from public.proximas_acoes a
    where a.concluida_em is null
      and (
        a.negociacao_id = n.id
        or (a.negociacao_id is null and a.cliente_id = n.cliente_id)
      )
    union all
    select ev.titulo, (ev.inicio at time zone 'America/Sao_Paulo')::date
    from public.eventos ev
    where ev.status = 'agendado'
      and ev.inicio >= now()
      and (
        ev.negociacao_id = n.id
        or (ev.negociacao_id is null and ev.cliente_id = n.cliente_id)
      )
  ) x
  order by x.data
  limit 1
) pa on true
left join lateral (
  select a.tipo, a.data, a.descricao
  from public.atividades a
  where a.cliente_id = n.cliente_id
  order by a.data desc
  limit 1
) ua on true
where n.arquivada_em is null;

comment on view public.funil_cards is
  'Um card do Kanban por negociação ativa (nunca arquivada/excluída). '
  'nicho/origem/formulário no fim, servico_ids sempre array. '
  'security_invoker: respeita a RLS.';

revoke all on public.funil_cards from anon;
grant select on public.funil_cards to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Dados iniciais — o formulário real de hoje (Instituição de Ensino).
-- Clínica/Ótica ficam de fora: não existe formulário real pra elas ainda:
-- criar as linhas agora seria dado especulativo, não modelo.
-- ---------------------------------------------------------------------------
do $$
declare
  v_nicho_id       uuid;
  v_formulario_id  uuid;
begin
  insert into public.nichos (nome, slug, cor, ordem)
  values ('Instituição de Ensino', 'instituicao-ensino', 'laranja', 1000)
  returning id into v_nicho_id;

  insert into public.formularios (nicho_id, nome, slug)
  values (v_nicho_id, 'Formulário de captação — Instituição de Ensino', 'instituicao-ensino-captacao')
  returning id into v_formulario_id;

  insert into public.perguntas (formulario_id, texto, tipo, opcoes, ordem) values
    (
      v_formulario_id,
      'Quantos colaboradores você possui?',
      'escolha_unica',
      '["Nenhum", "1 a 2", "3 a 5", "6 a 10", "+ de 10"]'::jsonb,
      1000
    ),
    (
      v_formulario_id,
      'Atualmente, qual é o maior desafio da sua Instituição?',
      'escolha_unica',
      '["Time comercial sem processos claros", "Dependo do meu melhor vendedor", "Falta de liderança na equipe", "Muitos leads e poucas vendas", "Ticket médio baixo", "Não tenho controle do time comercial", "Outros"]'::jsonb,
      2000
    ),
    (
      v_formulario_id,
      'Breno, qual é a sua meta de alunos na sua instituição de ensino?',
      'texto_livre',
      null,
      3000
    );
end;
$$;
