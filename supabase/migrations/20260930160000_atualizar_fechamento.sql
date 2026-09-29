-- ===========================================================================
-- Editar um fechamento já existente (negociação `ganha`).
--
-- Por que não reaproveitar `fechar_negociacao()`: ela sempre faz
-- `etapa_id = v_ganha_id` (no-op, mas redundante) e `posicao = p_posicao`
-- (risco de reordenar o card à toa), e o `ON CONFLICT DO UPDATE` sempre
-- regrava `fechado_em = now(), fechado_por = excluded.fechado_por`. O
-- trigger `fechamentos_define_responsavel()` (20260924120000_metas.sql)
-- reage a `fechado_em` mudar recalculando `responsavel_id` pelo DONO ATUAL
-- do cliente — se a carteira foi transferida depois do fechamento original,
-- uma correção de valor reatribuiria a venda pra outra pessoa nas metas.
-- `atualizar_fechamento()` nunca toca `negociacoes` nem `fechado_em`/
-- `fechado_por` — só `UPDATE fechamentos` (sem upsert: a linha já existe)
-- e a sincronização de serviços.
--
-- Serviços numa negociação `ganha`: o trigger `negociacao_servicos_
-- encerrada_somente_leitura` (20260926120000) recusava INSERT/DELETE em
-- `negociacao_servicos` sempre que a etapa não era `aberta` — inclusive
-- `ganha`. Relaxado pra recusar só `perdida`. Isso não reabre
-- `salvar_negociacao()` pra negociação fechada: ela já é barrada antes, no
-- primeiro UPDATE de campos comerciais, por `negociacoes_encerrada_somente_
-- leitura` (trigger DIFERENTE, em `negociacoes`) — intocado por esta
-- migration.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Serviços editáveis em aberta E ganha; só perdida continua travada.
-- ---------------------------------------------------------------------------
create or replace function public.negociacao_servicos_encerrada_somente_leitura()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_negociacao_id uuid := case when tg_op = 'DELETE' then old.negociacao_id else new.negociacao_id end;
begin
  if exists (
    select 1
    from public.negociacoes n
    where n.id = v_negociacao_id
      and public.etapa_tipo(n.etapa_id) = 'perdida'
  ) then
    raise exception 'Negociação perdida: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. atualizar_fechamento() — UPDATE puro em fechamentos + sync de serviços.
-- Nunca toca negociacoes (etapa_id, posicao) nem fechamentos.fechado_em/
-- fechado_por — SECURITY INVOKER (sem `security definer`), a RLS de
-- fechamentos/negociacao_servicos vale para quem chama, como as demais
-- funções desta família.
-- ---------------------------------------------------------------------------
create or replace function public.atualizar_fechamento(
  p_negociacao_id      uuid,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null,
  p_servico_ids        uuid[] default null,
  p_observacoes        text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tipo public.tipo_etapa;
begin
  select e.tipo into v_tipo
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id
   where n.id = p_negociacao_id;

  if v_tipo is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if v_tipo <> 'ganha' then
    raise exception 'Só é possível editar o fechamento de uma negociação fechada.'
      using errcode = '23514';
  end if;

  -- Serviços: mesma semântica de fechar_negociacao/salvar_negociacao — null
  -- tratado como '{}' (zero serviços), nunca "preserva".
  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id
        from public.negociacao_servicos ns
       where ns.negociacao_id = p_negociacao_id
    ) novo;

  update public.fechamentos
     set valor_vendido      = p_valor_vendido,
         data_fechamento    = p_data_fechamento,
         contrato_enviado   = p_contrato_enviado,
         contrato_assinado  = p_contrato_assinado,
         link_contrato      = p_link_contrato,
         status_pagamento   = p_status_pagamento,
         status_onboarding  = p_status_onboarding,
         observacoes        = p_observacoes
   where negociacao_id = p_negociacao_id;

  if not found then
    raise exception 'Fechamento não encontrado para esta negociação.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.atualizar_fechamento(
  uuid, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
) from public, anon;

grant execute on function public.atualizar_fechamento(
  uuid, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
) to authenticated;

comment on function public.atualizar_fechamento is
  'Edita um fechamento já existente (negociação ganha): valor_vendido, '
  'data_fechamento, contrato, status, serviços e observações. Nunca toca '
  'negociacoes.etapa_id/posicao nem fechamentos.fechado_em/fechado_por — '
  'preserva histórico e atribuição de meta/comissão. SECURITY INVOKER.';
