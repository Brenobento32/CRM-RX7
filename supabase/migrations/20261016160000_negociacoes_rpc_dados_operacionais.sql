-- ===========================================================================
-- RPC `atualizar_dados_operacionais_negociacao` — regra definitiva do produto
-- para os 8 campos operacionais do card (nicho, temperatura, valor estimado,
-- primeira reunião, data da proposta, objeção, valor da proposta, forma de
-- pagamento).
--
-- REGRA: SDR/CLOSER com `pode_mover_etapa(funil_id, etapa_id) = true` pode
-- editar os campos operacionais do card, INDEPENDENTEMENTE de ser owner_id
-- da negociação. owner_id continua existindo só como atribuição/responsável
-- (quem a venda credita) — nunca mais como autorização de escrita aqui.
--
-- ACHADO (teste `negociacoes_protege_dados_operacionais_por_permissao_test.sql`,
-- rodado com `SET ROLE authenticated` de verdade, não como superusuário): a
-- abordagem anterior (trigger `BEFORE UPDATE` em
-- `supabase/migrations_propostas/20261015130000_...sql`, ainda não aplicada)
-- só CONSEGUE RESTRINGIR o que a policy `negociacoes_update` (owner_id =
-- auth.uid() OR is_gerente(), pré-existente, NÃO alterada por esta migration)
-- já deixa passar — ela nunca abre acesso novo. Resultado: um SDR/CLOSER com
-- `pode_mover_etapa` mas que NÃO é `owner_id` continuava bloqueado pela RLS,
-- antes mesmo de qualquer trigger rodar — violando a regra definitiva acima.
--
-- CORREÇÃO: nenhuma mudança em `negociacoes_update` (ela continua existindo,
-- intacta, para outros UPDATEs da tabela que não passam por aqui). Em vez
-- disso, os 8 campos operacionais passam a ter um caminho de escrita PRÓPRIO
-- — esta RPC, SECURITY DEFINER — que decide autorização pela MESMA regra já
-- usada por `mover_negociacao` (20261014160000) e
-- `negociacoes_protege_movimentacao_por_permissao` (20261014170000):
-- GERENTE ou `pode_mover_etapa(funil_id, etapa_id)`, nunca owner_id. Sendo
-- SECURITY DEFINER, o UPDATE em si não depende de `negociacoes_update` —
-- a autorização é inteiramente a checagem explícita abaixo, igual a
-- `mover_negociacao`.
--
-- NÃO recebe `origem`: é fato histórico, imutável (trigger
-- `negociacoes_origem_imutavel`, proposta no mesmo arquivo
-- 20261015130000) — nenhuma camada deve voltar a escrevê-la.
-- NÃO toca etapa_id, funil_id, owner_id, fechamento ou motivo de perda —
-- só os 8 campos operacionais, explicitamente, um UPDATE só com essas
-- colunas no SET.
-- Continua sujeita à trigger de lifecycle `negociacoes_encerrada_somente_
-- leitura` (20260926120000) — redundante de propósito com a checagem
-- explícita abaixo (a RPC recusa primeiro, com a mesma mensagem; a trigger é
-- o backstop de qualquer outro caminho que algum dia tente este UPDATE sem
-- passar por aqui).
-- ===========================================================================

create or replace function public.atualizar_dados_operacionais_negociacao(
  p_negociacao_id          uuid,
  p_nicho_id               uuid,
  p_temperatura            public.temperatura_negociacao,
  p_valor_estimado         numeric,
  p_data_primeira_reuniao  date,
  p_data_proposta          date,
  p_objecao_principal      text,
  p_valor_proposta         numeric,
  p_forma_pagamento        public.forma_pagamento
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_etapa_id uuid;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_id
    from public.negociacoes n
   where n.id = p_negociacao_id
     for update;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if public.etapa_tipo(v_etapa_id) <> 'aberta' then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  if not public.is_gerente() and not public.pode_mover_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para editar esta negociação.' using errcode = '42501';
  end if;

  update public.negociacoes
     set nicho_id              = p_nicho_id,
         temperatura            = p_temperatura,
         valor_estimado         = p_valor_estimado,
         data_primeira_reuniao  = p_data_primeira_reuniao,
         data_proposta          = p_data_proposta,
         objecao_principal      = p_objecao_principal,
         valor_proposta         = p_valor_proposta,
         forma_pagamento        = p_forma_pagamento
   where id = p_negociacao_id;
end;
$$;

comment on function public.atualizar_dados_operacionais_negociacao is
  'Único caminho de escrita dos 8 campos operacionais do card (nicho, '
  'temperatura, valor_estimado, data_primeira_reuniao, data_proposta, '
  'objecao_principal, valor_proposta, forma_pagamento). SECURITY DEFINER: '
  'GERENTE ou pode_mover_etapa(funil_id, etapa_id) autoriza — owner_id NUNCA '
  'é consultado, igual a mover_negociacao(). Nunca recebe origem (imutável, '
  'ver negociacoes_origem_imutavel) nem toca etapa_id/funil_id/owner_id. '
  'Recusa negociação encerrada (ganha/perdida) com a mesma mensagem da '
  'trigger negociacoes_encerrada_somente_leitura, que continua existindo '
  'como backstop para qualquer UPDATE que não passe por aqui.';

revoke all on function public.atualizar_dados_operacionais_negociacao(
  uuid, uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) from public, anon;
grant execute on function public.atualizar_dados_operacionais_negociacao(
  uuid, uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) to authenticated;

-- ---------------------------------------------------------------------------
-- `salvar_negociacao` (tela /negociacoes/[id]/editar e modal de edição
-- rápida do lápis, no Kanban) sofria do MESMO problema: SECURITY INVOKER,
-- sujeita à mesma `negociacoes_update` (owner_id OR gerente) — um CLOSER com
-- `pode_mover_etapa` mas sem ser owner_id também não conseguia salvar.
--
-- Esta função não recebe nicho_id (sempre foi assim — nicho é só da ficha).
-- Para não apagar o nicho_id já salvo ao delegar para a RPC nova (que exige
-- os 8 campos), lê o valor atual e repassa sem alterar. Essa leitura é
-- SECURITY INVOKER (sujeita a negociacoes_select); se o chamador não
-- enxergar a linha, nicho_id vem null, mas a RPC chamada abaixo tem sua
-- própria checagem de permissão (pode_mover_etapa, que exige pode_ver na
-- mesma etapa — constraint permissoes_colaborador_mover_exige_ver) e recusa
-- ANTES do UPDATE — nenhum risco de gravar nicho_id errado.
--
-- Servicos continuam fora da RPC nova (política própria, já baseada em
-- pode_mover_etapa desde a revisão aprovada de
-- supabase/migrations_propostas/20261015130000_...sql, seção D) — mantidos
-- na mesma transação desta função, agora depois do UPDATE delegado.
-- Assinatura inalterada.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_negociacao(
  p_negociacao_id          uuid,
  p_valor_estimado         numeric,
  p_temperatura            public.temperatura_negociacao,
  p_data_primeira_reuniao  date,
  p_data_proposta          date,
  p_objecao_principal      text,
  p_valor_proposta         numeric,
  p_forma_pagamento        public.forma_pagamento,
  p_servico_ids            uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_nicho_id uuid;
begin
  select n.nicho_id into v_nicho_id
    from public.negociacoes n
   where n.id = p_negociacao_id;

  perform public.atualizar_dados_operacionais_negociacao(
    p_negociacao_id,
    v_nicho_id,
    p_temperatura,
    p_valor_estimado,
    p_data_primeira_reuniao,
    p_data_proposta,
    p_objecao_principal,
    p_valor_proposta,
    p_forma_pagamento
  );

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
end;
$$;

comment on function public.salvar_negociacao is
  'Grava qualificação, proposta e serviços de uma negociação ABERTA numa '
  'transação. Delega os campos operacionais (menos nicho_id, preservado) '
  'para atualizar_dados_operacionais_negociacao (GERENTE ou pode_mover_etapa, '
  'owner_id não é mais considerado). SECURITY INVOKER — servicos continuam '
  'sob a RLS própria de negociacao_servicos (pode_mover_etapa).';
