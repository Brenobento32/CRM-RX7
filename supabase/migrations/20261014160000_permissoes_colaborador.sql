-- ===========================================================================
-- Permissões configuráveis de visualização/movimentação por colaborador,
-- por funil e por etapa — a tabela de permissões passa a ser a ÚNICA fonte
-- de verdade de ACESSO (ver/mover) para SDR e CLOSER. GERENTE continua com
-- acesso total, sempre.
--
-- DECISÃO DE NEGÓCIO (substitui a primeira versão deste arquivo, nunca
-- aplicada): owner_id NÃO concede mais visualização nem movimentação pra
-- SDR/CLOSER. RESPONSÁVEL (owner_id) e PERMISSÃO DE ACESSO são conceitos
-- separados agora: owner_id continua existindo, intacto, só para
-- atribuição/responsabilidade comercial (quem a venda credita, quem aparece
-- como "Responsável") — nunca mais como um atalho de RLS. Sem nenhuma linha
-- em `permissoes_colaborador`, um SDR ou CLOSER não vê absolutamente nada
-- (nem funil, nem etapa, nem card) — exatamente como "usuário sem nenhuma
-- permissão não recebe acesso automático".
--
-- Ordem do arquivo:
--   1. tabela `permissoes_colaborador` (usuário/funil/etapa/pode_ver/pode_mover)
--   2. funções auxiliares de autorização (pode_ver_etapa, pode_mover_etapa)
--   3. RPC `mover_negociacao` — único caminho pelo qual "pode_mover"
--      consegue de fato mudar `etapa_id`; GERENTE ou permissão — nunca dono
--   4. policies de SELECT reescritas (negociacoes, clientes, profiles,
--      historico_etapas, respostas_lead, negociacao_servicos, atividades,
--      proximas_acoes, fechamentos) — GERENTE ou permissão, owner_id fora
--   5. backfill — só para CLOSER já existente, pra não quebrar o acesso que
--      ele já tinha hoje (ver seção 5 para o raciocínio completo). SDR nunca
--      é backfillado.
--   6. correção em `criar_negociacao` — achado na auditoria pedida antes de
--      implementar (ver seção 6 para o bug exato e por que esta é a única
--      função de escrita que precisava de ajuste).
--   7. `salvar_permissoes_colaborador` — RPC que a tela de configuração
--      (Configurações -> Usuários -> editar -> "Permissões comerciais")
--      usa pra gravar tudo numa transação só.
--
-- O QUE ESTA MIGRATION *NÃO* FAZ (de propósito, fora do pedido desta rodada):
--   - Não dá a closers/SDRs permissão para FECHAR ou MARCAR PERDIDA uma
--     negociação que não é deles — `fechar_negociacao`/`marcarPerdida`
--     continuam exigindo owner_id ou gerente, como hoje (esses dois RPCs são
--     escrita de dado comercial, não "movimentação de etapa" no sentido
--     desta tabela — ver comentário da seção 3).
--   - Não toca `negociacoes_update`/`clientes_update`/nenhuma outra policy
--     de INSERT/UPDATE/DELETE que já existia — "preservar as regras
--     existentes de escrita". Owner_id continua sendo exigido pra editar
--     dado comercial, criar cliente, excluir etc.; só a LEITURA e a
--     MOVIMENTAÇÃO DE ETAPA deixaram de aceitar owner_id como atalho.
--   - Não toca o trigger `negociacoes_valida_handoff_sdr` (20261014150000) —
--     ele continua disparando em TODO UPDATE de etapa_id, inclusive os que
--     passam por este RPC novo, e continua sendo o teto absoluto do SDR,
--     mesmo que uma permissão libere `pode_mover` além dele por engano.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela.
--
-- `etapa_id is null` = linha de ACESSO AO FUNIL (o "funil: [x] Inbound" do
-- wireframe) — pré-requisito. `etapa_id is not null` = a permissão fina
-- daquela etapa dentro do funil (os checkboxes de ver/movimentar).
--
-- As duas precisam existir juntas pra uma etapa "funcionar": ter acesso ao
-- funil NÃO dá acesso automático a nenhuma etapa dele — cada etapa exige a
-- própria linha com `pode_ver`/`pode_mover` explícitos. Se nenhuma etapa
-- estiver autorizada, o usuário não vê nenhum card daquele funil, mesmo com
-- a linha de acesso ao funil presente. Desmarcar o funil no futuro painel é
-- só apagar essa linha (`etapa_id is null`) — não precisa tocar em cada
-- etapa configurada, elas simplesmente deixam de valer (pode_ver_etapa/
-- pode_mover_etapa exigem as DUAS linhas, ver seção 2).
-- ---------------------------------------------------------------------------
create table public.permissoes_colaborador (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.profiles (id) on delete cascade,
  funil_id    uuid not null references public.funis (id) on delete cascade,
  etapa_id    uuid references public.etapas_funil (id) on delete cascade,
  pode_ver    boolean,
  pode_mover  boolean,
  criado_por  uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Linha de acesso ao funil (etapa_id null): pode_ver/pode_mover não fazem
  -- sentido nela e ficam null. Linha de etapa: os dois são obrigatórios
  -- (o formulário sempre manda true/false explícito, nunca "não escolhido").
  constraint permissoes_colaborador_campos_por_tipo check (
    (etapa_id is null and pode_ver is null and pode_mover is null)
    or
    (etapa_id is not null and pode_ver is not null and pode_mover is not null)
  ),
  -- Não dá pra movimentar uma etapa que não se pode nem ver.
  constraint permissoes_colaborador_mover_exige_ver check (
    pode_mover is not true or pode_ver is true
  ),
  -- Uma linha por (usuário, funil) pra acesso ao funil, e uma por
  -- (usuário, etapa) pra permissão fina — nulls not distinct pra "etapa_id
  -- is null" também ser único por (usuario_id, funil_id).
  constraint permissoes_colaborador_unica unique nulls not distinct (usuario_id, funil_id, etapa_id)
);

comment on table public.permissoes_colaborador is
  'Fonte ÚNICA de verdade de ACESSO (ver/mover) para SDR/CLOSER — owner_id '
  'não concede mais nada aqui, só permanece como atribuição/responsável. '
  'Linha com etapa_id null = acesso ao funil (pré-requisito, nunca '
  'suficiente por si só); com etapa_id preenchido = a permissão fina '
  '(pode_ver/pode_mover) daquela etapa.';
comment on column public.permissoes_colaborador.etapa_id is
  'null = esta linha é só o acesso ao funil (funil_id) — NÃO dá acesso a '
  'nenhuma etapa por si só. Preenchida = a permissão (pode_ver/pode_mover) '
  'desta etapa específica, dentro do mesmo funil.';

create index permissoes_colaborador_usuario_idx on public.permissoes_colaborador (usuario_id);
create index permissoes_colaborador_funil_idx   on public.permissoes_colaborador (funil_id);
create index permissoes_colaborador_etapa_idx   on public.permissoes_colaborador (etapa_id) where etapa_id is not null;

create trigger permissoes_colaborador_set_updated_at
  before update on public.permissoes_colaborador
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Validação: a etapa (quando informada) precisa pertencer ao funil da linha,
-- e o usuário da permissão não pode ser um gerente (ele já tem acesso total
-- — uma permissão "configurada errado" nunca pode bloqueá-lo, e a forma mais
-- simples de garantir isso é nem deixar essa configuração existir).
-- ---------------------------------------------------------------------------
create or replace function public.permissoes_colaborador_valida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_da_etapa uuid;
  v_role public.user_role;
begin
  if new.etapa_id is not null then
    select e.funil_id into v_funil_da_etapa from public.etapas_funil e where e.id = new.etapa_id;
    if v_funil_da_etapa is null then
      raise exception 'Etapa não encontrada.' using errcode = '23514';
    end if;
    if v_funil_da_etapa <> new.funil_id then
      raise exception 'A etapa informada não pertence ao funil desta permissão.' using errcode = '23514';
    end if;
  end if;

  select p.role into v_role from public.profiles p where p.id = new.usuario_id;
  if v_role = 'gerente' then
    raise exception 'Gerente já tem acesso total — não é possível configurar permissões para um gerente.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger permissoes_colaborador_valida
  before insert or update on public.permissoes_colaborador
  for each row
  execute function public.permissoes_colaborador_valida();

-- ---------------------------------------------------------------------------
-- RLS — só o gerente administra; cada colaborador lê só as próprias linhas
-- (pro Kanban dele montar a lista de funis/etapas permitidas).
-- ---------------------------------------------------------------------------
alter table public.permissoes_colaborador enable row level security;

create policy permissoes_colaborador_select on public.permissoes_colaborador
  for select
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or public.is_gerente()
  );

create policy permissoes_colaborador_insert on public.permissoes_colaborador
  for insert
  to authenticated
  with check (public.is_gerente());

create policy permissoes_colaborador_update on public.permissoes_colaborador
  for update
  to authenticated
  using (public.is_gerente())
  with check (public.is_gerente());

create policy permissoes_colaborador_delete on public.permissoes_colaborador
  for delete
  to authenticated
  using (public.is_gerente());

revoke all on table public.permissoes_colaborador from anon;
grant select, insert, update, delete on table public.permissoes_colaborador to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Funções de autorização — sempre em relação ao usuário ATUAL
-- (auth.uid()), security definer pra não recursar na própria RLS da tabela
-- de permissões (mesmo motivo de is_gerente()). Nunca olham owner_id nem
-- gerente — isso é decidido nas policies/RPC que as chamam, por cima.
-- ---------------------------------------------------------------------------
create or replace function public.pode_ver_etapa(p_funil_id uuid, p_etapa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.funil_id = p_funil_id
        and pc.etapa_id is null
    )
    and exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.etapa_id = p_etapa_id
        and pc.pode_ver
    );
$$;

comment on function public.pode_ver_etapa is
  'True se o usuário atual tem acesso ao funil E permissão pode_ver nesta '
  'etapa específica. As duas linhas são obrigatórias — acesso ao funil sem '
  'a etapa específica nunca é suficiente. Nunca olha owner_id/gerente.';

create or replace function public.pode_mover_etapa(p_funil_id uuid, p_etapa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.funil_id = p_funil_id
        and pc.etapa_id is null
    )
    and exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.etapa_id = p_etapa_id
        and pc.pode_mover
    );
$$;

comment on function public.pode_mover_etapa is
  'True se o usuário atual tem acesso ao funil E permissão pode_mover nesta '
  'etapa específica. Usada pelo RPC mover_negociacao() — nunca numa policy '
  'de UPDATE geral. Nunca olha owner_id/gerente.';

revoke all on function public.pode_ver_etapa(uuid, uuid)   from public, anon;
revoke all on function public.pode_mover_etapa(uuid, uuid) from public, anon;
grant execute on function public.pode_ver_etapa(uuid, uuid)   to authenticated;
grant execute on function public.pode_mover_etapa(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. mover_negociacao — único caminho pelo qual "pode_mover" consegue de
-- fato mudar etapa_id. SECURITY DEFINER pra poder escrever mesmo quando
-- quem chama não é gerente — mas o próprio corpo da função é a
-- autorização: GERENTE ou pode_mover_etapa() nas duas pontas (origem e
-- destino) — owner_id NÃO é mais considerado aqui, de propósito. Só altera
-- etapa_id/posicao, nunca mais nada.
--
-- Por que owner_id não entra: closer/SDR "dono" de uma negociação sem
-- permissão configurada pra aquela etapa simplesmente não tem mais acesso
-- de movimentação — é exatamente a mudança de modelo pedida ("owner_id NÃO
-- deve funcionar como bypass de permissão"). `fechar_negociacao`/
-- `marcarPerdida` são RPCs DIFERENTES (escrita de dado comercial do
-- fechamento/perda, não desta tabela) e continuam exigindo owner_id ou
-- gerente, inalterados — não fazem parte desta migration.
--
-- O trigger negociacoes_valida_handoff_sdr (já existente) dispara nesta
-- UPDATE como em qualquer outra — SDR continua sem conseguir passar de
-- "Reunião realizada" aqui, mesmo que uma permissão tenha sido configurada
-- errado para liberar etapas além do handoff.
-- ---------------------------------------------------------------------------
create or replace function public.mover_negociacao(
  p_negociacao_id uuid,
  p_etapa_id      uuid,
  p_posicao       numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id         uuid;
  v_etapa_atual_id   uuid;
  v_destino_funil_id uuid;
  v_destino_tipo     public.tipo_etapa;
  v_destino_ativo    boolean;
  v_role             public.user_role;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_atual_id
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  select e.funil_id, e.tipo, e.ativo into v_destino_funil_id, v_destino_tipo, v_destino_ativo
    from public.etapas_funil e
   where e.id = p_etapa_id;

  if v_destino_funil_id is null or not v_destino_ativo then
    raise exception 'Etapa não encontrada ou desativada.' using errcode = '23514';
  end if;

  if v_destino_funil_id <> v_funil_id then
    raise exception 'Não é possível mover uma negociação para outro funil.' using errcode = '23514';
  end if;

  if v_destino_tipo in ('ganha', 'perdida') and p_etapa_id <> v_etapa_atual_id then
    raise exception 'Use o fechamento ou o motivo de perda para entrar nesta etapa.' using errcode = '23514';
  end if;

  select p.role into v_role from public.profiles p where p.id = (select auth.uid());

  if v_role <> 'gerente'
     and not (
       public.pode_mover_etapa(v_funil_id, v_etapa_atual_id)
       and public.pode_mover_etapa(v_funil_id, p_etapa_id)
     )
  then
    raise exception 'Você não tem permissão para mover esta negociação.' using errcode = '42501';
  end if;

  update public.negociacoes
     set etapa_id = p_etapa_id,
         posicao = p_posicao
   where id = p_negociacao_id;
end;
$$;

comment on function public.mover_negociacao is
  'Move uma negociação entre etapas abertas quando quem chama é GERENTE ou '
  'tem pode_mover configurado tanto na etapa de origem quanto na de destino '
  '(mesmo funil). owner_id NÃO concede mais acesso aqui. Só toca '
  'etapa_id/posicao — nunca concede UPDATE geral. O trigger de handoff SDR '
  'dispara normalmente por cima desta função, como em qualquer UPDATE de '
  'etapa_id.';

revoke all on function public.mover_negociacao(uuid, uuid, numeric) from public, anon;
grant execute on function public.mover_negociacao(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Policies de SELECT reescritas — GERENTE ou permissão configurada.
-- owner_id/negociacao_owner()/cliente_owner() SAEM da condição de leitura
-- pra SDR/CLOSER (continuam valendo, inalterados, nas policies de
-- INSERT/UPDATE/DELETE de cada tabela — não tocadas por este arquivo).
--
-- `profiles_select` mantém `id = auth.uid()` — isso não é "owner_id como
-- bypass de dado de terceiro", é o usuário lendo o PRÓPRIO perfil
-- (getUsuarioAtual() depende disso para todo o app funcionar).
-- ---------------------------------------------------------------------------
drop policy if exists negociacoes_select on public.negociacoes;
create policy negociacoes_select on public.negociacoes
  for select
  to authenticated
  using (
    public.is_gerente()
    or public.pode_ver_etapa(funil_id, etapa_id)
  );

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.cliente_id = clientes.id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.owner_id = profiles.id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists historico_etapas_select on public.historico_etapas;
create policy historico_etapas_select on public.historico_etapas
  for select
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = historico_etapas.negociacao_id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists respostas_lead_select on public.respostas_lead;
create policy respostas_lead_select on public.respostas_lead
  for select
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = respostas_lead.negociacao_id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists negociacao_servicos_select on public.negociacao_servicos;
create policy negociacao_servicos_select on public.negociacao_servicos
  for select
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = negociacao_servicos.negociacao_id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists fechamentos_select on public.fechamentos;
create policy fechamentos_select on public.fechamentos
  for select
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = fechamentos.negociacao_id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists atividades_select on public.atividades;
create policy atividades_select on public.atividades
  for select
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.cliente_id = atividades.cliente_id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists proximas_acoes_select on public.proximas_acoes;
create policy proximas_acoes_select on public.proximas_acoes
  for select
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.cliente_id = proximas_acoes.cliente_id
        and public.pode_ver_etapa(n.funil_id, n.etapa_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Backfill — só para CLOSER já existente.
--
-- Sem isso, no instante em que esta migration for aplicada, todo closer
-- perderia a visão de tudo (as novas policies não têm mais o atalho de
-- owner_id) até o gerente configurar manualmente — inaceitável em produção.
--
-- Estratégia (determinística, a mais fiel ao que cada closer já conseguia
-- fazer): para cada closer que hoje é owner_id de pelo menos uma
-- negociação, conceder acesso ao(s) funil(is) onde ele atua, com
-- pode_ver = pode_mover = true em TODAS as etapas ATIVAS de cada um desses
-- funis (inclusive ganha/perdida — closer precisa continuar vendo o próprio
-- histórico de fechados/perdidos em /propostas, dashboards etc.). Isso
-- reproduz o alcance que owner_id já dava hoje (nenhuma etapa era bloqueada
-- pra quem era dono), só que agora expresso como linhas explícitas.
--
-- EFEITO COLATERAL CONSCIENTE, não escondido: a granularidade desta tabela
-- é por FUNIL+ETAPA, não por negociação individual. Depois deste backfill,
-- um closer passa a ver/mover TODAS as negociações (de qualquer dono) nos
-- funis/etapas em que ele atuava — não só as próprias. Esse é o próprio
-- modelo pedido (ex.: "Carlos" vendo todo o back-end do funil Inbound,
-- independente de quem trouxe o lead) — mas é uma AMPLIAÇÃO de acesso em
-- relação ao isolamento por dono que existia antes, não uma cópia 1:1 dele.
-- Se a intenção for isolar por negociação individual, a granularidade desta
-- tabela precisaria mudar — avise antes de aplicar se for o caso.
--
-- SDR nunca é backfillado — "se for usuário novo e não houver permissão
-- configurada, não conceder acesso automaticamente": todo SDR começa zerado,
-- o gerente configura manualmente.
-- ---------------------------------------------------------------------------
insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
select distinct n.owner_id, n.funil_id, null::uuid, null::boolean, null::boolean, n.owner_id
  from public.negociacoes n
  join public.profiles p on p.id = n.owner_id and p.role = 'closer'
on conflict (usuario_id, funil_id, etapa_id) do nothing;

insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
select distinct n.owner_id, e.funil_id, e.id, true, true, n.owner_id
  from public.negociacoes n
  join public.profiles p on p.id = n.owner_id and p.role = 'closer'
  join public.etapas_funil e on e.funil_id = n.funil_id and e.ativo
on conflict (usuario_id, funil_id, etapa_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. criar_negociacao — achado na auditoria pedida antes de implementar.
--
-- BUG ENCONTRADO: `criar_negociacao` (20261008100000_leads_multinicho.sql)
-- NÃO é security definer — ela roda com os privilégios (e a RLS) de quem
-- chama. O primeiro passo dela sempre foi
-- `if not exists (select 1 from public.clientes c where c.id = p_cliente_id ...)`,
-- uma leitura comum de `clientes`, sujeita à RLS do chamador.
--
-- Antes desta migration isso funcionava pra qualquer dono, porque
-- `clientes_select` tinha o atalho `owner_id = auth.uid()`. Com esse atalho
-- removido (seção 4), essa mesma leitura FICA ESTRUTURALMENTE IMPOSSÍVEL
-- de satisfazer pra um cliente novo: o único jeito de um SDR/CLOSER "ver"
-- um cliente, sem ser gerente, passou a ser "ter uma negociação visível
-- desse cliente" — e a negociação que `criar_negociacao` está tentando
-- criar é exatamente a primeira negociação dele. Ou seja: NINGUÉM além do
-- gerente conseguiria criar a primeira negociação de um cliente novo,
-- mesmo sendo o dono do cliente e com todas as permissões de funil/etapa
-- corretamente configuradas. Isso não é a regra de negócio pedida (que é
-- sobre VISUALIZAÇÃO/MOVIMENTAÇÃO de negociações já existentes) — é uma
-- quebra colateral da mudança de RLS.
--
-- CORREÇÃO: `criar_negociacao` passa a ser SECURITY DEFINER, com a MESMA
-- regra que a RLS antiga garantia implicitamente, agora explícita no corpo
-- da função: só o dono do cliente (`cliente_owner()`, já security definer,
-- idêntico ao padrão de `is_gerente()`) ou um gerente pode criar uma
-- negociação para ele. Isso preserva EXATAMENTE a regra de escrita que já
-- existia (criar negociação sempre exigiu dono ou gerente) — não abre
-- nenhuma permissão nova, só deixa de depender de uma leitura de `clientes`
-- que a nova RLS não garante mais pra esse caso específico (cliente sem
-- nenhuma negociação ainda).
--
-- Mesmo problema NÃO existe em `marcarPerdida`/`fechar_negociacao`/
-- `atualizar_fechamento`: essas funções sempre operam sobre uma negociação
-- JÁ EXISTENTE que o usuário só alcança depois de já tê-la visto no Kanban
-- (ou seja, `pode_ver_etapa` já deu certo antes de chegar ali) — uma
-- tentativa direta de API pra uma negociação que o usuário não vê falhar
-- com "não encontrada" é o comportamento CORRETO, não um bug.
-- ---------------------------------------------------------------------------
create or replace function public.criar_negociacao(
  p_cliente_id      uuid,
  p_funil_id        uuid,
  p_valor_estimado  numeric default null,
  p_temperatura     public.temperatura_negociacao default null,
  p_origem          public.origem_negociacao default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_negociacao_id uuid;
  v_etapa_id      uuid;
  v_owner_cliente uuid;
begin
  select c.owner_id into v_owner_cliente
    from public.clientes c
   where c.id = p_cliente_id
     and c.deleted_at is null;

  if v_owner_cliente is null then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  if v_owner_cliente <> (select auth.uid()) and not public.is_gerente() then
    raise exception 'Você não tem permissão para criar uma negociação para esse cliente.'
      using errcode = '42501';
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
  'SECURITY DEFINER com checagem explícita (dono do cliente ou gerente) — '
  'preserva a regra de escrita de sempre, sem depender de clientes_select '
  '(que não alcança mais um cliente sem nenhuma negociação visível ainda). '
  'Nunca cria cliente. Entra na primeira etapa aberta do funil escolhido.';

-- ---------------------------------------------------------------------------
-- 7. salvar_permissoes_colaborador — grava a tela de configuração (gerente)
-- numa transação só: substitui TODAS as linhas daquele colaborador pelo
-- conjunto novo, sem deixar estado parcialmente salvo (DELETE + INSERT
-- dentro de uma única chamada de função = uma única transação implícita;
-- qualquer erro no meio desfaz tudo).
--
-- NÃO é security definer de propósito: o DELETE e o INSERT abaixo passam
-- pela RLS de `permissoes_colaborador` (seção 1 — só gerente insere/
-- apaga). Se alguém chamar isto sem ser gerente, a RLS recusa — a função
-- em si não precisa duplicar essa checagem, e o trigger
-- `permissoes_colaborador_valida` (seção 1) continua barrando qualquer
-- tentativa de configurar um usuário gerente, e a constraint
-- `permissoes_colaborador_mover_exige_ver` continua barrando pode_mover
-- sem pode_ver, mesmo que o formulário mande algo inconsistente.
--
-- `p_permissoes`: array de objetos `{funil_id, etapa_id, pode_ver,
-- pode_mover}` — linha de acesso ao funil tem `etapa_id`/`pode_ver`/
-- `pode_mover` nulos; linha de etapa tem os quatro preenchidos. Mandar um
-- array vazio remove todas as permissões do colaborador (desmarcar tudo).
-- ---------------------------------------------------------------------------
create or replace function public.salvar_permissoes_colaborador(
  p_usuario_id  uuid,
  p_permissoes  jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.permissoes_colaborador where usuario_id = p_usuario_id;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  select
    p_usuario_id,
    (item ->> 'funil_id')::uuid,
    (item ->> 'etapa_id')::uuid,
    (item ->> 'pode_ver')::boolean,
    (item ->> 'pode_mover')::boolean
  from jsonb_array_elements(coalesce(p_permissoes, '[]'::jsonb)) as item;
end;
$$;

comment on function public.salvar_permissoes_colaborador is
  'Substitui TODAS as permissões de um colaborador pelo conjunto enviado, '
  'numa transação só (DELETE + INSERT na mesma chamada). Não é security '
  'definer — a RLS de permissoes_colaborador (só gerente) e as constraints '
  'da tabela (mover exige ver, etapa pertence ao funil, nunca um gerente) '
  'são a autorização real.';

revoke all on function public.salvar_permissoes_colaborador(uuid, jsonb) from public, anon;
grant execute on function public.salvar_permissoes_colaborador(uuid, jsonb) to authenticated;
