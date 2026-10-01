-- ===========================================================================
-- Criação automática de lead a partir do WhatsApp.
--
-- `criar_cliente_whatsapp()` — chamada só pelo whatsapp-service (service_role)
-- quando chega mensagem de um telefone sem cliente vinculado. Cria o cliente,
-- abre a negociação no funil configurado (reaproveita `criar_negociacao()` —
-- primeira etapa aberta, owner_id sempre recalculado pelo trigger
-- `negociacoes_sincroniza_owner` a partir do cliente) e vincula a conversa,
-- tudo numa função só (atômico: uma função = uma transação).
--
-- `funil_id`/`responsavel_padrao_id` NÃO são parâmetros — a função lê direto
-- da linha única de `whatsapp_conexoes` (mesmo id fixo que o whatsapp-service
-- usa, ver 20260930190000). Decisão de revisão de segurança: um parâmetro
-- deixaria o chamador livre para passar funil/responsável diferentes do
-- configurado; lendo do banco, a única fonte de verdade é a config salva em
-- /configuracoes/whatsapp — reduz o raio de um bug no whatsapp-service, já
-- que ele só informa telefone/nome/conversa, nunca funil ou responsável.
--
-- SECURITY DEFINER a pedido — não é estritamente necessário, já que
-- `service_role` ignora RLS; o que de fato protege é o EXECUTE restrito só a
-- `service_role` (nem authenticated, nem anon) logo abaixo, mesmo padrão de
-- `agenda_google_salvar_conexao` etc. em 20260927120000.
--
-- Idempotência (mensagens simultâneas do mesmo número): `select ... for
-- update` na linha de `conversas` serializa chamadas concorrentes para o
-- mesmo `conversa_id` — como `conversas.telefone` já é único, isso equivale a
-- serializar por telefone. Quem chega depois, destrava já vendo
-- `cliente_id` preenchido pela primeira chamada e só devolve os ids
-- existentes — nenhum lead duplicado, sem advisory lock.
-- ===========================================================================

create or replace function public.criar_cliente_whatsapp(
  p_telefone     text,
  p_nome         text,
  p_conversa_id  uuid
)
returns table (cliente_id uuid, negociacao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa               public.conversas%rowtype;
  v_funil_id               uuid;
  v_responsavel_padrao_id  uuid;
  v_cliente_id             uuid;
  v_negociacao_id          uuid;
begin
  select * into v_conversa
    from public.conversas
   where id = p_conversa_id
     for update;

  if v_conversa.id is null then
    raise exception 'Conversa % não encontrada.', p_conversa_id using errcode = 'P0002';
  end if;

  if v_conversa.telefone <> p_telefone then
    raise exception 'Telefone informado não corresponde à conversa %.', p_conversa_id
      using errcode = '22023';
  end if;

  -- Já resolvido por uma chamada concorrente enquanto esta esperava o lock.
  if v_conversa.cliente_id is not null then
    select n.id into v_negociacao_id
      from public.negociacoes n
     where n.cliente_id = v_conversa.cliente_id
     order by n.created_at
     limit 1;

    return query select v_conversa.cliente_id, v_negociacao_id;
    return;
  end if;

  -- Linha única por convenção (ver 20260930190000) — mesma fonte de verdade
  -- da tela /configuracoes/whatsapp, nunca um valor vindo do chamador.
  select c.funil_id, c.responsavel_padrao_id
    into v_funil_id, v_responsavel_padrao_id
    from public.whatsapp_conexoes c
   where c.id = '00000000-0000-0000-0000-000000000001';

  if v_funil_id is null or v_responsavel_padrao_id is null then
    raise exception 'Configuração do WhatsApp (funil/responsável padrão) não encontrada.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.funis f
     where f.id = v_funil_id and f.ativo and f.whatsapp_habilitado
  ) then
    raise exception 'Funil % não está ativo ou não tem WhatsApp habilitado.', v_funil_id
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_responsavel_padrao_id and p.ativo) then
    raise exception 'Responsável padrão % inválido ou inativo.', v_responsavel_padrao_id
      using errcode = '23514';
  end if;

  insert into public.clientes (tipo_cliente, nome, telefone, whatsapp, owner_id)
  values ('pessoa_fisica', p_nome, p_telefone, p_telefone, v_responsavel_padrao_id)
  returning id into v_cliente_id;

  v_negociacao_id := public.criar_negociacao(v_cliente_id, v_funil_id);

  update public.conversas
     set cliente_id = v_cliente_id
   where id = p_conversa_id;

  return query select v_cliente_id, v_negociacao_id;
end;
$$;

comment on function public.criar_cliente_whatsapp is
  'Cria cliente + negociação (primeira etapa aberta do funil configurado em '
  'whatsapp_conexoes) a partir de uma conversa de WhatsApp sem cliente '
  'vinculado, e faz o vínculo — atômico. Funil/responsável lidos direto da '
  'config, nunca recebidos como parâmetro. Só o whatsapp-service chama '
  '(service_role); idempotente por conversa_id.';

revoke all on function public.criar_cliente_whatsapp(text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.criar_cliente_whatsapp(text, text, uuid) to service_role;
