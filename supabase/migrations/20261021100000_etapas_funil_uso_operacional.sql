-- ===========================================================================
-- Corrige: contador "Negociações" em /configuracoes/funis/[funilId] e o
-- bloqueio de "Desativar etapa" contavam/bloqueavam por QUALQUER referência
-- histórica a negociacoes.etapa_id — inclusive negociação arquivada
-- (desqualificada), excluída (soft delete) ou de cliente excluído. O Kanban
-- (view funil_cards, `where n.arquivada_em is null`) já ignora essas três
-- situações; a configuração do funil não, e por isso diverge dele (achado da
-- auditoria de 2026-10-21: Funil Inbound, "Proposta enviada" mostrava 1
-- negociação na configuração e 0 cards no Kanban — a 1 era uma negociação
-- arquivada com motivo "Lead Repetido"; "Fechado" mostrava 2 vs 1 card — a
-- segunda era uma negociação arquivada com fechamento anulado).
--
-- `ja_usada` (etapas_funil_uso) e o bloqueio de EXCLUIR etapa
-- (etapas_funil_regras, ramo DELETE) continuam contando QUALQUER referência
-- histórica, arquivada/excluída inclusive — isso é correto e não muda: uma
-- etapa já usada alguma vez, mesmo que só por negociações hoje arquivadas,
-- não pode ser excluída (destruiria histórico), só desativada.
--
-- "Operacional" (negociacoes_atuais / bloqueio de desativar), nas duas
-- funções abaixo, passa a significar: etapa_id bate, arquivada_em is null,
-- excluida_em is null, cliente não excluído — mesma definição já usada em
-- funil_metricas() (20261020140000, CTE atuais_base).
-- ===========================================================================

-- 1. `etapas_funil_uso()`: `negociacoes_atuais` filtra por uso operacional;
-- `ja_usada` continua olhando qualquer referência (corpo idêntico ao de
-- 20260923200000_etapas_funil.sql).
create or replace function public.etapas_funil_uso()
returns table (etapa_id uuid, negociacoes_atuais bigint, ja_usada boolean)
language sql
stable
set search_path = ''
as $$
  select
    e.id,
    (
      select count(*)
      from public.negociacoes n
      join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
      where n.etapa_id = e.id
        and n.arquivada_em is null
        and n.excluida_em is null
    ),
    exists (select 1 from public.negociacoes n where n.etapa_id = e.id)
      or exists (
        select 1 from public.historico_etapas h
        where h.etapa_nova_id = e.id or h.etapa_anterior_id = e.id
      )
  from public.etapas_funil e;
$$;
-- 2. `etapas_funil_regras()`: corpo idêntico ao de
-- 20261020140000_funil_metricas_alcance_cumulativo.sql, só trocando o
-- `exists` do bloqueio de DESATIVAR (ramo UPDATE, `old.ativo and not
-- new.ativo`) pela mesma definição operacional. O ramo DELETE (excluir),
-- acima, não muda.
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

  -- Bloqueio de DESATIVAR: só uso OPERACIONAL impede — negociação arquivada,
  -- excluída ou de cliente excluído não trava mais a desativação (ver
  -- cabeçalho desta migration). Etapa de sistema nunca chega aqui (já voltou
  -- no ramo `old.sistema` acima), então isto só afeta etapas personalizadas.
  if tg_op = 'UPDATE' and old.ativo and not new.ativo
     and exists (
       select 1
       from public.negociacoes n
       join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
       where n.etapa_id = new.id
         and n.arquivada_em is null
         and n.excluida_em is null
     )
  then
    raise exception 'Mova as negociações da etapa "%" antes de desativá-la.', new.nome
      using errcode = '23514';
  end if;

  return new;
end;
$$