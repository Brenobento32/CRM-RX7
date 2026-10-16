-- ===========================================================================
-- BUG REAL ENCONTRADO EM PRODUÇÃO (auditoria "corrigir-cliente-leads-
-- definitivo", 2026-10-16) — WhatsApp: todo contato novo via WhatsApp deixou
-- de criar cliente/negociação desde que 20261015140000 foi aplicada.
--
-- CAUSA: `criar_negociacao()` ganhou, em 20261015140000, a checagem
-- `is_gerente() OR pode_mover_etapa(funil_id, etapa_id)` — mas, ao contrário
-- da trigger irmã `negociacoes_protege_criacao_por_permissao` (mesma
-- migration), ela NUNCA ganhou a isenção "auth.uid() nulo = automação,
-- sempre passa". `criar_cliente_whatsapp()` (service_role, sem usuário
-- logado) chama `criar_negociacao()` por dentro — com `auth.uid()` nulo,
-- `is_gerente()` e `pode_mover_etapa()` são estruturalmente sempre `false`
-- (nenhuma linha de `permissoes_colaborador`/`profiles` tem chave nula), então
-- a checagem SEMPRE levanta `42501`. Como as duas operações (criar o cliente
-- e criar a negociação) acontecem na mesma função/transação, a exceção
-- reverte TUDO — nenhum cliente órfão fica no banco, mas o lead inteiro se
-- perde silenciosamente (o `whatsapp-service` só loga o erro e segue).
--
-- CONFIRMADO rodando `supabase/tests/criar_cliente_whatsapp_dry_run.sql`
-- (begin/rollback, nada gravado) contra o banco real: falha exatamente com
-- "Você não tem permissão para criar uma negociação para esse cliente."
-- antes desta correção.
--
-- `ingerir_lead_formulario` (formulário) NÃO é afetada — ela faz INSERT
-- direto em `negociacoes`, nunca chama `criar_negociacao()`. O cadastro
-- manual e "Nova entrada" do Kanban também não são afetados — sempre têm
-- `auth.uid()` real (usuário logado).
--
-- CORREÇÃO: mesma isenção já usada por
-- `negociacoes_protege_criacao_por_permissao` — `auth.uid()` nulo pula a
-- checagem de permissão comercial (a autorização de uma chamada automatizada
-- já é o EXECUTE restrito a `service_role`, não uma linha de
-- `permissoes_colaborador`). GERENTE e qualquer outro papel continuam
-- exatamente como antes. Assinatura idêntica — `create or replace` preserva
-- grants/comment.
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

  -- auth.uid() nulo = chamada automatizada (service_role: criar_cliente_whatsapp)
  -- — sem usuário logado, nunca bloqueada por permissão comercial, mesmo
  -- padrão já usado por negociacoes_protege_criacao_por_permissao.
  if (select auth.uid()) is not null
     and not public.is_gerente()
     and not public.pode_mover_etapa(p_funil_id, v_etapa_id)
  then
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
  'Nova entrada para um cliente já existente (Kanban "Nova entrada", '
  'reaproveitamento de cliente na deduplicação do cadastro manual, ou '
  'criar_cliente_whatsapp automatizado). SECURITY DEFINER: auth.uid() nulo '
  '(automação/service_role) sempre passa; com usuário logado, gerente ou '
  'pode_mover_etapa(funil_id, etapa_inicial) — owner_id não decide aqui (a '
  'trigger negociacoes_protege_criacao_por_permissao reforça a mesma regra '
  'no INSERT, e negociacoes_owner_do_cliente sempre deriva o owner_id real '
  'do cliente, nunca de auth.uid()). id gerado em PL/pgSQL, não via '
  'RETURNING, pelo mesmo motivo de criar_cliente. Nunca cria cliente. Entra '
  'na primeira etapa aberta do funil escolhido.';
