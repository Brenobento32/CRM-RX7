-- ===========================================================================
-- Teste de fumaça de `public.funil_metricas` — instala a versão FINAL,
-- ATUAL (migration supabase/migrations/20261020140000_funil_metricas_
-- alcance_cumulativo.sql, ainda não aplicada em produção), nunca uma versão
-- antiga/superada. Cobre a especificação ORIGINAL (entidade única, coorte,
-- arquivamento/exclusão, dois funis/períodos) — o alcance CUMULATIVO, o
-- marcador `participa_conversao`, a coorte estendida a `atuais`/`perdidos`/
-- `tempos` e `desqualificados` têm sua PRÓPRIA cobertura dedicada, mais
-- extensa, em supabase/tests/funil_metricas_alcance_cumulativo_test.sql —
-- os dois arquivos instalam a MESMA função (nunca duas versões diferentes:
-- se um mudar, atualize o outro).
--
-- AUTO-INSTALAÇÃO TRANSACIONAL:
--   BEGIN
--     -> instala a coluna `etapas_funil.participa_conversao` (+ constraint
--        + backfill) e a versão ATUAL de public.funil_metricas (DROP +
--        CREATE + COMMENT + REVOKE + GRANT, EXATAMENTE copiados de
--        supabase/migrations/20261020140000_funil_metricas_alcance_cumulativo.sql
--        — se um dos dois arquivos mudar, atualize o outro)
--     -> cria os fixtures de teste
--     -> roda os asserts contra a função recém-instalada
--   ROLLBACK
--     -> DDL é transacional no Postgres: o ROLLBACK desfaz a coluna nova, a
--        constraint e o DROP+CREATE, junto com os dados — tudo volta a ser
--        exatamente como estava, como se nada tivesse acontecido.
--
--   Isso prova o CORPO da RPC contra o Postgres real de produção sem
--   persistir nada — nem a coluna/função nova, nem os fixtures.
--
-- CUIDADO DE CONCORRÊNCIA (não é destrutivo, mas é real): enquanto esta
--   transação está aberta (do BEGIN ao ROLLBACK), o DROP FUNCTION toma um
--   lock em public.funil_metricas que pode bloquear, por alguns
--   milissegundos, uma chamada REAL e concorrente de outro usuário em
--   /funil/metricas. O teste é rápido (cria ~10 negociações e roda os
--   asserts) e nada fica inconsistente — nenhuma outra sessão enxerga a
--   função nova nem o estado intermediário, isolamento de transação
--   padrão — mas, se possível, rode fora do horário de pico.
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. Ele
--   instala a função nova, cria um usuário, três funis de teste e uma
--   dezena de negociações cobrindo os casos de borda decididos na
--   especificação, faz as asserções e dá ROLLBACK no final: nada é
--   gravado, nem a função, nem os dados. Se alguma asserção falhar, a
--   execução para com erro, apontando exatamente qual regra quebrou.
--
--   Roda como `postgres` (superusuário) — bypassa RLS de propósito: este
--   teste prova a MATEMÁTICA da função, não visibilidade por papel (isso já
--   é coberto por rls_smoke_test.sql). Superusuário bypassa RLS, mas NUNCA
--   bypassa TRIGGER — por isso o script concede ao usuário de teste as
--   linhas de `permissoes_colaborador` que ele precisaria ter de verdade
--   pra mover essas negociações (trigger
--   `negociacoes_protege_movimentacao_por_permissao`, 20261014170000) e
--   impersona esse usuário via `set_config('request.jwt.claims', ...)`
--   (mesma técnica de rls_smoke_test.sql) — nenhuma regra de permissão é
--   relaxada, só concedida a quem precisa, nas etapas que precisa.
--
-- O QUE ELE PROVA (mapeado 1:1 na especificação aprovada)
--   1. Coorte = criadas no período, nunca reclassificada por avanço depois.
--   2. Entidade única / retorno: entrar 2x na mesma etapa conta 1.
--   3. Pulo de etapa: ATUALIZADO (alcance cumulativo, migration 20261020140000)
--      — pular uma etapa PRINCIPAL não perde o pulado (Cliente C pula
--      "Reunião" indo direto pra "Fechado"): "Reunião" AGORA conta C também
--      (crédito cumulativo — ver asserção própria), nunca mais "sem
--      inferência" pra etapas principais. Only etapas FORA do pipeline
--      (perdida/recuperação/participa_conversao=false) continuam sem
--      inferência nenhuma — não têm ordem de pipeline pra inferir.
--   4. Arquivamento: conta no histórico, nunca em "atual".
--   5. Exclusão (excluida_em): mesmo tratamento do arquivamento.
--   6. Cliente excluído (deleted_at): conta no histórico, nunca em "atual"
--      (Alternativa B, decisão definitiva).
--   7. Perdido -> Recuperação: perdido não desaparece da contagem.
--   8. Perdido deduplicado: 2 entradas em perdida no período = 1 contagem,
--      valor não duplica.
--   9. Ganhos sobrevivem arquivamento: venda histórica real nunca some do
--      financeiro por causa de um arquivamento posterior.
--   10. Zero leads: funil vazio não erra, só zera.
--   11. Dois funis: números nunca se misturam.
--   12. Dois períodos / "entrou fora, avançou dentro": coortes independentes.
--   13. Evolução até o momento: avanço depois do fim do período de entrada
--       ainda é contado em `alcancaram`.
--   14. ATUALIZADO (migration 20261020140000): "atual" (quantidade atual por
--       etapa) agora também exige pertencer à COORTE do período consultado
--       — H (criado em fevereiro) não conta mais em "quantidade atual de
--       Reunião" ao consultar janeiro, mesmo continuando aberto em Reunião
--       (antes contava, porque "atual" nunca olhava a data de criação —
--       bug corrigido por aquela migration, coberto em detalhe no outro
--       arquivo de teste).
-- ===========================================================================

begin;

-- ===========================================================================
-- Migration 20261020140000 JÁ APLICADA de verdade (coluna, backfill e as
-- três constraints já existem em produção) — esta instalação não recria
-- mais isso (um ADD COLUMN/ADD CONSTRAINT duplicado falharia, 42701/42710).
-- Recria só as FUNÇÕES/TRIGGER (CREATE OR REPLACE é idempotente: reinstala
-- byte a byte o mesmo corpo já ao vivo), pra provar o corpo exato contra o
-- schema real. DDL transacional: qualquer coisa que este arquivo ainda cria/
-- altera é desfeita pelo ROLLBACK no fim, junto com os fixtures.
-- ===========================================================================

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
    if new.nome is distinct from old.nome
       or new.ordem is distinct from old.ordem
       or new.tipo is distinct from old.tipo
       or new.sistema is distinct from old.sistema
       or new.chave is distinct from old.chave
       or new.ativo is distinct from old.ativo
       or new.funil_id is distinct from old.funil_id
       or new.pos_fechamento is distinct from old.pos_fechamento
       or new.participa_conversao is distinct from old.participa_conversao
    then
      raise exception 'Nas etapas padrão do funil só a cor pode ser alterada.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.sistema or new.chave is not null then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;

  if new.tipo = 'aberta' then
    if new.pos_fechamento then
      select max(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');

      if v_limite is not null and new.ordem <= v_limite then
        raise exception 'Etapas de recuperação ficam depois das etapas de fechamento do funil.'
          using errcode = '23514';
      end if;
    else
      select min(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');

      if v_limite is not null and new.ordem >= v_limite then
        raise exception 'Etapas abertas ficam antes das etapas de fechamento do funil.'
          using errcode = '23514';
      end if;
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

drop function if exists public.funil_metricas(date, date, uuid);

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
  pos_fechamento          boolean,
  participa_conversao     boolean,
  quantidade              bigint,
  valor                   numeric,
  alcancaram              bigint,
  tempo_medio_segundos    numeric,
  permanencias            bigint,
  parados_medio_segundos  numeric,
  parados_7_dias          bigint,
  total_entraram          bigint,
  desqualificados         bigint
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

  -- BASE HISTÓRICA: toda negociação do funil, sem nenhuma exclusão por
  -- estado de limpeza de cadastro. Usada por tudo que é histórico: coorte,
  -- alcance, ganhos, perdidos, tempo por etapa.
  historico_base as (
    select n.*
    from public.negociacoes n
    where n.funil_id = p_funil_id
  ),

  -- Coorte: toda negociação (histórica, sem exclusões) criada no período.
  -- Fixa para sempre — nunca reclassificada por avanço posterior. TODA
  -- métrica abaixo parte desta MESMA coorte.
  coorte as (
    select n.id
    from historico_base n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),

  total_entraram as (
    select count(*) as total from coorte
  ),

  -- BASE ATUAL: só oportunidades vivas agora, DA COORTE. Exclui cliente
  -- excluído e negociação arquivada/excluída (desqualificadas são
  -- contadas à parte, `desqualificados_coorte` abaixo).
  atuais_base as (
    select n.*
    from historico_base n
    join coorte co on co.id = n.id
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.arquivada_em is null
      and n.excluida_em is null
  ),

  -- Só etapas abertas: ganha e perdida têm CTEs históricas próprias
  -- abaixo, que nunca somem por arquivamento/exclusão posterior.
  atuais as (
    select
      n.etapa_id,
      count(*) as qtd,
      sum(n.valor_estimado) as valor,
      avg(extract(epoch from now() - n.data_entrada_etapa)) as parados,
      count(*) filter (where n.data_entrada_etapa < now() - interval '7 days') as parados_7
    from atuais_base n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta'
    group by n.etapa_id
  ),

  desqualificados_coorte as (
    select count(*) as total
    from historico_base n
    join coorte co on co.id = n.id
    where n.arquivada_em is not null
      and n.excluida_em is null
  ),

  -- Alcance BRUTO = evolução da coorte ATÉ AGORA. EXISTS real em
  -- historico_etapas, sem filtro de data. Continua sendo o `alcancaram` de
  -- etapas FORA do pipeline principal (perdida, recuperação,
  -- participa_conversao=false); para etapas PRINCIPAIS, é CUMULATIVO (ver
  -- `etapas_principais`/`alcance_cumulativo`/`alcance_ganha` abaixo).
  alcancaram as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id
    group by h.etapa_nova_id
  ),

  etapas_principais as (
    select e.id, e.ordem, e.tipo
    from public.etapas_funil e
    where e.funil_id = p_funil_id
      and e.ativo
      and e.tipo <> 'perdida'
      and not e.pos_fechamento
      and e.participa_conversao
  ),

  alcance_fisico_principal as (
    select distinct h.negociacao_id, ep.ordem
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join etapas_principais ep on ep.id = h.etapa_nova_id
  ),

  maior_ordem_fisica as (
    select negociacao_id, max(ordem) as ordem
    from alcance_fisico_principal
    group by negociacao_id
  ),

  alcance_cumulativo as (
    select ep.id as etapa_id, count(distinct m.negociacao_id) as qtd
    from etapas_principais ep
    join maior_ordem_fisica m on m.ordem >= ep.ordem
    where ep.tipo <> 'ganha'
    group by ep.id
  ),

  alcance_ganha as (
    select ep.id as etapa_id, count(distinct m.negociacao_id) as qtd
    from etapas_principais ep
    join maior_ordem_fisica m on m.ordem >= ep.ordem
    join public.fechamentos f on f.negociacao_id = m.negociacao_id and f.anulado_em is null
    where ep.tipo = 'ganha'
    group by ep.id
  ),

  -- Ganhos no período: venda histórica real (fechamentos.data_fechamento),
  -- NÃO ANULADA, sobre a base histórica completa — nunca apaga uma venda já
  -- realizada por causa de um arquivamento/exclusão posterior da
  -- negociação. Métrica FINANCEIRA por data, nunca pro alcance da coorte
  -- (esse é `alcance_ganha`, acima). fechamentos é 1:1 com negociacao_id:
  -- sem necessidade de deduplicar.
  ganhos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'ganha') as etapa_id,
      count(*) as qtd,
      sum(f.valor_vendido) as valor
    from public.fechamentos f
    join historico_base n on n.id = f.negociacao_id
    where f.data_fechamento between p_inicio and p_fim
      and f.anulado_em is null
  ),

  -- Perdido DA COORTE: negociações da coorte que alcançaram a etapa
  -- perdida, não importa quando o evento aconteceu — mesma lógica de
  -- "evolução até o momento" do alcance.
  --
  -- `valor` aqui é negociacoes.valor_estimado — campo ATUAL, sem
  -- histórico de alterações (o schema não guarda snapshot por data).
  -- É uma aproximação, nunca o valor real no momento da perda: a UI
  -- NUNCA deve apresentá-lo como indicador financeiro confiável sem
  -- rotulá-lo como estimado/aproximado.
  negociacoes_perdidas_coorte as (
    select distinct h.negociacao_id
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id and e.tipo = 'perdida'
  ),
  perdidos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'perdida') as etapa_id,
      count(*) as qtd,
      sum(n.valor_estimado) as valor
    from negociacoes_perdidas_coorte p
    join historico_base n on n.id = p.negociacao_id
  ),

  -- Tempo por etapa: permanência real de negociações DA COORTE, completa
  -- até agora (sem filtrar pela data em que a permanência terminou).
  estadias as (
    select
      h.etapa_nova_id as etapa_id,
      h.created_at as entrada,
      lead(h.created_at) over (
        partition by h.negociacao_id order by h.created_at, h.id
      ) as saida
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join historico_base n on n.id = h.negociacao_id
  ),
  tempos as (
    select
      s.etapa_id,
      avg(extract(epoch from s.saida - s.entrada)) as media,
      count(*) as n
    from estadias s
    where s.saida is not null
    group by s.etapa_id
  )

  select
    e.id,
    e.nome,
    e.cor,
    e.tipo,
    e.ordem,
    e.pos_fechamento,
    e.participa_conversao,
    case e.tipo
      when 'perdida' then coalesce(pp.qtd, 0)
      when 'ganha'   then coalesce(gp.qtd, 0)
      else                coalesce(a.qtd, 0)
    end,
    case e.tipo
      when 'perdida' then coalesce(pp.valor, 0)
      when 'ganha'   then coalesce(gp.valor, 0)
      else                coalesce(a.valor, 0)
    end,
    case
      when e.tipo = 'ganha'
        then coalesce(ag.qtd, 0)
      when e.tipo <> 'perdida' and not e.pos_fechamento and e.participa_conversao
        then coalesce(ac.qtd, 0)
      else coalesce(al.qtd, 0)
    end,
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0),
    (select total from total_entraram),
    (select total from desqualificados_coorte)
  from public.etapas_funil e
  left join atuais              a  on a.etapa_id = e.id
  left join alcancaram          al on al.etapa_id = e.id
  left join alcance_cumulativo  ac on ac.etapa_id = e.id
  left join alcance_ganha       ag on ag.etapa_id = e.id
  left join ganhos_periodo   gp on gp.etapa_id = e.id
  left join perdidos_periodo pp on pp.etapa_id = e.id
  left join tempos           t  on t.etapa_id = e.id
  where e.ativo
    and e.funil_id = p_funil_id
  order by e.ordem;
$$;

comment on function public.funil_metricas is
  'Métricas por etapa ativa de UM funil, entidade única, TUDO a partir da '
  'MESMA coorte (negociação do funil + criada no período, fuso '
  'America/Sao_Paulo, ">= início" e "< fim + 1 dia"). Alcançaram de etapa '
  'PRINCIPAL (tipo <> perdida, não pós-fechamento, participa_conversao) é '
  'CUMULATIVO: alcançar uma etapa principal mais avançada (fisicamente, via '
  'historico_etapas) conta como tendo alcançado todas as anteriores — nunca '
  'fabrica historico_etapas, só reagrega por ordem. Ganha é a única '
  'exceção: além da maior ordem física alcançada cobrir a dela, exige '
  'também um fechamento com anulado_em is null pra contar como alcançada — '
  'um fechamento anulado não invalida o crédito das etapas principais '
  'anteriores, só o de ganha em si, mesmo que o fechamento tenha ocorrido '
  'depois do fim do período: a coorte evolui até o momento da consulta. '
  'Alcançaram de etapa LATERAL (perdida, recuperação, '
  'participa_conversao=false) é bruto (EXISTS real na COORTE, não '
  'cumulativo). Ganhos/fechadoValor (quantidade/valor da linha ganha) são '
  'a ÚNICA métrica financeira por DATA (fechamentos.data_fechamento, não '
  'anulada) — pras telas de faturamento, nunca pro alcance/conversão da '
  'coorte. Atual (quantidade/valor/parados de etapas abertas) e tempos '
  '(permanência por etapa) exigem pertencer à coorte, além de excluir '
  'arquivada/excluída/cliente-excluído. Desqualificados é um total único '
  'da coorte (arquivada_em is not null, excluida_em is null), repetido em '
  'toda linha como total_entraram, nunca por etapa. SECURITY INVOKER.';

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;

-- `criar_funil`/`duplicar_funil` atualizadas (cópia EXATA das seções 4/5 de
-- 20261020140000) — os asserts 1/6 abaixo (criação normaliza, duplicação
-- preserva participa_conversao) exercitam exatamente estas duas funções.
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

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao)
  values (v_funil_id, p_etapa_ganha_nome, p_etapa_ganha_cor, 100000, 'ganha', true);

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao)
  values (v_funil_id, p_etapa_perdida_nome, p_etapa_perdida_cor, 100001, 'perdida', false);

  for v_item in select * from jsonb_array_elements(coalesce(p_etapas_abertas, '[]'::jsonb))
  loop
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao)
    values (
      v_funil_id,
      v_item ->> 'nome',
      (v_item ->> 'cor')::public.cor_etapa,
      v_ordem,
      'aberta',
      true
    );
    v_ordem := v_ordem + 1000;
  end loop;

  return v_funil_id;
end;
$$;

revoke all on function public.criar_funil from public, anon;
grant execute on function public.criar_funil to authenticated;

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

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento, participa_conversao)
  select v_novo_id, e.nome, e.cor, e.ordem, e.tipo, e.pos_fechamento, e.participa_conversao
    from public.etapas_funil e
   where e.funil_id = p_funil_id
   order by e.ordem;

  return v_novo_id;
end;
$$;

revoke all on function public.duplicar_funil from public, anon;
grant execute on function public.duplicar_funil to authenticated;

-- ===========================================================================
-- Fixtures + asserts.
-- ===========================================================================

do $$
declare
  v_usuario uuid := 'a1111111-1111-1111-1111-111111111111';

  v_funil1_id         uuid;
  v_etapa_lead_novo   uuid;
  v_etapa_reuniao     uuid;
  v_etapa_fechado     uuid;
  v_etapa_perdido     uuid;
  v_etapa_recuperacao uuid;

  v_funil2_id    uuid;
  v_etapa2_aberta uuid;

  v_funil3_id uuid; -- funil vazio, pro caso "zero leads"

  v_cliente_a uuid; v_neg_a uuid;
  v_cliente_b uuid; v_neg_b uuid;
  v_cliente_c uuid; v_neg_c uuid;
  v_cliente_d uuid; v_neg_d uuid;
  v_cliente_e uuid; v_neg_e uuid;
  v_cliente_f uuid; v_neg_f uuid;
  v_cliente_g uuid; v_neg_g uuid;
  v_cliente_h uuid; v_neg_h uuid;
  v_cliente_i uuid; v_neg_i uuid;
  v_cliente_x uuid; v_neg_x uuid; -- outro funil

  r_lead_novo   record;
  r_reuniao     record;
  r_fechado     record;
  r_perdido     record;
  r_recuperacao record;
  r             record;
  v_total       integer;

  -- Seção 13 (constraints/criar_funil/duplicar_funil/independência de nome).
  v_falhou              boolean;
  v_funil_cf_id         uuid;
  v_etapa_cf_ganha      uuid;
  v_etapa_cf_perdida    uuid;
  v_etapa_cf_aberta     uuid;
  v_etapa_cf_lateral    uuid;
  v_funil_dup_id        uuid;
  v_etapa_dup_lateral   uuid;
begin
  -- -------------------------------------------------------------------
  -- 0. Massa de teste: usuário, 3 funis.
  -- -------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    v_usuario, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'teste.funil.metricas@teste.local', '', now(), now(), now(),
    '{}'::jsonb, '{"nome":"Closer Teste Métricas"}'::jsonb
  );

  insert into public.funis (nome, padrao) values ('Teste funil_metricas 1', false)
    returning id into v_funil1_id;
  insert into public.funis (nome, padrao) values ('Teste funil_metricas 2', false)
    returning id into v_funil2_id;
  insert into public.funis (nome, padrao) values ('Teste funil_metricas vazio', false)
    returning id into v_funil3_id;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Lead Novo', 'turquesa', 500, 'aberta') returning id into v_etapa_lead_novo;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Reunião', 'azul', 1000, 'aberta') returning id into v_etapa_reuniao;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Fechado', 'verde', 100000, 'ganha') returning id into v_etapa_fechado;
  -- `participa_conversao` explícito abaixo em toda linha perdida/pós-
  -- fechamento (nunca o default true, que agora violaria as constraints
  -- novas etapas_funil_perdida_nao_participa_conversao/
  -- etapas_funil_pos_fechamento_nao_participa_conversao).
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao) values
    (v_funil1_id, 'Perdido', 'vermelho', 100001, 'perdida', false) returning id into v_etapa_perdido;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento, participa_conversao) values
    (v_funil1_id, 'Recuperação', 'cinza', 100002, 'aberta', true, false) returning id into v_etapa_recuperacao;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil2_id, 'Aberta', 'azul', 1000, 'aberta') returning id into v_etapa2_aberta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil2_id, 'Fechado', 'verde', 100000, 'ganha');
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao) values
    (v_funil2_id, 'Perdido', 'vermelho', 100001, 'perdida', false);

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil3_id, 'Única', 'azul', 1000, 'aberta');
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil3_id, 'Fechado', 'verde', 100000, 'ganha');
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao) values
    (v_funil3_id, 'Perdido', 'vermelho', 100001, 'perdida', false);

  -- Caso X: outro funil (funil2), período 1 — prova que os números de um
  -- funil nunca aparecem no resultado do outro. Fica ANTES do `set_config`
  -- de impersonação (abaixo) de propósito: desde
  -- 20261015110000_criacao_manual_sdr_e_integridade_cliente.sql, todo INSERT
  -- em `negociacoes` passa por `negociacoes_protege_criacao_por_permissao`,
  -- que só deixa passar automação (auth.uid() null) ou quem tem
  -- `pode_mover_etapa` na etapa de destino — e `v_usuario` (impersonado
  -- abaixo) deliberadamente não tem NENHUMA permissão em v_funil2_id (ver
  -- comentário da seção 0b). Isto não é teste de permissão — é só massa de
  -- dados para provar isolamento entre funis em `funil_metricas` — por isso
  -- é criado como automação, antes de qualquer impersonação, exatamente como
  -- o restante da massa de dados desta função.
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente X', v_usuario)
    returning id into v_cliente_x;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_x, v_etapa2_aberta)
    returning id into v_neg_x;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_x;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_x;

  -- -------------------------------------------------------------------
  -- 0b. Permissão comercial do usuário de teste.
  --
  -- `v_usuario` é 'closer' (role padrão do trigger de criação de profile,
  -- raw_app_meta_data vazio) — então toda UPDATE de etapa_id passa pelo
  -- trigger `negociacoes_protege_movimentacao_por_permissao`
  -- (20261014170000), que exige `pode_mover_etapa(funil_id, etapa_destino)`
  -- pra quem não é gerente. `pode_mover_etapa`/`is_gerente` leem
  -- `auth.uid()` — e este script roda como `postgres` (superusuário:
  -- ignora RLS, mas NUNCA ignora trigger), sem nenhuma sessão JWT, então
  -- `auth.uid()` seria NULL sem o `set_config` abaixo.
  --
  -- Em vez de usar gerente (que bypassa esse E o trigger de handoff numa
  -- tacada só, mascarando bug), concedemos exatamente as linhas de
  -- `permissoes_colaborador` que o fluxo real exigiria: acesso ao funil de
  -- teste (linha com etapa_id null) + pode_ver/pode_mover=true em CADA
  -- etapa que os cenários abaixo de fato movimentam (as 5 etapas de
  -- v_funil1_id — nenhuma etapa de v_funil2_id/v_funil3_id, que nunca são
  -- alvo de UPDATE de etapa_id nos cenários). Nenhuma regra do sistema é
  -- relaxada: é a MESMA permissão que um closer real precisaria ter pra
  -- fazer essas movimentações de verdade.
  -- -------------------------------------------------------------------
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values (v_usuario, v_funil1_id, null, null, null, v_usuario);

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values
    (v_usuario, v_funil1_id, v_etapa_lead_novo,   true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_reuniao,     true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_fechado,     true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_perdido,     true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_recuperacao, true, true, v_usuario);

  -- Impersona v_usuario pro resto da transação (reverte sozinho no ROLLBACK
  -- final) — mesma técnica de rls_smoke_test.sql. A partir daqui,
  -- auth.uid() = v_usuario em qualquer função que o leia.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);

  -- -------------------------------------------------------------------
  -- Caso A: entra em Lead Novo, nunca avança. Período 1 (jan/2024).
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente A', v_usuario)
    returning id into v_cliente_a;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_a, v_etapa_lead_novo)
    returning id into v_neg_a;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_a;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_a;

  -- -------------------------------------------------------------------
  -- Caso B: Lead Novo -> Reunião -> Lead Novo -> Reunião (retorno à mesma
  -- etapa duas vezes cada). Entidade única: "alcançaram" de cada etapa
  -- tem que contar 1, nunca 2.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente B', v_usuario)
    returning id into v_cliente_b;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_b, v_etapa_lead_novo)
    returning id into v_neg_b;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_b;
  update public.negociacoes set etapa_id = v_etapa_lead_novo where id = v_neg_b;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_b;
  update public.negociacoes set created_at = '2024-01-11' where id = v_neg_b;
  update public.historico_etapas set created_at = '2024-01-11' where negociacao_id = v_neg_b;

  -- -------------------------------------------------------------------
  -- Caso C: Lead Novo -> Fechado DIRETO, pulando Reunião. Sem inferência:
  -- "alcançaram" de Reunião NUNCA pode contar C. Depois de vendida, a
  -- negociação é arquivada — a venda tem que sobreviver no financeiro.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente C', v_usuario)
    returning id into v_cliente_c;
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cliente_c, v_etapa_lead_novo, 1000)
    returning id into v_neg_c;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_c, 9000, '2024-01-15', true, true, 'pago', 'concluido', v_usuario, 'tcv'
  );
  update public.negociacoes set etapa_id = v_etapa_fechado where id = v_neg_c;
  execute 'set constraints all immediate'; -- força checar já "ganha exige fechamento" (deve passar)
  execute 'set constraints all deferred';
  update public.negociacoes set created_at = '2024-01-12' where id = v_neg_c;
  update public.historico_etapas set created_at = '2024-01-12' where negociacao_id = v_neg_c;
  -- Arquivada DEPOIS de vendida — a venda já aconteceu, não pode desaparecer.
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste: arquivada após venda'
    where id = v_neg_c;

  -- -------------------------------------------------------------------
  -- Caso D: Lead Novo -> Perdido -> Recuperação -> Perdido DE NOVO, tudo
  -- no mesmo período. Perdido tem que contar 1 (deduplicado), nunca 2;
  -- Recuperação é zona separada, tem sua própria contagem.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente D', v_usuario)
    returning id into v_cliente_d;
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cliente_d, v_etapa_lead_novo, 2000)
    returning id into v_neg_d;
  update public.negociacoes set etapa_id = v_etapa_perdido, motivo_perda = 'teste' where id = v_neg_d;
  update public.negociacoes set etapa_id = v_etapa_recuperacao where id = v_neg_d;
  update public.negociacoes set etapa_id = v_etapa_perdido, motivo_perda = 'teste de novo' where id = v_neg_d;
  update public.negociacoes set created_at = '2024-01-13' where id = v_neg_d;
  update public.historico_etapas set created_at = '2024-01-13' where negociacao_id = v_neg_d;

  -- -------------------------------------------------------------------
  -- Caso E: alcança Reunião e é arquivada. Conta no histórico, não em
  -- "atual".
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente E', v_usuario)
    returning id into v_cliente_e;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_e, v_etapa_lead_novo)
    returning id into v_neg_e;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_e;
  update public.negociacoes set created_at = '2024-01-14' where id = v_neg_e;
  update public.historico_etapas set created_at = '2024-01-14' where negociacao_id = v_neg_e;
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste: desqualificado'
    where id = v_neg_e;

  -- -------------------------------------------------------------------
  -- Caso F: alcança Reunião e é excluída (arquivada + excluída). Mesmo
  -- tratamento de E.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente F', v_usuario)
    returning id into v_cliente_f;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_f, v_etapa_lead_novo)
    returning id into v_neg_f;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_f;
  update public.negociacoes set created_at = '2024-01-15' where id = v_neg_f;
  update public.historico_etapas set created_at = '2024-01-15' where negociacao_id = v_neg_f;
  update public.negociacoes
     set arquivada_em = now(), motivo_arquivamento = 'teste',
         excluida_em = now(), excluida_por = v_usuario, motivo_exclusao = 'teste: exclusão definitiva'
   where id = v_neg_f;

  -- -------------------------------------------------------------------
  -- Caso G: alcança Reunião; a negociação em si nunca é tocada (campos de
  -- arquivamento próprios ficam null), mas o CLIENTE é excluído (deleted_at)
  -- depois. Alternativa B: conta no histórico, some só de "atual".
  --
  -- FIXTURE ATUALIZADA (achado desta rodada, não é regressão de
  -- `funil_metricas`): desde 20261015110000_criacao_manual_sdr_e_integridade_
  -- cliente.sql, o trigger `clientes_protege_arquivamento_com_negociacao_
  -- ativa` bloqueia `clientes.deleted_at` virar not null enquanto existir
  -- negociação não arquivada/excluída daquele cliente — de propósito,
  -- backstop contra "negociação ativa presa a cliente arquivado". Esta
  -- fixture tentava excluir o cliente com a negociação ainda aberta, estado
  -- que o próprio banco não permite mais alcançar (nem pela UI, nem por SQL
  -- direto) — por isso arquivamos a negociação ANTES de excluir o cliente,
  -- preservando a pergunta original do teste ("histórico nunca some por
  -- cliente excluído") sob o único caminho que o banco hoje de fato permite.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente G', v_usuario)
    returning id into v_cliente_g;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_g, v_etapa_lead_novo)
    returning id into v_neg_g;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_g;
  update public.negociacoes set created_at = '2024-01-16' where id = v_neg_g;
  update public.historico_etapas set created_at = '2024-01-16' where negociacao_id = v_neg_g;
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste: cliente será excluído a seguir'
   where id = v_neg_g;
  update public.clientes set deleted_at = now() where id = v_cliente_g;

  -- -------------------------------------------------------------------
  -- Caso H: criada FORA do período 1 (fev/2024), avança DENTRO do mesmo
  -- mês (fev). Prova coorte por created_at + independência entre períodos.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente H', v_usuario)
    returning id into v_cliente_h;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_h, v_etapa_lead_novo)
    returning id into v_neg_h;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_h;
  update public.negociacoes set created_at = '2024-02-05' where id = v_neg_h;
  update public.historico_etapas set created_at = '2024-02-05' where negociacao_id = v_neg_h;

  -- -------------------------------------------------------------------
  -- Caso I: criada no período 1 (jan/2024), mas avança para Reunião só em
  -- março — "conversão da coorte, evolução até o momento". Consultando
  -- com o período 1, `alcancaram` de Reunião TEM que incluir I mesmo
  -- assim.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente I', v_usuario)
    returning id into v_cliente_i;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_i, v_etapa_lead_novo)
    returning id into v_neg_i;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_i;
  update public.negociacoes set created_at = '2024-01-20' where id = v_neg_i;
  update public.historico_etapas set created_at = '2024-01-20'
    where negociacao_id = v_neg_i and etapa_nova_id = v_etapa_lead_novo;
  update public.historico_etapas set created_at = '2024-03-05'
    where negociacao_id = v_neg_i and etapa_nova_id = v_etapa_reuniao;

  -- Caso X (outro funil) já foi criado mais acima, ANTES da impersonação —
  -- ver comentário na seção 0.

  -- =====================================================================
  -- ASSERÇÕES — funil 1, período 1 (jan/2024).
  -- Coorte: A, B, C, D, E, F, G, I = 8. (H é fev; X é outro funil.)
  -- =====================================================================
  select * into r_lead_novo   from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Lead Novo';
  select * into r_reuniao     from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Reunião';
  select * into r_fechado     from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Fechado';
  select * into r_perdido     from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Perdido';
  select * into r_recuperacao from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Recuperação';

  -- 1. Coorte / total_entraram: só quem foi CRIADO em janeiro (A,B,C,D,E,F,G,I) — H (fev) fora.
  assert r_lead_novo.total_entraram = 8,
    format('total_entraram deveria ser 8 (A,B,C,D,E,F,G,I), veio %s', r_lead_novo.total_entraram);

  -- 2/3. Entidade única + ALCANCE CUMULATIVO (migration 20261020140000):
  -- Reunião foi alcançada por B, E, F, G, I fisicamente (5) — MAIS C, que
  -- agora conta TAMBÉM, por crédito cumulativo: C pulou direto pra Fechado
  -- (ordem bem maior que a de Reunião), e alcançar uma etapa principal mais
  -- avançada credita todas as anteriores — nunca mais "sem inferência" pra
  -- etapas do pipeline principal (ver migration). Nunca por A (nunca saiu
  -- de Lead Novo), nunca por D (foi pra Perdido/Recuperação, que não são
  -- principais, nunca entram no crédito cumulativo). B conta 1, mesmo tendo
  -- entrado em Reunião duas vezes (retorno).
  assert r_reuniao.alcancaram = 6,
    format('alcancaram(Reunião) deveria ser 6 (B,C,E,F,G,I — C cumulativo), veio %s', r_reuniao.alcancaram);

  -- 4/5/6/14. Arquivamento/exclusão/cliente excluído + COORTE (migration
  -- 20261020140000): E, F e G alcançaram Reunião (contam no histórico
  -- acima) mas NUNCA aparecem em "atual" — B e I continuam válidas e
  -- atualmente em Reunião (2). H NÃO conta mais aqui: "atual" agora também
  -- exige pertencer à COORTE do período consultado (H foi criado em
  -- fevereiro — fora da coorte de janeiro), mesmo H continuando aberto em
  -- Reunião o tempo todo (bug corrigido por aquela migration — antes H
  -- contava, porque "atual" nunca olhava a data de criação da negociação).
  assert r_reuniao.quantidade = 2,
    format('quantidade atual de Reunião deveria ser 2 (B, I — E/F/G excluídos por arquivamento, H fora da coorte de janeiro), veio %s', r_reuniao.quantidade);

  -- 9. Ganhos sobrevivem arquivamento: C foi vendida (R$ 9000) e arquivada
  -- DEPOIS — o financeiro histórico não pode apagar a venda.
  assert r_fechado.quantidade = 1 and r_fechado.valor = 9000,
    format('Fechado deveria ter 1 venda de 9000 (sobrevive ao arquivamento de C), veio qtd=%s valor=%s',
      r_fechado.quantidade, r_fechado.valor);
  assert r_fechado.alcancaram = 1, format('alcancaram(Fechado) deveria ser 1 (C), veio %s', r_fechado.alcancaram);

  -- 7/8. Perdido: D entrou em Perdido DUAS vezes — tem que contar 1 (não
  -- 2), e o valor (2000, de D) não pode dobrar para 4000. `perdidos_periodo`
  -- agora é por COORTE (migration 20261020140000), não mais por data do
  -- evento — mesmo resultado aqui porque D já é da coorte de qualquer jeito
  -- (a diferença só aparece quando a perda acontece fora do período, caso
  -- coberto em funil_metricas_alcance_cumulativo_test.sql).
  assert r_perdido.quantidade = 1 and r_perdido.valor = 2000,
    format('Perdido deveria ter 1 negociação (D, deduplicada) de valor 2000, veio qtd=%s valor=%s',
      r_perdido.quantidade, r_perdido.valor);
  assert r_perdido.alcancaram = 1, format('alcancaram(Perdido) deveria ser 1 (D), veio %s', r_perdido.alcancaram);

  -- Recuperação é zona separada: D também alcançou Recuperação, com sua
  -- própria contagem — independente de Perdido.
  assert r_recuperacao.alcancaram = 1,
    format('alcancaram(Recuperação) deveria ser 1 (D), veio %s', r_recuperacao.alcancaram);
  assert r_recuperacao.pos_fechamento is true, 'Recuperação deveria vir com pos_fechamento = true';

  -- =====================================================================
  -- 13. Evolução até o momento: I entrou em janeiro, só alcançou Reunião
  -- em março — mas consultando com o período de janeiro, I já está
  -- contado no alcancaram(Reunião) acima (6, não 5). Confirma de novo,
  -- isolado, pra deixar explícito o que está sendo provado.
  -- =====================================================================
  select count(*) into v_total
    from public.historico_etapas h
   where h.negociacao_id = v_neg_i
     and h.etapa_nova_id = v_etapa_reuniao
     and h.created_at > '2024-01-31'; -- a entrada real de I em Reunião é em março
  assert v_total = 1, 'a entrada de I em Reunião deveria estar fora do período 1 (março), por construção do teste';
  -- ... e MESMO ASSIM r_reuniao.alcancaram (acima) já inclui I: a asserção
  -- "alcancaram(Reunião) = 6" só fecha com I (e C, cumulativo) contados.

  -- =====================================================================
  -- 10. Zero leads: funil vazio não erra, só zera.
  -- =====================================================================
  for r in select * from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) loop
    assert r.quantidade = 0 and r.alcancaram = 0 and r.total_entraram = 0,
      format('funil vazio deveria ter tudo zero na etapa %s, veio qtd=%s alcancaram=%s total=%s',
        r.nome, r.quantidade, r.alcancaram, r.total_entraram);
  end loop;

  -- =====================================================================
  -- 11. Dois funis nunca se misturam: funil2 (só X) não pode aparecer no
  -- resultado do funil1, e vice-versa.
  -- =====================================================================
  select total_entraram into v_total
    from public.funil_metricas('2024-01-01', '2024-01-31', v_funil2_id)
   where nome = 'Aberta';
  assert v_total = 1, format('total_entraram do funil2 deveria ser 1 (só X), veio %s', v_total);

  -- O funil1 continua em 8 mesmo com X existindo em outro funil no mesmo período.
  assert r_lead_novo.total_entraram = 8, 'total_entraram do funil1 não pode mudar por causa de outro funil';

  -- =====================================================================
  -- 12. Dois períodos independentes: consultando funil1 no período de
  -- fevereiro, só H entra na coorte (1), e ele já alcançou Reunião.
  -- =====================================================================
  select * into r from public.funil_metricas('2024-02-01', '2024-02-29', v_funil1_id) where nome = 'Reunião';
  assert r.total_entraram = 1, format('total_entraram de fevereiro deveria ser 1 (só H), veio %s', r.total_entraram);
  assert r.alcancaram = 1, format('alcancaram(Reunião) de fevereiro deveria ser 1 (H), veio %s', r.alcancaram);

  -- =====================================================================
  -- 13. Constraints estruturais completas + criar_funil + duplicar_funil +
  -- independência de nome (pendências fechadas nesta rodada).
  -- =====================================================================

  -- 13.1 (asserts 1-3): o banco recusa a combinação incoerente mesmo por
  -- UPDATE direto, nunca só pelo filtro da RPC.
  v_falhou := false;
  begin
    update public.etapas_funil set participa_conversao = false where id = v_etapa_fechado;
  exception when sqlstate '23514' then
    v_falhou := true;
  end;
  assert v_falhou, 'assert 1: ganha->participa_conversao=false deveria ser recusado (23514)';

  v_falhou := false;
  begin
    update public.etapas_funil set participa_conversao = true where id = v_etapa_perdido;
  exception when sqlstate '23514' then
    v_falhou := true;
  end;
  assert v_falhou, 'assert 2: perdida->participa_conversao=true deveria ser recusado (23514)';

  v_falhou := false;
  begin
    update public.etapas_funil set participa_conversao = true where id = v_etapa_recuperacao;
  exception when sqlstate '23514' then
    v_falhou := true;
  end;
  assert v_falhou, 'assert 3: pós-fechamento->participa_conversao=true deveria ser recusado (23514)';

  -- 13.2 (asserts 4-5): criar_funil() grava participa_conversao correto em
  -- cada tipo, sem precisar de normalização externa — aberta principal=true
  -- "funciona" (nasce participante, soma nos agregados abaixo), aberta
  -- lateral=false "funciona" (inserida à parte, com participa_conversao=false
  -- explícito, nunca contaminando os agregados).
  v_funil_cf_id := public.criar_funil(
    'Teste constraints completas', 'Fechado CF', 'verde', 'Perdido CF', 'vermelho',
    '[{"nome":"Aberta principal CF","cor":"azul"}]'::jsonb
  );
  select id into v_etapa_cf_ganha from public.etapas_funil where funil_id = v_funil_cf_id and tipo = 'ganha';
  select id into v_etapa_cf_perdida from public.etapas_funil where funil_id = v_funil_cf_id and tipo = 'perdida';
  select id into v_etapa_cf_aberta from public.etapas_funil
    where funil_id = v_funil_cf_id and nome = 'Aberta principal CF';

  assert (select participa_conversao from public.etapas_funil where id = v_etapa_cf_ganha) is true,
    'assert 4 (parte ganha): criar_funil deveria gravar participa_conversao=true na etapa ganha';
  assert (select participa_conversao from public.etapas_funil where id = v_etapa_cf_perdida) is false,
    'criar_funil deveria gravar participa_conversao=false na etapa perdida';
  assert (select participa_conversao from public.etapas_funil where id = v_etapa_cf_aberta) is true,
    'assert 4: criar_funil deveria gravar participa_conversao=true na aberta principal';

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao)
  values (v_funil_cf_id, 'No Show CF', 'cinza', 1500, 'aberta', false)
  returning id into v_etapa_cf_lateral;

  assert (select participa_conversao from public.etapas_funil where id = v_etapa_cf_lateral) is false,
    'assert 5: aberta lateral=false deveria ser aceita (etapa aberta normal, combinação livre)';

  -- Prova que a lateral=false "funciona" de verdade na RPC (fora dos
  -- agregados principais), dando entrada a uma negociação real nela. Tira a
  -- impersonação por um instante (volta a auth.uid() nulo = automação, que
  -- negociacoes_protege_criacao_por_permissao sempre deixa passar — ver
  -- 20261015110000): v_usuario não tem nenhuma permissão configurada em
  -- v_funil_cf_id (criado ad-hoc nesta seção), e não é o propósito deste
  -- bloco testar permissão, só a matemática da RPC.
  perform set_config('request.jwt.claims', '', true);
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente CF Lateral', v_usuario)
    returning id into v_cliente_a; -- reaproveita a var só como scratch local
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_a, v_etapa_cf_lateral)
    returning id into v_neg_a; -- idem

  select * into r from public.funil_metricas(current_date, current_date, v_funil_cf_id)
   where nome = 'No Show CF';
  assert r.participa_conversao is false, 'assert 5: RPC deveria devolver participa_conversao=false pra esta etapa';
  assert r.quantidade = 1, 'assert 5: a etapa lateral=false deveria aparecer com 1 negociação (funciona normalmente)';

  -- 13.3 (assert 6): duplicar_funil() preserva participa_conversao=false da
  -- lateral (e pos_fechamento, sem o qual a duplicação nem completaria para
  -- um funil com zona de recuperação — ver comentário da migration).
  v_funil_dup_id := public.duplicar_funil(v_funil_cf_id, 'Teste constraints completas (cópia)');
  select id into v_etapa_dup_lateral from public.etapas_funil
    where funil_id = v_funil_dup_id and nome = 'No Show CF';
  assert v_etapa_dup_lateral is not null, 'assert 6: duplicar_funil deveria ter copiado a etapa lateral';
  assert (select participa_conversao from public.etapas_funil where id = v_etapa_dup_lateral) is false,
    'assert 6: duplicar_funil deveria preservar participa_conversao=false na cópia da lateral';

  -- 13.4 (assert 7): renomear a etapa lateral nunca muda sua classificação —
  -- só o marcador estruturado decide, nunca o nome.
  update public.etapas_funil set nome = 'Agendamento remarcado' where id = v_etapa_cf_lateral;
  assert (select participa_conversao from public.etapas_funil where id = v_etapa_cf_lateral) is false,
    'assert 7: renomear a etapa lateral não deveria mudar participa_conversao';
  select * into r from public.funil_metricas(current_date, current_date, v_funil_cf_id)
   where nome = 'Agendamento remarcado';
  assert r.participa_conversao is false,
    'assert 7: a RPC também não deveria reclassificar a etapa pelo nome novo';

  -- 13.5 (assert 8): a função não depende do nome "No Show" — a mesma conta
  -- acima (quantidade=1, fora dos agregados principais) já prova isto, já
  -- que a etapa se chama "Agendamento remarcado" neste ponto, nunca "No
  -- Show", e continua corretamente lateral.
  assert r.quantidade = 1,
    'assert 8: etapa lateral com nome genérico continua funcionando (quantidade=1), prova de independência de nome';

  raise notice 'funil_metricas_test.sql: todas as asserções passaram.';
end;
$$;

rollback;

-- ===========================================================================
-- Depois deste ROLLBACK (DDL é transacional no Postgres, igual dado):
--   - public.funil_metricas volta a ser EXATAMENTE a função antiga (mesmo
--     corpo, mesmos grants) — o DROP+CREATE+GRANT/REVOKE de cima é desfeito.
--   - Nenhum fixture permanece: usuário, funis, etapas, clientes,
--     negociações, fechamentos, historico_etapas, permissoes_colaborador —
--     tudo criado acima desaparece junto.
--   - Nenhum lead/negociação real foi tocado — todos os IDs usados são
--     gerados ad-hoc dentro desta mesma transação (gen_random_uuid()/
--     `returning id`), nunca um ID pré-existente.
--   - Nenhuma policy ou trigger foi alterada, desabilitada ou ignorada em
--     nenhum momento — só a função em si foi trocada, temporariamente, e
--     os triggers de permissão/handoff continuaram disparando normalmente
--     contra ela durante o teste (prova disso: o próprio fixture precisou
--     de permissoes_colaborador pra passar).
--   - Nenhuma migration foi registrada em supabase_migrations.schema_migrations
--     — isso só aconteceria com um push real, que não rodou.
-- ===========================================================================
