-- ===========================================================================
-- Necessária para a deduplicação do cadastro manual: quando o SDR/CLOSER
-- digita telefone/WhatsApp/e-mail de um cliente que já existe, a correção
-- reaproveita o cliente e chama `criar_negociacao()` pra abrir a negociação
-- nele — mas `criar_negociacao()` (20261008100000) só aceitava
-- `owner_id = auth.uid() OR is_gerente()`, um modelo anterior ao
-- `permissoes_colaborador` (20261014160000). Um SDR/CLOSER com
-- `pode_mover_etapa` configurado corretamente, mas que não é o `owner_id`
-- do cliente reaproveitado (ex.: cliente cujo dono é outro colaborador, ou
-- o responsável padrão de leads automáticos), era bloqueado — exatamente o
-- tipo de bypass que a regra do produto proíbe na direção contrária
-- (`owner_id` não pode ser a ÚNICA porta de entrada).
--
-- CORREÇÃO: troca a checagem hardcoded de `owner_id` por
-- `is_gerente() OR pode_mover_etapa(funil_id, etapa_inicial)` — mesmo
-- critério já usado por `criar_cliente`/`negociacoes_protege_criacao_por_permissao`.
-- `owner_id` deixa de ser considerado nesta função (a trigger
-- `negociacoes_protege_criacao_por_permissao`, já em produção desde
-- 20261015110000, dispara igual sobre este INSERT e reforça a mesma regra
-- — dupla checagem, não um relaxamento).
--
-- Também corrigido, mesmo padrão já aplicado a `criar_cliente`
-- (20261015110000): o `id` passa a ser gerado em PL/pgSQL em vez de
-- `RETURNING` — `negociacoes_select` exige `pode_ver_etapa`, que só é
-- garantido pra quem autorizou via `pode_mover_etapa` (implica `pode_ver`);
-- gerar o id evita depender de reler a linha pela RLS de SELECT.
--
-- NADA MAIS MUDA: assinatura idêntica (mesmos 5 parâmetros, mesma ordem),
-- `CREATE OR REPLACE` preserva os grants existentes. `criar_cliente`,
-- `atividades_insert`, `clientes_select`, `negociacoes_select`,
-- `negociacoes_update`, `clientes_update`,
-- `negociacoes_protege_movimentacao_por_permissao`,
-- `negociacoes_valida_handoff_sdr`, `permissoes_colaborador`,
-- `funil_metricas` — nenhum tocado.
-- ===========================================================================

create or replace function public.criar_negociacao(
  p_cliente_id      uuid,
  p_funil_id        uuid,
  p_valor_estimado  numeric default null,
  p_temperatura     public.temperatura_negociacao default null,
  p_origem          public.origem_negociacao default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_negociacao_id uuid;
  v_etapa_id      uuid;
  v_cliente_existe boolean;
begin
  select true into v_cliente_existe
    from public.clientes c
   where c.id = p_cliente_id
     and c.deleted_at is null;

  if v_cliente_existe is null then
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

  if not public.is_gerente() and not public.pode_mover_etapa(p_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para criar uma negociação para esse cliente.'
      using errcode = '42501';
  end if;

  v_negociacao_id := gen_random_uuid();

  insert into public.negociacoes (
    id, cliente_id, owner_id, etapa_id, valor_estimado, temperatura, origem
  )
  values (
    v_negociacao_id, p_cliente_id, (select auth.uid()), v_etapa_id,
    p_valor_estimado, p_temperatura, p_origem
  );

  return v_negociacao_id;
end;
$$;

comment on function public.criar_negociacao is
  'Nova entrada para um cliente já existente (Kanban "Nova entrada", ou '
  'reaproveitamento de cliente na deduplicação do cadastro manual). '
  'SECURITY DEFINER: gerente ou pode_mover_etapa(funil_id, etapa_inicial) — '
  'owner_id não decide mais aqui (a trigger '
  'negociacoes_protege_criacao_por_permissao reforça a mesma regra no '
  'INSERT). id gerado em PL/pgSQL, não via RETURNING, pelo mesmo motivo de '
  'criar_cliente. Nunca cria cliente. Entra na primeira etapa aberta do '
  'funil escolhido.';
