-- ===========================================================================
-- Alcance CUMULATIVO do pipeline principal + marcador estruturado
-- `participa_conversao` (substitui a comparação por nome de "No Show" no
-- cálculo definitivo).
--
-- PROBLEMA (achado nesta rodada, auditoria pedida): `funil_metricas.alcancaram`
-- hoje é só EXISTS real em `historico_etapas` POR ETAPA — uma negociação que
-- pula uma etapa intermediária (ex.: "Lead Novo" -> "Reunião agendada",
-- pulando "MQL") nunca teve uma linha de histórico em "MQL", então nunca
-- entra no `alcancaram` de "MQL", mesmo tendo alcançado uma etapa BEM mais
-- avançada do pipeline. Isso é errado: alcançar uma etapa principal mais
-- avançada tem que contar como tendo alcançado todas as anteriores.
--
-- REGRA NOVA: alcance cumulativo, só para ETAPAS PRINCIPAIS (tipo <>
-- 'perdida', não pós-fechamento, `participa_conversao` = true, inclui
-- 'ganha'). Para cada negociação da coorte, acha a MAIOR `ordem` principal
-- que ela já alcançou FISICAMENTE (EXISTS em historico_etapas, SEM exigir
-- fechamento válido nem para 'ganha' — uma venda anulada depois não
-- reescreve por quais etapas a negociação passou); uma etapa principal QUE
-- NÃO SEJA 'ganha' "foi alcançada" quando a ordem dela é <= essa maior
-- ordem física. A etapa 'ganha' EM SI, por ser a maior ordem do funil, só
-- conta como alcançada quando, ALÉM disso, existir um fechamento NÃO
-- anulado — mesma regra de `alcancaram_ganha_valido` (20261019160000): um
-- fechamento anulado nunca é alcance comercial válido de 'ganha', mas não
-- apaga o crédito das etapas principais ANTERIORES por onde a negociação
-- realmente passou. NUNCA fabrica histórico — `historico_etapas` bruto
-- continua intocado; a regra cumulativa existe só NA MÉTRICA, na hora de
-- agregar.
--
-- Etapas FORA do pipeline principal (perdida, recuperação, e qualquer
-- etapa aberta com `participa_conversao = false`) continuam com o
-- `alcancaram` ANTIGO (EXISTS bruto, não cumulativo) — são estados
-- paralelos, a pergunta "quantos chegaram aqui" é sobre aquele estado
-- específico, nunca sobre uma cadeia.
--
-- `participa_conversao`: marcador estruturado em `etapas_funil`,
-- independente de `chave`/`sistema` (que só existem pra etapa de sistema —
-- ver constraint `etapas_funil_chave_so_sistema`). Substitui
-- `ehEtapaNoShow(nome)` no cálculo definitivo: a migration propriamente
-- marca o "No Show" existente como `participa_conversao = false` por nome,
-- UMA ÚNICA VEZ (backfill), na aplicação desta migration — depois disso o
-- app nunca mais precisa comparar nome nenhum para excluir essa etapa (só
-- ainda compara por nome como rede de segurança enquanto esta migration
-- não for aplicada de verdade — ver `ehEtapaNoShow` em
-- `lib/utils/etapas.ts`). Etapa `ganha` nunca pode ser marcada como fora da
-- conversão (constraint abaixo) — faria o funil nunca fechar.
--
-- NÃO aplicada nesta rodada — só criada, testada (supabase/tests/
-- funil_metricas_alcance_cumulativo_test.sql) e validada por dry-run.
--
-- ATUALIZAÇÃO (mesma migration, ainda não aplicada — rodada "ajuste
-- definitivo dos dados do funil por coorte/período"): achado de auditoria
-- adicional — `atuais`/`atuais_base` NUNCA foram filtrados pela coorte
-- (período). Um lead criado em agosto, ainda aberto no Kanban em outubro,
-- contava em "quantidade atual"/oportunidades/pipelineValor/parados ao
-- consultar "Este mês" de outubro — errado: toda métrica do funil
-- selecionado tem que vir da MESMA coorte (funil + criado no período).
-- Corrigido adicionando `join coorte` em `atuais_base`.
--
-- Mesma auditoria: `perdidos_periodo` e `tempos` filtravam pela DATA do
-- evento (`historico_etapas.created_at`/`saida` dentro do período) — errado
-- pelo mesmo motivo do `alcancaram`: a coorte evolui até o momento, perder
-- ou demorar numa etapa DEPOIS do fim do período ainda tem que contar pra
-- quem já é da coorte. Os dois agora filtram por COORTE (negociação
-- pertence a ela), nunca mais pela data do evento em si. Isto é diferente
-- de `ganhos_periodo`, que continua com `data_fechamento between` de
-- propósito — essa é uma métrica FINANCEIRA (vendas registradas numa
-- janela de datas, pra telas de faturamento), não uma métrica de alcance da
-- coorte; `alcance_ganha` (alcance/conversão) já era, e continua sendo,
-- baseado em coorte + fechamento não anulado, nunca em `data_fechamento`.
--
-- Adicionado também `desqualificados` — total (não por etapa, uma
-- negociação desqualificada pode estar em QUALQUER etapa quando isso
-- acontece) de negociações da coorte com `arquivada_em is not null and
-- excluida_em is null`. Auditado: `arquivada_em`/`motivo_arquivamento` são
-- escritos SOMENTE por `desqualificar_negociacao()`
-- (`20261019100000_desqualificar_negociacao_por_permissao.sql`, "Único
-- caminho de escrita") — nenhum outro fluxo real da aplicação toca essas
-- duas colunas, então `arquivada_em is not null` equivale exatamente a
-- "lead desqualificado", sem precisar olhar `motivo_arquivamento`. Mesmo
-- padrão de `total_entraram`: um número só, repetido em toda linha, extraído
-- no TypeScript (`processarMetricasFunil`) pro resumo — nunca por etapa,
-- porque desqualificar não move a negociação de etapa.
--
-- ATUALIZAÇÃO (mesma migration, ainda não aplicada — rodada "fechar
-- pendências da auditoria parcial"): a versão anterior só tinha UMA
-- constraint (`tipo <> 'ganha' or participa_conversao`) — as outras três
-- combinações (perdida, pós-fechamento, aberta normal) dependiam só do
-- filtro AND de `etapas_principais`/`filtrarPipelinePrincipal`, nunca de uma
-- CHECK — ou seja, SQL direto, `service_role` ou código futuro podiam
-- gravar `participa_conversao=true` numa etapa perdida ou de recuperação
-- sem o banco reclamar (estruturalmente inofensivo hoje, porque nunca entra
-- em `etapas_principais`, mas incoerente, e um risco se alguma consulta
-- futura olhar só `participa_conversao`). Agora há TRÊS constraints
-- nomeadas, uma por combinação proibida (ganha/perdida/pós-fechamento); a
-- quarta combinação (aberta normal, não pós-fechamento) continua livre —
-- nenhuma constraint a restringe, por regra de negócio (pode ser estado
-- lateral tipo No Show ou etapa principal comum). `pos_fechamento=false`
-- para `tipo='ganha'` já era garantido por `etapas_funil_pos_fechamento_so_aberta`
-- (20260930100000) — não duplicado aqui.
--
-- Também: `etapas_funil_regras()` passa a recusar mudar `participa_conversao`
-- de etapa de SISTEMA (Fechado/Perdido do Funil Principal) pelo mesmo
-- caminho que já recusa mudar nome/ordem/tipo delas — e `criar_funil()` /
-- `duplicar_funil()` passam a gravar/copiar `participa_conversao`
-- explicitamente (nunca dependendo do `default true` sozinho), com
-- `duplicar_funil()` também copiando `pos_fechamento`, que a versão anterior
-- da função NUNCA copiava (bug pré-existente, independente desta coluna:
-- duplicar um funil com etapa de recuperação já falhava antes desta
-- migration, porque a cópia nascia com `pos_fechamento=false` e uma `ordem`
-- fora da faixa permitida para zona normal — `etapas_funil_regras` rejeitava
-- o INSERT. Corrigido aqui porque sem isso a nova constraint
-- `etapas_funil_pos_fechamento_nao_participa_conversao` tornaria o mesmo
-- cenário ainda mais confuso de diagnosticar).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Coluna estruturada + backfill + regras de integridade completas.
--
-- Ordem importa: coluna -> backfill -> constraints -> trigger novo (seção
-- 2). O backfill roda ANTES da constraint existir (senão o próprio backfill
-- de "perdida=false" violaria uma constraint que ainda não tem exceção
-- aberta pra ele) e ANTES do novo `etapas_funil_regras()` (senão o backfill
-- de "ganha=true"/"perdida=false" — que toca Fechado/Perdido, etapas de
-- SISTEMA no Funil Principal — seria recusado pelo guard de sistema que a
-- seção 2 acrescenta). A versão de `etapas_funil_regras()` ainda instalada
-- neste ponto da transação é a antiga (20260930100000), que não conhece
-- `participa_conversao` — os quatro UPDATEs abaixo passam livres, inclusive
-- nas linhas de sistema.
-- ---------------------------------------------------------------------------
alter table public.etapas_funil
  add column participa_conversao boolean not null default true;

comment on column public.etapas_funil.participa_conversao is
  'true (padrão): etapa principal, participa do caminho cumulativo de alcance do funil. false: estado lateral (ex.: No Show) — nunca é "etapa anterior" de ninguém, nunca aumenta a maior ordem alcançada, não entra em oportunidades/pipelineValor/parados. Independente de chave/sistema. Nunca true para tipo=''perdida'' nem para pos_fechamento=true, nunca false para tipo=''ganha'' — três constraints nomeadas abaixo, uma por combinação proibida; a quarta combinação (aberta normal, não pós-fechamento) é livre, escolha do gerente.';

-- Backfill (nesta ordem): perdida -> pos_fechamento -> No Show por nome ->
-- ganha. Os dois primeiros são redundantes com o valor que a aplicação já
-- segue (perdida/recuperação nunca participam), mas gravados explicitamente
-- para a constraint abaixo encontrar o banco já coerente linha a linha, sem
-- depender da ordem natural das próprias linhas existentes.
update public.etapas_funil set participa_conversao = false where tipo = 'perdida';

update public.etapas_funil set participa_conversao = false where pos_fechamento;

-- Backfill do "No Show" já existente (se houver) — mesma normalização de
-- `ehEtapaNoShow()` em lib/utils/etapas.ts (minúsculo, sem espaço/hífen/
-- underscore); "No Show" não tem acento, então sem necessidade da extensão
-- unaccent para este backfill único. Só etapas abertas, não pós-fechamento
-- (recuperação/perdida já saíram true->false acima; esta linha nunca as
-- toca de novo). ÚNICO lugar desta migration — e de toda a base de código,
-- depois dela aplicada — que reconhece esta etapa pelo NOME: a função
-- `funil_metricas()` (seção 3), `criar_funil()` e `duplicar_funil()`
-- (seções 4 e 5) usam só `participa_conversao` daqui em diante.
update public.etapas_funil
   set participa_conversao = false
 where tipo = 'aberta'
   and not pos_fechamento
   and lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'noshow';

update public.etapas_funil set participa_conversao = true where tipo = 'ganha';

-- Constraints estruturais completas, uma por combinação proibida — o banco
-- recusa a combinação incoerente mesmo por SQL direto, service_role ou
-- código futuro, nunca só pelo filtro AND de `etapas_principais`/
-- `filtrarPipelinePrincipal`. `pos_fechamento=false` para `tipo='ganha'` já
-- é garantido por `etapas_funil_pos_fechamento_so_aberta` (20260930100000);
-- não duplicado aqui.
alter table public.etapas_funil
  add constraint etapas_funil_ganha_participa_conversao
  check (tipo <> 'ganha' or participa_conversao);

alter table public.etapas_funil
  add constraint etapas_funil_perdida_nao_participa_conversao
  check (tipo <> 'perdida' or not participa_conversao);

alter table public.etapas_funil
  add constraint etapas_funil_pos_fechamento_nao_participa_conversao
  check (not pos_fechamento or not participa_conversao);

-- ---------------------------------------------------------------------------
-- 2. `etapas_funil_regras()`: mesma função de 20260930100000, só com
-- `participa_conversao` acrescentada à lista de colunas que uma etapa de
-- SISTEMA (Fechado/Perdido do Funil Principal) nunca pode ter alterada —
-- sem isso, um UPDATE que tocasse só esta coluna nova passaria batido pelo
-- guard de sistema (que compara coluna por coluna, nunca "toda coluna
-- exceto cor"). Resto do corpo idêntico, byte a byte.
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
    -- Sistema: só a cor muda (nem o funil, nem participa_conversao, de uma
    -- etapa de sistema mudam).
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

  -- Personalizada (inserção ou edição) — inclusive ganha/perdida de um funil novo.
  if new.sistema or new.chave is not null then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;

  if new.tipo = 'aberta' then
    if new.pos_fechamento then
      -- Zona de recuperação: depois de TODAS as etapas de fechamento do funil.
      select max(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');

      if v_limite is not null and new.ordem <= v_limite then
        raise exception 'Etapas de recuperação ficam depois das etapas de fechamento do funil.'
          using errcode = '23514';
      end if;
    else
      -- Zona normal (pipeline): antes de TODAS as etapas de fechamento — regra inalterada.
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

-- ---------------------------------------------------------------------------
-- 3. `funil_metricas()`: alcance cumulativo do pipeline principal. Resto da
-- função idêntico a 20261019160000_fechamentos_anulacao.sql (coorte,
-- total_entraram, atuais, ganhos_periodo, perdidos_periodo, tempos) — só o
-- cálculo de `alcancaram` muda, e só para etapas PRINCIPAIS.
-- ---------------------------------------------------------------------------
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

  historico_base as (
    select n.*
    from public.negociacoes n
    where n.funil_id = p_funil_id
  ),

  -- A COORTE: toda negociação (histórica, sem exclusões) deste funil criada
  -- no período (`>= início`, `< fim + 1 dia`, já calculado em `periodo`
  -- acima, fuso America/Sao_Paulo). Fixa para sempre — nunca reclassificada
  -- por avanço posterior. TODA métrica abaixo (atuais, alcance, ganho,
  -- perdido, desqualificados, tempos) parte desta MESMA coorte — nunca duas
  -- fontes diferentes de "quem entra na conta".
  coorte as (
    select n.id
    from historico_base n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),

  total_entraram as (
    select count(*) as total from coorte
  ),

  -- "Quantas negociações DA COORTE estão atualmente nesta etapa" — nunca
  -- "todos os cards atuais do funil, não importa quando entraram" (bug
  -- corrigido nesta rodada: faltava o `join coorte`, então um lead antigo
  -- ainda aberto no Kanban contaminava a métrica de um período recente).
  -- Exclui arquivada/excluída/cliente-excluído, igual já fazia — "excluídas;
  -- arquivadas/desqualificadas; clientes excluídos" ficam de fora daqui,
  -- desqualificadas são contadas à parte (`desqualificados` abaixo).
  atuais_base as (
    select n.*
    from historico_base n
    join coorte co on co.id = n.id
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.arquivada_em is null
      and n.excluida_em is null
  ),

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

  -- Desqualificados DA COORTE — total único (não por etapa: desqualificar
  -- não move a negociação, ela pode estar em qualquer etapa quando isso
  -- acontece). `arquivada_em is not null` é só-escrito por
  -- `desqualificar_negociacao()` (auditado — único caminho real de escrita
  -- dessas duas colunas), então equivale exatamente a "foi desqualificada".
  -- Continua contando nas etapas principais que alcançou antes (não é
  -- excluída de `alcance_fisico_principal`/`alcance_cumulativo`, que não
  -- filtram por `arquivada_em` em nenhum momento) — só sai de "atual"
  -- (`atuais_base`, acima) e por isso de oportunidades/pipelineValor/
  -- parados, calculados no TypeScript a partir de `atuais`.
  desqualificados_coorte as (
    select count(*) as total
    from historico_base n
    join coorte co on co.id = n.id
    where n.arquivada_em is not null
      and n.excluida_em is null
  ),

  -- Alcance BRUTO (todas as etapas) — EXISTS real em historico_etapas, sem
  -- cumulatividade nenhuma. Continua sendo o `alcancaram` de etapas FORA do
  -- pipeline principal (perdida, recuperação, participa_conversao=false) —
  -- pra essas, a pergunta é sobre aquele estado específico, nunca uma cadeia.
  alcancaram as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id
    group by h.etapa_nova_id
  ),

  -- Etapas PRINCIPAIS do funil: mesma definição de `filtrarPipelinePrincipal`
  -- em lib/utils/funil-metricas.ts — tipo <> 'perdida', não pós-fechamento,
  -- participa_conversao = true (inclui 'ganha', que nunca pode ser false
  -- por causa da constraint acima).
  etapas_principais as (
    select e.id, e.ordem, e.tipo
    from public.etapas_funil e
    where e.funil_id = p_funil_id
      and e.ativo
      and e.tipo <> 'perdida'
      and not e.pos_fechamento
      and e.participa_conversao
  ),

  -- Alcance FÍSICO de cada negociação da coorte em cada etapa PRINCIPAL —
  -- EXISTS real em historico_etapas, SEM checar validade de fechamento
  -- (nem para 'ganha'): passar fisicamente por uma etapa — mesmo 'ganha',
  -- mesmo que o fechamento associado venha a ser anulado depois — ainda
  -- credita as etapas ANTERIORES do caminho (uma venda anulada não
  -- reescreve retroativamente por quais etapas a negociação passou). A
  -- validade do fechamento só decide se 'ganha' EM SI foi alcançada
  -- (ver `alcance_ganha` abaixo) — nunca as etapas antes dela.
  alcance_fisico_principal as (
    select distinct h.negociacao_id, ep.ordem
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join etapas_principais ep on ep.id = h.etapa_nova_id
  ),

  -- Maior ordem PRINCIPAL que cada negociação da coorte já alcançou
  -- fisicamente — a base inteira da regra cumulativa.
  maior_ordem_fisica as (
    select negociacao_id, max(ordem) as ordem
    from alcance_fisico_principal
    group by negociacao_id
  ),

  -- Alcance CUMULATIVO das etapas principais QUE NÃO SÃO 'ganha': basta a
  -- maior ordem física alcançada ser >= a ordem da etapa — nunca fabrica
  -- histórico, só reagrega o que já existe. count(distinct) garante que
  -- voltar/avançar de novo (retrocesso, reentrada na mesma etapa) nunca
  -- conta duas vezes a mesma negociação.
  alcance_cumulativo as (
    select ep.id as etapa_id, count(distinct m.negociacao_id) as qtd
    from etapas_principais ep
    join maior_ordem_fisica m on m.ordem >= ep.ordem
    where ep.tipo <> 'ganha'
    group by ep.id
  ),

  -- Alcance (cumulativo) de 'ganha' especificamente: por ser a maior ordem
  -- principal do funil, "maior_ordem_fisica >= ordem(ganha)" já equivale a
  -- "chegou fisicamente em ganha" — mas só conta de verdade com um
  -- fechamento NÃO anulado (mesma regra de `alcancaram_ganha_valido`,
  -- 20261019160000: fechamento anulado nunca é ganho comercial válido,
  -- mesmo com a passagem física real preservada acima pras etapas antes
  -- dela).
  alcance_ganha as (
    select ep.id as etapa_id, count(distinct m.negociacao_id) as qtd
    from etapas_principais ep
    join maior_ordem_fisica m on m.ordem >= ep.ordem
    join public.fechamentos f on f.negociacao_id = m.negociacao_id and f.anulado_em is null
    where ep.tipo = 'ganha'
    group by ep.id
  ),

  -- Vendido no período — MÉTRICA FINANCEIRA (telas de faturamento), de
  -- propósito pela data de VENDA (`data_fechamento`), nunca pela coorte:
  -- continua idêntico, por pedido explícito ("o filtro por data de
  -- fechamento continua correto nas telas financeiras"). Nunca confundir
  -- com `alcance_ganha` acima (alcance/conversão da coorte, sempre por
  -- coorte + fechamento não anulado, nunca por `data_fechamento`).
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

  -- Perdido DA COORTE — negociações da coorte que alcançaram a etapa
  -- perdida, não importa QUANDO o evento de perda aconteceu (a coorte
  -- evolui até o momento, mesmo motivo de `alcance_fisico_principal`).
  -- Troca o filtro antigo por DATA do evento (`historico_etapas.created_at`
  -- dentro do período) por filtro de COORTE — uma perda registrada depois
  -- do fim do período ainda conta pra quem já é da coorte.
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

  -- Tempo por etapa — permanências de negociações DA COORTE, sem filtrar
  -- pela data em que a permanência terminou (`saida`): o filtro antigo
  -- (`saida` dentro do período) media só as transições que TERMINARAM na
  -- janela, não as da coorte selecionada. Agora mede a permanência de quem
  -- É da coorte, completa até agora — mesma lógica de "evolução até o
  -- momento" do `alcancaram`.
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
    -- 'ganha': alcance_ganha (cumulativo + fechamento válido). Outras
    -- principais: alcance_cumulativo. Lateral (perdida, recuperação,
    -- participa_conversao=false): alcance BRUTO, como sempre foi.
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
  left join ganhos_periodo      gp on gp.etapa_id = e.id
  left join perdidos_periodo    pp on pp.etapa_id = e.id
  left join tempos              t  on t.etapa_id = e.id
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
  'também um fechamento com anulado_em is null pra contar como alcançada '
  '(mesma regra de 20261019160000) — um fechamento anulado não invalida o '
  'crédito das etapas principais anteriores, só o de ganha em si, mesmo '
  'que o fechamento (anulado ou não) tenha ocorrido depois do fim do '
  'período: a coorte evolui até o momento da consulta. Alcançaram de etapa '
  'LATERAL (perdida, recuperação, participa_conversao=false) é bruto '
  '(EXISTS real na COORTE, não cumulativo) — é sobre aquele estado '
  'específico, nunca uma cadeia; perdido conta a negociação não importa '
  'quando o evento de perda aconteceu, pelo mesmo motivo. Ganhos/'
  'fechadoValor (quantidade/valor da linha ganha) são a ÚNICA métrica '
  'financeira por DATA (fechamentos.data_fechamento, não anulada) — pras '
  'telas de faturamento, nunca pro alcance/conversão da coorte. Atual '
  '(quantidade/valor/parados de etapas abertas) e tempos (permanência por '
  'etapa) agora exigem pertencer à coorte, além de excluir arquivada/'
  'excluída/cliente-excluído — um lead antigo, fora do período consultado, '
  'nunca mais contamina a métrica de um período recente. Desqualificados é '
  'um total único da coorte (arquivada_em is not null, excluida_em is '
  'null — único caminho de escrita é desqualificar_negociacao()), repetido '
  'em toda linha como total_entraram, nunca por etapa (desqualificar não '
  'move a negociação). SECURITY INVOKER.';

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;

-- ---------------------------------------------------------------------------
-- 4. `criar_funil()`: mesma função de 20260929120000, só gravando
-- `participa_conversao` explicitamente em cada INSERT (nunca dependendo do
-- `default true` da coluna sozinho) — ganha=true, perdida=false, abertas
-- principais=true. Resto do corpo idêntico; mesma assinatura, permissões e
-- grants.
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

comment on function public.criar_funil is
  'Cria um funil com etapa ganha (participa_conversao=true) e perdida '
  '(participa_conversao=false) obrigatórias, + abertas opcionais principais '
  '(participa_conversao=true), numa transação só. Erro em qualquer etapa '
  'desfaz tudo.';

revoke all on function public.criar_funil from public, anon;
grant execute on function public.criar_funil to authenticated;

-- ---------------------------------------------------------------------------
-- 5. `duplicar_funil()`: mesma função de 20260929120000, copiando também
-- `pos_fechamento` e `participa_conversao` das etapas de origem — a versão
-- anterior só copiava nome/cor/ordem/tipo. `pos_fechamento` nunca tinha
-- sido copiado (bug pré-existente, independente desta coluna: duplicar um
-- funil com etapa de recuperação já falhava antes desta migration, porque a
-- cópia nascia com pos_fechamento=false e uma ordem fora da faixa permitida
-- pra zona normal — etapas_funil_regras rejeitava o INSERT). Corrigido
-- junto porque, sem isso, a nova constraint
-- etapas_funil_pos_fechamento_nao_participa_conversao tornaria o mesmo
-- cenário ainda mais confuso de diagnosticar, e a cópia de
-- participa_conversao sozinha não teria onde se apoiar. Resto do corpo
-- idêntico; mesma assinatura, permissões e grants.
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

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento, participa_conversao)
  select v_novo_id, e.nome, e.cor, e.ordem, e.tipo, e.pos_fechamento, e.participa_conversao
    from public.etapas_funil e
   where e.funil_id = p_funil_id
   order by e.ordem;

  return v_novo_id;
end;
$$;

comment on function public.duplicar_funil is
  'Duplica um funil: copia nome/cor/ordem/tipo/pos_fechamento/'
  'participa_conversao das etapas. NUNCA copia negociações, histórico ou '
  'fechamentos — o funil novo nasce vazio.';

revoke all on function public.duplicar_funil from public, anon;
grant execute on function public.duplicar_funil to authenticated;
