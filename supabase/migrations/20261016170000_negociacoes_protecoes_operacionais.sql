-- ===========================================================================
-- Proteções restantes dos dados operacionais do card, levadas para produção
-- depois da RPC `atualizar_dados_operacionais_negociacao` (20261016160000).
--
-- Esta migration NÃO duplica a RPC 160000 — ela é o backstop de banco para
-- QUALQUER outro caminho que algum dia tente escrever estas colunas sem
-- passar por ela (mesmo raciocínio de `negociacoes_protege_movimentacao_por_
-- permissao`, 20261014170000, que existe ao lado de `mover_negociacao`).
--
-- Traz só as partes de `supabase/migrations_propostas/
-- 20261015130000_negociacoes_protege_dados_operacionais_por_permissao.sql`
-- que continuam necessárias depois da RPC 160000 — esse arquivo NÃO é movido
-- nem aplicado, continua preservado só como proposta/histórico de decisão.
-- `origem` sai de lá (nunca fez parte dos campos liberados por permissão —
-- é imutável, sem exceção) e ganha trigger própria, incondicional.
--
-- 1. origem imutável — SDR, CLOSER, owner e GERENTE, sem excepção.
-- 2. lifecycle dos 8 campos operacionais (nicho_id incluso — era o único dos
--    8 que a trigger `negociacoes_encerrada_somente_leitura` original
--    (20260926120000) não cobria) — vale pra GERENTE também.
-- 3. negociacao_servicos_insert/delete por pode_mover_etapa, sem owner_id.
--
-- NÃO toca etapa_id, funil_id, owner_id, fechamento nem motivo_perda —
-- motivo_perda é pendência separada, deliberadamente fora desta rodada (só
-- tem validação de dado hoje, `negociacoes_valida_etapa`, não checagem de
-- permissão). NÃO altera `negociacoes_update`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Origem imutável.
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_origem_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origem is distinct from old.origem then
    raise exception 'A origem da negociação não pode ser alterada — é um registro histórico de como o lead entrou no CRM.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.negociacoes_origem_imutavel is
  'origem é fato histórico de como o lead entrou (formulário/WhatsApp/manual '
  '— definida só no INSERT). Imutável para QUALQUER papel, inclusive '
  'gerente — sem excepção nenhuma, diferente dos outros 8 campos '
  'operacionais (que são liberados por pode_mover_etapa).';

revoke all on function public.negociacoes_origem_imutavel() from public, anon;

drop trigger if exists negociacoes_origem_imutavel on public.negociacoes;
create trigger negociacoes_origem_imutavel
  before update of origem
  on public.negociacoes
  for each row
  execute function public.negociacoes_origem_imutavel();

-- ---------------------------------------------------------------------------
-- 2. Lifecycle dos 8 campos operacionais — estende a trigger já aplicada
-- `negociacoes_encerrada_somente_leitura` (20260926120000, 7 campos) pra
-- incluir `nicho_id`. Mesma função/trigger (create or replace + drop/create
-- do trigger), não uma nova — evita duas triggers fazendo a mesma coisa.
-- Continua valendo pra GERENTE também (lifecycle nunca isentou ninguém).
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_encerrada_somente_leitura()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.etapa_tipo(new.etapa_id) <> 'aberta'
     and (
       new.nicho_id, new.valor_estimado, new.temperatura, new.data_primeira_reuniao,
       new.data_proposta, new.objecao_principal, new.valor_proposta,
       new.forma_pagamento
     ) is distinct from (
       old.nicho_id, old.valor_estimado, old.temperatura, old.data_primeira_reuniao,
       old.data_proposta, old.objecao_principal, old.valor_proposta,
       old.forma_pagamento
     )
  then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.negociacoes_encerrada_somente_leitura is
  'Backstop de lifecycle pros 8 campos operacionais (nicho_id incluso desde '
  'esta revisão) — nenhum pode mudar fora de etapa aberta, nem pra gerente. '
  'A RPC atualizar_dados_operacionais_negociacao (20261016160000) já recusa '
  'isso explicitamente antes do UPDATE; esta trigger é o backstop pra '
  'qualquer outro caminho que não passe por ela.';

drop trigger if exists negociacoes_encerrada_somente_leitura on public.negociacoes;
create trigger negociacoes_encerrada_somente_leitura
  before update of nicho_id, valor_estimado, temperatura, data_primeira_reuniao, data_proposta,
                   objecao_principal, valor_proposta, forma_pagamento
  on public.negociacoes
  for each row
  execute function public.negociacoes_encerrada_somente_leitura();

-- ---------------------------------------------------------------------------
-- 3. negociacao_servicos — GERENTE ou pode_mover_etapa, nunca owner_id.
-- Substitui a policy original (20260925120000: negociacao_owner() = auth.uid()
-- OR is_gerente()).
-- ---------------------------------------------------------------------------
drop policy if exists negociacao_servicos_insert on public.negociacao_servicos;
create policy negociacao_servicos_insert on public.negociacao_servicos
  for insert
  to authenticated
  with check (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = negociacao_servicos.negociacao_id
        and public.pode_mover_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists negociacao_servicos_delete on public.negociacao_servicos;
create policy negociacao_servicos_delete on public.negociacao_servicos
  for delete
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = negociacao_servicos.negociacao_id
        and public.pode_mover_etapa(n.funil_id, n.etapa_id)
    )
  );
