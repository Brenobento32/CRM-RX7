-- ===========================================================================
-- Corrige `fechar_negociacao()`: a etapa "ganha" era buscada SEM filtrar
-- pelo funil da negociação. Igual ao bug irmão de marcarPerdida() (corrigido
-- só em TypeScript, sem migration, em lib/dal/funil.ts), a migration
-- "Múltiplos funis" (20260929120000_funis.sql) deu a cada funil sua própria
-- etapa `tipo='ganha'`, mas esqueceu de atualizar esta função.
--
-- Antes: `(select e.id from public.etapas_funil e where e.tipo = 'ganha')` —
-- uma subquery escalar que, com 2+ funis, encontra mais de uma linha e o
-- Postgres levanta `cardinality_violation` ("more than one row returned by a
-- subquery used as an expression"). Esse código não é um dos reconhecidos
-- por `traduzirErro()` em lib/dal/funil.ts (P0002/42501/23514), então cai na
-- mensagem genérica "Não foi possível mover a negociação. Tente novamente." —
-- mesmo sintoma do bug de marcarPerdida(), mesma causa raiz, função irmã.
--
-- Depois: descobre o `funil_id` da própria negociação primeiro (e usa essa
-- mesma consulta para detectar "negociação não encontrada", preservando o
-- erro `P0002` que já existia), depois busca a etapa `ganha` SÓ desse funil.
-- Todo o resto (upsert em `fechamentos`, RLS, histórico via os triggers de
-- `negociacoes`) fica exatamente igual — SECURITY INVOKER inalterado, RLS
-- inalterada, mesma negociação/card (é a mesma linha, só a origem da
-- `etapa_id` muda).
-- ===========================================================================
create or replace function public.fechar_negociacao(
  p_negociacao_id      uuid,
  p_posicao            numeric,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_ganha_id uuid;
begin
  select n.funil_id into v_funil_id
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  select e.id into v_ganha_id
    from public.etapas_funil e
   where e.funil_id = v_funil_id
     and e.tipo = 'ganha';

  update public.negociacoes
     set etapa_id = v_ganha_id,
         posicao = p_posicao
   where id = p_negociacao_id;

  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado,
    contrato_assinado, link_contrato, status_pagamento, status_onboarding
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
end;
$$;
