-- ===========================================================================
-- `fechar_negociacao()` ganha `p_servico_ids` e `p_observacoes`.
--
-- Serviços contratados reaproveitam a relação já existente
-- `negociacao_servicos` (mesmo padrão delete-then-insert-diff de
-- `salvar_negociacao()`, Fase 11A) — nenhuma tabela nova. A sincronização
-- acontece ANTES do UPDATE que move a negociação para a etapa `ganha`: o
-- trigger `negociacao_servicos_encerrada_somente_leitura` (migration
-- 20260926120000) bloqueia INSERT/DELETE em `negociacao_servicos` assim que
-- a etapa atual da negociação não é mais `aberta` — nesta função, a etapa só
-- muda depois da sincronização, então o trigger ainda vê "aberta" e deixa
-- passar.
--
-- Semântica de `p_servico_ids` — igual a `salvar_negociacao()`, sem exceção:
--   * IDs presentes  -> sincroniza para exatamente esses IDs.
--   * `'{}'` (vazio) -> sincroniza para ZERO serviços.
--   * `null`         -> tratado como `'{}'` (`coalesce`), também ZERO
--     serviços — null NUNCA significa "preservar". A aplicação nunca
--     precisa mandar `null` de propósito: `funil_cards.servico_ids` (migration
--     20260930130000) já entrega os vínculos atuais pro modal de fechamento
--     pré-marcar, então o array que chega aqui já reflete o que deveria
--     continuar vinculado (sem edição do usuário) ou o que deveria mudar
--     (com edição) — nunca "não sei, não mexe".
--
-- Resto do fluxo (multi-funil, upsert em fechamentos, RLS, SECURITY INVOKER
-- implícito) fica exatamente como a migration anterior deixou.
--
-- DROP explícito da assinatura antiga (9 parâmetros) antes de criar a nova
-- (11 parâmetros): a identidade de uma função no Postgres é (nome + lista de
-- TIPOS dos parâmetros) — acrescentar parâmetros muda essa lista, então
-- `create or replace function` sozinho NÃO substitui a versão antiga, cria
-- uma segunda sobrecarga coexistindo com ela (confirmado: foi exatamente
-- isso que quebrou o dry-run com "function ... is not unique"). Sem o DROP,
-- as duas ficariam coexistindo em produção também. O DROP remove os grants
-- da assinatura antiga junto — por isso os `revoke`/`grant` explícitos pra
-- assinatura nova, no fim deste arquivo.
-- ===========================================================================
drop function if exists public.fechar_negociacao(
  uuid,
  numeric,
  numeric,
  date,
  boolean,
  boolean,
  public.status_pagamento,
  public.status_onboarding,
  text
);

create or replace function public.fechar_negociacao(
  p_negociacao_id      uuid,
  p_posicao            numeric,
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
  v_funil_id uuid;
  v_ganha_id uuid;
begin
  select n.funil_id into v_funil_id
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  -- Serviços: sincroniza ANTES de mudar a etapa (negociação ainda "aberta").
  -- null tratado como '{}' (zero serviços) — mesma semântica de
  -- salvar_negociacao(), nunca "preserva".
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
    contrato_assinado, link_contrato, status_pagamento, status_onboarding, observacoes
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding, p_observacoes
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        observacoes        = excluded.observacoes,
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
end;
$$;

revoke all on function public.fechar_negociacao(
  uuid,
  numeric,
  numeric,
  date,
  boolean,
  boolean,
  public.status_pagamento,
  public.status_onboarding,
  text,
  uuid[],
  text
) from public, anon;

grant execute on function public.fechar_negociacao(
  uuid,
  numeric,
  numeric,
  date,
  boolean,
  boolean,
  public.status_pagamento,
  public.status_onboarding,
  text,
  uuid[],
  text
) to authenticated;
