-- ===========================================================================
-- Múltiplos funis.
--
-- Hoje só existe um funil implícito: `etapas_funil` é uma lista achatada, com
-- índices únicos GLOBAIS (uma só etapa ganha, uma só perdida, uma ordem por
-- posição) e um trigger que crava "toda etapa personalizada entra antes da
-- etapa de chave 'negociacao'" — um marco que só existe no Funil Principal.
--
-- Esta migration:
--   1. `funis` — tabela nova.
--   2. `etapas_funil.funil_id` — backfill pro Funil Principal, índices únicos
--      passam a ser por funil.
--   3. `negociacoes.funil_id` — denormalizado, sincronizado por trigger a
--      partir da etapa (mesmo padrão de `owner_id` a partir do cliente).
--      Deixa pronta uma futura transferência entre funis: bastaria trocar
--      `etapa_id` para uma etapa de outro funil; o trigger recalcula sozinho.
--      A transferência em si NÃO é implementada aqui.
--   4. `etapas_funil_regras()` reescrita: etapa personalizada pode ser
--      ganha/perdida (o índice único por funil garante no máximo uma de cada);
--      a regra de posição generaliza para "abertas antes de ganha/perdida do
--      mesmo funil", com o Funil Principal preservando o comportamento
--      exato de hoje via o marco `chave = 'negociacao'`.
--   5. `criar_funil()` — cria funil + etapa ganha + etapa perdida (+ abertas
--      opcionais) numa transação só. Nunca existe funil sem as duas.
--   6. `duplicar_funil()` — copia nome/cor/tipo/ordem das etapas; nunca copia
--      negociação, histórico ou fechamento; as cópias nunca são "sistema".
--   7. `funis_regras()` — funil padrão nunca muda nem é excluído; funil com
--      negociação vinculada não pode ser excluído. Regra no banco.
--   8. `criar_negociacao()` — nova negociação pra CLIENTE JÁ EXISTENTE (Nova
--      entrada do Kanban); nunca cria cliente; entra na primeira etapa aberta
--      do funil escolhido.
--   9. `funil_metricas` ganha `p_funil_id`.
--  10. `dashboard_etapas` / `dashboard_por_usuario` / `dashboard_vendas_mensais`
--      passam a olhar só o Funil Principal (decisão explícita desta fase —
--      sem isso, o dia em que o segundo funil ganhar um card os números do
--      dashboard mudariam sozinhos).
--  11. `metas_progresso` — SEM MUDANÇA. Meta é sobre receita da pessoa/empresa,
--      não sobre um funil específico.
--  12. `funil_cards` ganha a coluna `funil_id`.
--
-- Nada em `historico_etapas` ou `fechamentos` muda de estrutura — o funil de
-- uma linha ali já é derivável pela etapa.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela `funis`.
-- ---------------------------------------------------------------------------
create table public.funis (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) between 1 and 80),
  descricao   text,
  padrao      boolean not null default false,
  ativo       boolean not null default true,
  ordem       numeric not null default 1000,
  criado_por  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.funis is
  'Um funil de vendas: nome + conjunto próprio de etapas. "padrao" é o Funil '
  'Principal, migrado dos dados existentes — único, e nunca excluído ou trocado.';
comment on column public.funis.padrao is
  'Exatamente um funil tem padrao=true. Fixado na criação (funis_regras bloqueia UPDATE).';

create unique index funis_padrao_unico     on public.funis (padrao) where padrao;
create unique index funis_nome_ativo_unico on public.funis (lower(btrim(nome))) where ativo;

create trigger funis_set_updated_at
  before update on public.funis
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Backfill: o Funil Principal e o `funil_id` de `etapas_funil`.
-- ---------------------------------------------------------------------------
insert into public.funis (nome, descricao, padrao, ordem)
values (
  'Funil Principal',
  'Funil original do CRM — fluxo comercial padrão.',
  true,
  1000
);

alter table public.etapas_funil
  add column funil_id uuid references public.funis (id) on delete cascade;

update public.etapas_funil
   set funil_id = (select id from public.funis where padrao);

do $$
begin
  if exists (select 1 from public.etapas_funil where funil_id is null) then
    raise exception 'Migração abortada: etapa sem funil correspondente.';
  end if;
end;
$$;

alter table public.etapas_funil alter column funil_id set not null;

create index etapas_funil_funil_idx on public.etapas_funil (funil_id);

-- Os três índices únicos que eram globais passam a ser por funil.
drop index public.etapas_funil_tipo_final_unico;
drop index public.etapas_funil_nome_ativo_unico;
drop index public.etapas_funil_ordem_unica;

create unique index etapas_funil_tipo_final_unico
  on public.etapas_funil (funil_id, tipo)
  where tipo in ('ganha', 'perdida');

create unique index etapas_funil_nome_ativo_unico
  on public.etapas_funil (funil_id, lower(btrim(nome)))
  where ativo;

create unique index etapas_funil_ordem_unica
  on public.etapas_funil (funil_id, ordem);

-- ---------------------------------------------------------------------------
-- 3. `negociacoes.funil_id` — denormalizado, sincronizado por trigger.
-- ---------------------------------------------------------------------------
alter table public.negociacoes
  add column funil_id uuid references public.funis (id) on delete restrict;

update public.negociacoes n
   set funil_id = e.funil_id
  from public.etapas_funil e
 where e.id = n.etapa_id;

-- O UPDATE acima enfileira o constraint trigger deferido
-- `negociacoes_exige_fechamento` (dispara em qualquer UPDATE de
-- `negociacoes`, sem lista de colunas) — e o Postgres não altera uma tabela
-- com eventos pendentes (55006). Dispara a checagem agora — ela não muda
-- `etapa_id`, então a invariante "ganha tem fechamento" já valia antes do
-- UPDATE e continua valendo — e volta ao modo deferido. Mesma solução já
-- usada no backfill de `etapa_id` em 20260923200000_etapas_funil.sql.
set constraints all immediate;
set constraints all deferred;

do $$
begin
  if exists (select 1 from public.negociacoes where funil_id is null) then
    raise exception 'Migração abortada: negociação sem funil correspondente.';
  end if;
end;
$$;

alter table public.negociacoes alter column funil_id set not null;

create index negociacoes_funil_idx       on public.negociacoes (funil_id, posicao);
create index negociacoes_funil_etapa_idx on public.negociacoes (funil_id, etapa_id);

comment on column public.negociacoes.funil_id is
  'Derivado de etapas_funil.funil_id por trigger. Não escreva nesta coluna — '
  'preparado para uma futura transferência de funil: basta trocar etapa_id.';

create or replace function public.negociacoes_sincroniza_funil()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.funil_id := (select e.funil_id from public.etapas_funil e where e.id = new.etapa_id);

  if new.funil_id is null then
    raise exception 'Etapa % não encontrada.', new.etapa_id using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger negociacoes_sincroniza_funil
  before insert or update of etapa_id on public.negociacoes
  for each row
  execute function public.negociacoes_sincroniza_funil();

-- ---------------------------------------------------------------------------
-- 4. Regras de `etapas_funil`, reescritas para múltiplos funis.
--
-- Mudanças em relação à versão anterior:
--   * etapa personalizada PODE ser ganha ou perdida (antes só sistema podia).
--     O índice único (funil_id, tipo) garante no máximo uma de cada por
--     funil — a validação de negócio agora é o índice, não o trigger.
--   * o limite de posição ("abertas antes de X") generaliza: usa o marco
--     chave='negociacao' quando ele existe no funil (só o Principal tem —
--     comportamento idêntico ao atual), senão usa a menor ordem entre as
--     etapas ganha/perdida do próprio funil.
--   * a regra de exclusão (sistema não exclui; já usada não exclui) e a de
--     desativar com negociação atual não mudam em nada.
-- ---------------------------------------------------------------------------
create or replace function public.etapas_funil_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limite numeric;
begin
  if tg_op = 'DELETE' then
    if old.sistema then
      raise exception 'Etapas padrão do funil não podem ser excluídas.' using errcode = '23514';
    end if;
    if exists (select 1 from public.negociacoes n where n.etapa_id = old.id)
       or exists (
         select 1 from public.historico_etapas h
         where h.etapa_nova_id = old.id or h.etapa_anterior_id = old.id
       )
    then
      raise exception 'A etapa "%" já teve negociações. Desative-a em vez de excluir.', old.nome
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.sistema then
    -- Sistema: só a cor muda (nem o funil de uma etapa de sistema muda).
    if new.nome is distinct from old.nome
       or new.ordem is distinct from old.ordem
       or new.tipo is distinct from old.tipo
       or new.sistema is distinct from old.sistema
       or new.chave is distinct from old.chave
       or new.ativo is distinct from old.ativo
       or new.funil_id is distinct from old.funil_id
    then
      raise exception 'Nas etapas padrão do funil só a cor pode ser alterada.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Personalizada (inserção ou edição) — inclusive ganha/perdida de um funil novo.
  if new.sistema or new.chave is not null then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;

  if new.tipo = 'aberta' then
    select e.ordem into v_limite
      from public.etapas_funil e
     where e.funil_id = new.funil_id
       and e.chave = 'negociacao';

    if v_limite is null then
      select min(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');
    end if;

    if v_limite is not null and new.ordem >= v_limite then
      raise exception 'Etapas abertas ficam antes das etapas de fechamento do funil.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.ativo and not new.ativo
     and exists (select 1 from public.negociacoes n where n.etapa_id = new.id)
  then
    raise exception 'Mova as negociações da etapa "%" antes de desativá-la.', new.nome
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. `criar_funil` — funil, etapa ganha e etapa perdida numa transação só.
-- Nunca existe um funil persistido sem as duas. `p_etapas_abertas` é uma
-- lista opcional de `{"nome": "...", "cor": "..."}`, na ordem desejada.
-- RLS de `funis`/`etapas_funil` decide quem pode chamar (gerente).
-- ---------------------------------------------------------------------------
create or replace function public.criar_funil(
  p_nome                text,
  p_etapa_ganha_nome    text,
  p_etapa_ganha_cor     public.cor_etapa,
  p_etapa_perdida_nome  text,
  p_etapa_perdida_cor   public.cor_etapa,
  p_etapas_abertas      jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_ordem    numeric := 1000;
  v_item     jsonb;
begin
  insert into public.funis (nome, padrao)
  values (p_nome, false)
  returning id into v_funil_id;

  -- Ganha e perdida primeiro, com ordem alta — mesma convenção do Funil
  -- Principal (Fechado=100000, Perdido=100001) — para as abertas, inseridas
  -- a seguir, já encontrarem o limite pronto.
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
  values (v_funil_id, p_etapa_ganha_nome, p_etapa_ganha_cor, 100000, 'ganha');

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
  values (v_funil_id, p_etapa_perdida_nome, p_etapa_perdida_cor, 100001, 'perdida');

  for v_item in select * from jsonb_array_elements(coalesce(p_etapas_abertas, '[]'::jsonb))
  loop
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (
      v_funil_id,
      v_item ->> 'nome',
      (v_item ->> 'cor')::public.cor_etapa,
      v_ordem,
      'aberta'
    );
    v_ordem := v_ordem + 1000;
  end loop;

  return v_funil_id;
end;
$$;

comment on function public.criar_funil is
  'Cria um funil com etapa ganha e perdida obrigatórias (+ abertas opcionais), '
  'numa transação só. Erro em qualquer etapa desfaz tudo.';

revoke all on function public.criar_funil from public, anon;
grant execute on function public.criar_funil to authenticated;

-- ---------------------------------------------------------------------------
-- 6. `duplicar_funil` — copia a configuração das etapas; nunca copia dado
-- operacional (negociação, histórico, fechamento). As cópias nunca são
-- "sistema", mesmo se a origem for o Funil Principal.
-- ---------------------------------------------------------------------------
create or replace function public.duplicar_funil(p_funil_id uuid, p_novo_nome text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_novo_id uuid;
begin
  if not exists (select 1 from public.funis where id = p_funil_id) then
    raise exception 'Funil não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.funis (nome, padrao)
  values (p_novo_nome, false)
  returning id into v_novo_id;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
  select v_novo_id, e.nome, e.cor, e.ordem, e.tipo
    from public.etapas_funil e
   where e.funil_id = p_funil_id
   order by e.ordem;

  return v_novo_id;
end;
$$;

comment on function public.duplicar_funil is
  'Duplica um funil: copia nome/cor/tipo/ordem das etapas. NUNCA copia '
  'negociações, histórico ou fechamentos — o funil novo nasce vazio.';

revoke all on function public.duplicar_funil from public, anon;
grant execute on function public.duplicar_funil to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS de `funis` + regra de exclusão/alteração no banco.
-- ---------------------------------------------------------------------------
alter table public.funis enable row level security;

create policy funis_select on public.funis
  for select to authenticated
  using (true);

create policy funis_insert on public.funis
  for insert to authenticated
  with check (public.is_gerente());

create policy funis_update on public.funis
  for update to authenticated
  using (public.is_gerente())
  with check (public.is_gerente());

create policy funis_delete on public.funis
  for delete to authenticated
  using (public.is_gerente());

revoke all on table public.funis from anon;
grant select, insert, update, delete on table public.funis to authenticated;

create or replace function public.funis_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.padrao then
      raise exception 'O Funil Principal não pode ser excluído.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.negociacoes n
      join public.etapas_funil e on e.id = n.etapa_id
      where e.funil_id = old.id
    ) then
      raise exception 'O funil "%" tem negociações vinculadas. Não é possível excluir.', old.nome
        using errcode = '23514';
    end if;

    return old;
  end if;

  -- UPDATE: padrão é fixado na criação, nunca muda depois — senão dashboard,
  -- criar_cliente() e o resto do sistema perdem a referência ao Principal.
  if new.padrao is distinct from old.padrao then
    raise exception 'O funil padrão não pode ser alterado.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger funis_regras
  before update or delete on public.funis
  for each row
  execute function public.funis_regras();

-- Uso de cada funil, para a tela de configuração decidir se pode excluir.
create or replace function public.funis_uso()
returns table (funil_id uuid, negociacoes_atuais bigint)
language sql
stable
set search_path = ''
as $$
  select f.id, count(n.id)
  from public.funis f
  left join public.etapas_funil e on e.funil_id = f.id
  left join public.negociacoes n on n.etapa_id = e.id
  group by f.id;
$$;

revoke all on function public.funis_uso from public, anon;
grant execute on function public.funis_uso to authenticated;

-- ---------------------------------------------------------------------------
-- 8. `criar_negociacao` — Nova entrada: negociação nova pra CLIENTE JÁ
-- EXISTENTE. Nunca cria cliente. Entra na primeira etapa aberta (menor
-- ordem) do funil escolhido. O responsável (owner_id) segue sempre o dono do
-- cliente — negociacoes_sincroniza_owner já garante isso, igual a
-- criar_cliente(); por isso não há parâmetro de responsável aqui.
-- ---------------------------------------------------------------------------
create or replace function public.criar_negociacao(
  p_cliente_id      uuid,
  p_funil_id        uuid,
  p_valor_estimado  numeric default null,
  p_temperatura     public.temperatura_negociacao default null
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

  -- owner_id é só um valor de partida: negociacoes_sincroniza_owner sempre
  -- recalcula a partir do dono atual do cliente antes de gravar.
  insert into public.negociacoes (cliente_id, owner_id, etapa_id, valor_estimado, temperatura)
  values (p_cliente_id, (select auth.uid()), v_etapa_id, p_valor_estimado, p_temperatura)
  returning id into v_negociacao_id;

  return v_negociacao_id;
end;
$$;

comment on function public.criar_negociacao is
  'Nova entrada do Kanban: negociação nova para um cliente já existente. '
  'Nunca cria cliente. Entra na primeira etapa aberta do funil escolhido.';

revoke all on function public.criar_negociacao from public, anon;
grant execute on function public.criar_negociacao to authenticated;

-- ---------------------------------------------------------------------------
-- 9. `funil_metricas` ganha `p_funil_id`. Mesma lógica de coorte, alcance,
-- tempo por etapa e parados — só passa a olhar as etapas de UM funil.
-- ---------------------------------------------------------------------------
drop function if exists public.funil_metricas(date, date);

create function public.funil_metricas(
  p_inicio    date,
  p_fim       date,
  p_funil_id  uuid
)
returns table (
  etapa_id                uuid,
  nome                    text,
  cor                     public.cor_etapa,
  tipo                    public.tipo_etapa,
  ordem                   numeric,
  quantidade              bigint,
  valor                   numeric,
  alcancaram              bigint,
  tempo_medio_segundos    numeric,
  permanencias            bigint,
  parados_medio_segundos  numeric,
  parados_7_dias          bigint
)
language sql
stable
set search_path = ''
as $$
  with
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  ),
  validas as (
    select n.*
    from public.negociacoes n
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.funil_id = p_funil_id
  ),
  atuais as (
    select
      n.etapa_id,
      count(*) as qtd,
      sum(coalesce(f.valor_vendido, n.valor_estimado)) as valor,
      avg(extract(epoch from now() - n.data_entrada_etapa))
        filter (where e.tipo = 'aberta') as parados,
      count(*) filter (
        where e.tipo = 'aberta'
          and n.data_entrada_etapa < now() - interval '7 days'
      ) as parados_7
    from validas n
    join public.etapas_funil e on e.id = n.etapa_id
    left join public.fechamentos f on f.negociacao_id = n.id and e.tipo = 'ganha'
    cross join periodo
    where e.tipo = 'aberta'
       or (e.tipo = 'perdida'
           and n.data_entrada_etapa >= periodo.inicio
           and n.data_entrada_etapa <  periodo.fim)
       or (e.tipo = 'ganha' and f.data_fechamento between p_inicio and p_fim)
    group by n.etapa_id
  ),
  coorte as (
    select n.id, n.etapa_id
    from validas n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),
  alcance as (
    select
      co.id,
      max(e.ordem) filter (where e.tipo = 'aberta') as max_ordem,
      bool_or(e.tipo = 'ganha')   as ganhou,
      bool_or(e.tipo = 'perdida') as perdeu
    from coorte co
    join (
      select h.negociacao_id, h.etapa_nova_id as etapa_id from public.historico_etapas h
      union all
      select co2.id, co2.etapa_id from coorte co2
    ) passagem on passagem.negociacao_id = co.id
    join public.etapas_funil e on e.id = passagem.etapa_id
    where e.funil_id = p_funil_id
    group by co.id
  ),
  estadias as (
    select
      h.etapa_nova_id as etapa_id,
      h.created_at as entrada,
      lead(h.created_at) over (
        partition by h.negociacao_id
        order by h.created_at, h.id
      ) as saida
    from public.historico_etapas h
    join validas n on n.id = h.negociacao_id
  ),
  tempos as (
    select
      s.etapa_id,
      avg(extract(epoch from s.saida - s.entrada)) as media,
      count(*) as n
    from estadias s, periodo
    where s.saida is not null
      and s.saida >= periodo.inicio
      and s.saida <  periodo.fim
    group by s.etapa_id
  )
  select
    e.id,
    e.nome,
    e.cor,
    e.tipo,
    e.ordem,
    coalesce(a.qtd, 0),
    coalesce(a.valor, 0),
    case e.tipo
      when 'aberta'  then (select count(*) from alcance al where al.ganhou or al.max_ordem >= e.ordem)
      when 'ganha'   then (select count(*) from alcance al where al.ganhou)
      else                (select count(*) from alcance al where al.perdeu)
    end,
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0)
  from public.etapas_funil e
  left join atuais a on a.etapa_id = e.id
  left join tempos t on t.etapa_id = e.id
  where e.ativo
    and e.funil_id = p_funil_id
  order by e.ordem;
$$;

comment on function public.funil_metricas is
  'Métricas por etapa ativa de UM funil (quantidade, valor, alcance da coorte, tempo na etapa). SECURITY INVOKER.';

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Dashboard restrito ao Funil Principal nesta fase (decisão aprovada:
-- sem isso, o dia em que outro funil ganhar um card os números do dashboard
-- mudariam sozinhos). `metas_progresso` NÃO muda — meta é da pessoa/empresa,
-- não de um funil.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_por_usuario(
  p_inicio  date,
  p_fim     date
)
returns table (
  usuario_id           uuid,
  nome                 text,
  role                 public.user_role,
  pipeline_valor       numeric,
  abertas              bigint,
  vendido_valor        numeric,
  ganhos               bigint,
  perdidos             bigint,
  reunioes_proximas    bigint,
  reunioes_realizadas  bigint,
  atividades           bigint
)
language sql
stable
set search_path = ''
as $$
  with
  principal as (
    select id from public.funis where padrao
  ),
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  ),
  abertas as (
    select n.owner_id, sum(n.valor_estimado) as valor, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta'
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    cross join principal
    where n.funil_id = principal.id
    group by n.owner_id
  ),
  ganhos as (
    select n.owner_id, sum(f.valor_vendido) as valor, count(*) as qtd
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join principal
    where n.funil_id = principal.id
      and f.data_fechamento between p_inicio and p_fim
    group by n.owner_id
  ),
  perdidos as (
    select n.owner_id, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'perdida'
    cross join principal
    cross join periodo
    where n.funil_id = principal.id
      and n.data_entrada_etapa >= periodo.inicio
      and n.data_entrada_etapa <  periodo.fim
    group by n.owner_id
  ),
  reunioes as (
    select
      e.usuario_id,
      count(*) filter (
        where e.status = 'agendado'
          and e.inicio >= now()
          and e.inicio < now() + interval '7 days'
      ) as proximas,
      count(*) filter (
        where e.status = 'realizado'
          and e.inicio >= periodo.inicio
          and e.inicio <  periodo.fim
      ) as realizadas
    from public.eventos e, periodo
    where e.tipo in ('reuniao', 'apresentacao')
    group by e.usuario_id
  ),
  atividades as (
    select a.usuario_id, count(*) as qtd
    from public.atividades a, periodo
    where a.data >= periodo.inicio
      and a.data <  periodo.fim
    group by a.usuario_id
  )
  select
    p.id,
    p.nome,
    p.role,
    coalesce(ab.valor, 0),
    coalesce(ab.qtd, 0),
    coalesce(g.valor, 0),
    coalesce(g.qtd, 0),
    coalesce(pe.qtd, 0),
    coalesce(r.proximas, 0),
    coalesce(r.realizadas, 0),
    coalesce(at.qtd, 0)
  from public.profiles p
  left join abertas    ab on ab.owner_id  = p.id
  left join ganhos     g  on g.owner_id   = p.id
  left join perdidos   pe on pe.owner_id  = p.id
  left join reunioes   r  on r.usuario_id = p.id
  left join atividades at on at.usuario_id = p.id
  where (p.ativo and p.role = 'closer')
     or p.id = (select auth.uid())
     or ab.qtd > 0 or g.qtd > 0 or pe.qtd > 0
  order by coalesce(g.valor, 0) desc, p.nome;
$$;

create or replace function public.dashboard_etapas(
  p_inicio  date,
  p_fim     date
)
returns table (
  etapa_id    uuid,
  nome        text,
  cor         public.cor_etapa,
  tipo        public.tipo_etapa,
  ordem       numeric,
  quantidade  bigint,
  valor       numeric
)
language sql
stable
set search_path = ''
as $$
  with
  principal as (
    select id from public.funis where padrao
  ),
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  )
  select
    e.id,
    e.nome,
    e.cor,
    e.tipo,
    e.ordem,
    count(n.id),
    coalesce(sum(coalesce(f.valor_vendido, n.valor_estimado)), 0)
  from public.etapas_funil e
  cross join periodo
  left join public.negociacoes n
    on n.etapa_id = e.id
   and exists (
     select 1 from public.clientes c
     where c.id = n.cliente_id and c.deleted_at is null
   )
   and (
     e.tipo = 'aberta'
     or (e.tipo = 'perdida'
         and n.data_entrada_etapa >= periodo.inicio
         and n.data_entrada_etapa <  periodo.fim)
     or (e.tipo = 'ganha'
         and exists (
           select 1 from public.fechamentos ff
           where ff.negociacao_id = n.id
             and ff.data_fechamento between p_inicio and p_fim
         ))
   )
  left join public.fechamentos f
    on f.negociacao_id = n.id and e.tipo = 'ganha'
  where e.ativo
    and e.funil_id = (select id from principal)
  group by e.id, e.nome, e.cor, e.tipo, e.ordem
  order by e.ordem;
$$;

create or replace function public.dashboard_vendas_mensais(p_meses integer default 12)
returns table (
  mes         date,
  valor       numeric,
  quantidade  bigint
)
language sql
stable
set search_path = ''
as $$
  with meses as (
    select generate_series(
      date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
        - make_interval(months => greatest(p_meses, 1) - 1),
      date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date,
      interval '1 month'
    )::date as mes
  )
  select
    m.mes,
    coalesce(sum(f.valor_vendido), 0),
    count(f.negociacao_id)
  from meses m
  left join (
    public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    join public.funis fu on fu.id = n.funil_id and fu.padrao
  )
    on date_trunc('month', f.data_fechamento)::date = m.mes
  group by m.mes
  order by m.mes;
$$;

comment on function public.dashboard_por_usuario is
  'Números do dashboard por pessoa no período, restrito ao Funil Principal. SECURITY INVOKER.';
comment on function public.dashboard_etapas is
  'Quantidade e valor por etapa ativa do Funil Principal. Abertas: atual; ganha/perdida: no período.';
comment on function public.dashboard_vendas_mensais is
  'Valor vendido por mês de fechamento, restrito ao Funil Principal. SECURITY INVOKER.';

revoke all on function public.dashboard_por_usuario from public, anon;
revoke all on function public.dashboard_etapas from public, anon;
revoke all on function public.dashboard_vendas_mensais from public, anon;
grant execute on function public.dashboard_por_usuario to authenticated;
grant execute on function public.dashboard_etapas to authenticated;
grant execute on function public.dashboard_vendas_mensais to authenticated;

-- ---------------------------------------------------------------------------
-- 11. `funil_cards` ganha `funil_id` (coluna nova ao final — CREATE OR
-- REPLACE VIEW não pode reordenar nem remover colunas existentes).
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
  n.funil_id
from public.negociacoes n
join public.etapas_funil e
  on e.id = n.etapa_id
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
left join public.profiles p
  on p.id = n.owner_id
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
) ua on true;

comment on view public.funil_cards is
  'Um card do Kanban por negociação, com o funil a que pertence. security_invoker: respeita a RLS.';

revoke all on public.funil_cards from anon;
grant select on public.funil_cards to authenticated;
