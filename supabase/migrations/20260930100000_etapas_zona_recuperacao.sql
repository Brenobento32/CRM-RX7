-- ===========================================================================
-- Zona de recuperação pós-perda.
--
-- Até aqui, toda etapa `tipo = 'aberta'` tinha uma única regra de posição:
-- `ordem` sempre antes de Fechado/Perdido (`etapas_funil_regras()`, migration
-- 20260929130000). Esta migration acrescenta uma SEGUNDA zona, simétrica: uma
-- etapa aberta pode em vez disso ficar DEPOIS de Fechado/Perdido — pensada
-- para fluxos de recuperação pós-perda (ex.: "Recuperação"), sem deixar de
-- ser uma etapa `aberta` comum (editável, reordenável, excluível pelo
-- gerente — nunca vira `sistema`).
--
-- O que muda:
--   1. `etapas_funil.pos_fechamento` — coluna nova, `boolean not null default
--      false`. false = zona normal (comportamento de sempre). true = zona de
--      recuperação, só permitido em `tipo = 'aberta'`.
--   2. `etapas_funil_regras()` — o bloco `if new.tipo = 'aberta'` passa a ter
--      dois ramos por `pos_fechamento`: zona normal continua `ordem <
--      min(ganha,perdida)`; zona de recuperação exige `ordem > max(ganha,
--      perdida)`. Como as duas faixas nunca se sobrepõem (max >= min sempre),
--      uma etapa normal nunca consegue ter uma `ordem` que também satisfaça a
--      regra da zona de recuperação, e vice-versa — a separação é estrutural,
--      não uma checagem extra.
--   3. Backfill: a etapa personalizada "Recuperação" que já existe no Funil
--      Principal (criada manualmente, fora desta migration) passa para
--      `pos_fechamento = true`, com uma `ordem` nova, calculada e
--      garantidamente livre. Só duas colunas de UMA linha de `etapas_funil`
--      mudam — nenhuma negociação, card, historico_etapas ou fechamento é
--      tocado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Coluna nova.
-- ---------------------------------------------------------------------------
alter table public.etapas_funil
  add column pos_fechamento boolean not null default false;

alter table public.etapas_funil
  add constraint etapas_funil_pos_fechamento_so_aberta
  check (not pos_fechamento or tipo = 'aberta');

comment on column public.etapas_funil.pos_fechamento is
  'true = etapa aberta "de recuperação", posicionada depois de ganha/perdida '
  '(ex.: Recuperação pós-perda). false (padrão) = etapa aberta normal do '
  'fluxo comercial, antes do fechamento. Escolhida na criação da etapa; esta '
  'primeira versão não oferece converter uma etapa existente de zona.';

-- ---------------------------------------------------------------------------
-- 2. `etapas_funil_regras()` — duas zonas em vez de um único limite.
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
       or new.pos_fechamento is distinct from old.pos_fechamento
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
-- 3. Backfill: a "Recuperação" real do Funil Principal migra para a zona
-- nova. Identificada só aqui, por nome — mecanismo de uma vez só, não uma
-- regra permanente (daqui pra frente a zona é escolha explícita na criação).
-- A nova `ordem` (maior fechamento do funil + 1000) é garantidamente livre:
-- até este UPDATE rodar, o trigger sempre exigiu `ordem < min(ganha,
-- perdida)` de toda aberta, então nada pode já existir acima de
-- `max(ganha,perdida)`. Só `etapas_funil.pos_fechamento` e `.ordem` mudam,
-- nesta única linha — negociacoes, historico_etapas e fechamentos não são
-- tocados.
-- ---------------------------------------------------------------------------
update public.etapas_funil e
   set pos_fechamento = true,
       ordem = (
         select max(f.ordem) + 1000
           from public.etapas_funil f
          where f.funil_id = e.funil_id
            and f.tipo in ('ganha', 'perdida')
       )
 where e.funil_id = (select id from public.funis where padrao)
   and e.tipo = 'aberta'
   and e.sistema = false
   and lower(btrim(e.nome)) = 'recuperação';
