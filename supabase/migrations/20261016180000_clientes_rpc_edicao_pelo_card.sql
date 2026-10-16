-- ===========================================================================
-- RPC `atualizar_cliente_do_card` — fecha o mesmo gap de owner_id que
-- `atualizar_dados_operacionais_negociacao` (20261016160000) fechou pra
-- negociacoes, agora pra `clientes`.
--
-- ACHADO (teste manual em produção, ficha do Kanban): editar nome/telefone/
-- etc. do cliente pela ficha devolvia "Cliente não encontrado" pra um SDR/
-- CLOSER com `pode_mover_etapa` no card mas que NÃO é `owner_id` do cliente
-- (`atualizarCliente()`, lib/dal/clientes.ts, fazia `.update()` direto —
-- sujeito a `clientes_update`: owner_id = auth.uid() OR is_gerente(),
-- pré-existente desde 20260923120300, NUNCA tocada pelo novo modelo de
-- permissões). Mesma classe de bug já corrigida pra negociacoes.
--
-- DECISÃO DE ARQUITETURA (ver relatório da rodada): "editar cadastro do
-- cliente" tem DOIS contextos diferentes, com autorizações DIFERENTES:
--   1. Tela própria (/clientes/[id]/editar, não ligada a nenhum card
--      específico) — continua exigindo owner_id (carteira) OU gerente, via
--      `clientes_update` (RLS, INTOCADA por esta migration) e
--      `atualizarCliente()`/`atualizarClienteAction` (inalterados).
--   2. Ficha do card no Kanban (`ModalFichaCliente`) — contextual a UMA
--      negociação específica: a autorização passa a ser a MESMA da edição
--      operacional do card (GERENTE ou pode_mover_etapa na etapa atual da
--      negociação), nunca owner_id — exatamente a regra definitiva já
--      aprovada pra dados operacionais. Esta RPC nova é o único caminho
--      dessa segunda via.
--
-- NÃO abre `clientes_update` pra pode_mover globalmente (pediria pra
-- qualquer UPDATE de qualquer cliente, não só do cliente vinculado ao card
-- autorizado) — por isso uma RPC própria, SECURITY DEFINER, que:
--   - recebe negociacao_id JUNTO com cliente_id;
--   - confirma que a negociação pertence de fato a esse cliente_id (recusa
--     se alguém mandar um cliente_id arbitrário com uma negociação de outro
--     cliente que o chamador tem acesso);
--   - decide por GERENTE ou pode_mover_etapa(funil_id, etapa_id) da
--     negociação — nunca owner_id;
--   - só escreve os campos de CADASTRO (nunca owner_id, nunca nenhum campo
--     de negociacoes/origem/etapa/funil/fechamento).
--
-- Cliente numa negociação ENCERRADA (ganha/perdida) continua editável por
-- este caminho — corrigir telefone/e-mail/nome depois do fechamento não
-- compromete histórico de venda (diferente dos campos operacionais da
-- própria negociação, que ficam congelados). Nenhuma checagem de lifecycle
-- aqui, de propósito.
-- ===========================================================================

create or replace function public.atualizar_cliente_do_card(
  p_cliente_id     uuid,
  p_negociacao_id  uuid,
  p_tipo_cliente   public.tipo_cliente,
  p_nome           text,
  p_empresa        text,
  p_cpf            text,
  p_cnpj           text,
  p_telefone       text,
  p_whatsapp       text,
  p_email          text,
  p_responsavel    text,
  p_cargo          text,
  p_instagram      text,
  p_observacoes    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id        uuid;
  v_etapa_id        uuid;
  v_cliente_da_neg  uuid;
begin
  select n.funil_id, n.etapa_id, n.cliente_id into v_funil_id, v_etapa_id, v_cliente_da_neg
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if v_cliente_da_neg <> p_cliente_id then
    raise exception 'Esta negociação não pertence ao cliente informado.' using errcode = '23514';
  end if;

  if not public.is_gerente() and not public.pode_mover_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para editar este cliente.' using errcode = '42501';
  end if;

  update public.clientes
     set tipo_cliente = p_tipo_cliente,
         nome         = p_nome,
         empresa      = p_empresa,
         cpf          = p_cpf,
         cnpj         = p_cnpj,
         telefone     = p_telefone,
         whatsapp     = p_whatsapp,
         email        = p_email,
         responsavel  = p_responsavel,
         cargo        = p_cargo,
         instagram    = p_instagram,
         observacoes  = p_observacoes
   where id = p_cliente_id
     and deleted_at is null;

  if not found then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.atualizar_cliente_do_card is
  'Edição de cadastro do cliente a partir da ficha do card (Kanban) —
   SECURITY DEFINER: GERENTE ou pode_mover_etapa(funil_id, etapa_id) da
   negociação informada autoriza, nunca owner_id. Confirma que a negociação
   pertence de fato ao cliente_id recebido (recusa 23514 se não). Nunca
   escreve owner_id, nem nenhum campo de negociacoes/origem/etapa/funil/
   fechamento — só os campos de cadastro. Diferente de atualizarCliente()/
   clientes_update (tela /clientes/[id]/editar), que continua exigindo
   owner_id OU gerente, sem relação com nenhum card específico.';

revoke all on function public.atualizar_cliente_do_card(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.atualizar_cliente_do_card(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

-- ===========================================================================
-- RPC `salvar_ficha_negociacao` — ÚNICA operação atômica pro botão "Salvar
-- alterações" da ficha do card: cliente + dados operacionais da negociação
-- numa única chamada/transação.
--
-- ACHADO (revisão desta rodada): `salvarFichaAction` chamava as duas RPCs
-- acima (`atualizar_cliente_do_card` e `atualizar_dados_operacionais_
-- negociacao`) em DUAS chamadas `.rpc()` separadas — cada uma é a própria
-- transação implícita do PostgREST. Se a primeira tivesse sucesso e a
-- segunda falhasse, o cliente ficaria alterado e a negociação não — nunca
-- aceitável pra um único botão "Salvar alterações".
--
-- NÃO HÁ outra forma de ter atomicidade real entre duas chamadas de rede
-- separadas: o PostgREST (API do Supabase) não expõe transação entre
-- requisições — cada `.rpc()` committa sozinha ao terminar. A única
-- solução correta é uma ÚNICA chamada cobrindo as duas escritas, que é
-- exatamente o que esta função faz.
--
-- Esta função NÃO duplica a autorização: delega para as duas RPCs
-- existentes (`perform`), que já fazem, cada uma, a MESMA checagem (GERENTE
-- ou pode_mover_etapa, nunca owner_id) e a MESMA validação (negociação
-- pertence ao cliente, dentro de atualizar_cliente_do_card). Um corpo de
-- função PL/pgSQL É uma transação: se qualquer `perform` abaixo levantar
-- exceção (permissão, lifecycle, negociação/cliente não encontrados,
-- constraint de dados), a função inteira aborta e o Postgres desfaz
-- QUALQUER escrita já feita nela — nunca fica "cliente salvo, negociação
-- não" (ou vice-versa).
--
-- NÃO precisa ser SECURITY DEFINER: só chama outras duas funções que já são
-- (`perform`, sem tocar tabela nenhuma diretamente) — mesmo padrão de
-- `salvar_negociacao` (SECURITY INVOKER, delega pra `atualizar_dados_
-- operacionais_negociacao`, que é SECURITY DEFINER).
--
-- As RPCs individuais continuam existindo e utilizáveis por conta própria
-- (ex.: `salvar_negociacao`, tela/modal que não tocam cadastro de cliente).
-- Esta é só a combinação atômica que a ficha do card precisa.
--
-- NEGOCIAÇÃO ENCERRADA — REGRA DEFINITIVA (revisão desta rodada):
--   - cadastro do CLIENTE continua editável pela ficha autorizada (decisão
--     de produto — não é dado histórico da venda);
--   - os 8 campos OPERACIONAIS são somente leitura;
--   - uma TENTATIVA de alterar qualquer um dos 8 (valor diferente do que
--     já está salvo) é um ERRO explícito — NUNCA ignorada silenciosamente,
--     e NUNCA salva nem a parte do cliente nessa mesma chamada (atômico:
--     ou os dois lados ficam como o usuário pediu, ou nada muda).
--
-- Por isso esta função compara os 8 parâmetros operacionais recebidos
-- contra o que já está salvo em `negociacoes`: se a etapa não é 'aberta' e
-- algum dos 8 é diferente do valor atual, levanta 23514 com a mensagem
-- abaixo e NUNCA chama a RPC operacional — a chamada inteira é desfeita
-- (inclusive o cliente, se já tiver sido escrito nesta mesma transação; ver
-- ordem abaixo). Se a etapa não é 'aberta' mas os 8 valores enviados são
-- EXATAMENTE os que já estão salvos (a ficha manda os campos bloqueados
-- sem alteração), só o cliente é escrito — não é bypass: nada operacional
-- realmente mudaria de qualquer forma. Etapa aberta: os dois lados são
-- escritos juntos, normalmente.
--
-- ORDEM DENTRO DA FUNÇÃO: `atualizar_cliente_do_card` roda PRIMEIRO —
-- SECURITY DEFINER, bypassa RLS, já faz a autorização completa (GERENTE ou
-- pode_mover_etapa) e a validação cliente/negociação. A leitura de
-- `negociacoes` pra comparação de lifecycle, abaixo, é SECURITY INVOKER
-- (sujeita à RLS do chamador) — fazê-la ANTES da autorização confirmada
-- faria um chamador sem NENHUMA permissão (pode_ver_etapa=false) receber
-- "Negociação não encontrada" (linha invisível) em vez do 42501 correto.
-- Como o cliente já pode ter sido escrito quando a comparação acontece, um
-- 23514 levantado depois desfaz ele também (mesma transação) — atomicidade
-- preservada.
-- ===========================================================================
create or replace function public.salvar_ficha_negociacao(
  p_cliente_id             uuid,
  p_negociacao_id          uuid,
  p_tipo_cliente           public.tipo_cliente,
  p_nome                   text,
  p_empresa                text,
  p_cpf                    text,
  p_cnpj                   text,
  p_telefone               text,
  p_whatsapp               text,
  p_email                  text,
  p_responsavel            text,
  p_cargo                  text,
  p_instagram              text,
  p_observacoes            text,
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
set search_path = ''
as $$
declare
  v_etapa_id              uuid;
  v_aberta                boolean;
  v_nicho_id_atual        uuid;
  v_temperatura_atual     public.temperatura_negociacao;
  v_valor_estimado_atual  numeric;
  v_data_primeira_reuniao_atual date;
  v_data_proposta_atual   date;
  v_objecao_principal_atual text;
  v_valor_proposta_atual  numeric;
  v_forma_pagamento_atual public.forma_pagamento;
begin
  -- `atualizar_cliente_do_card` PRIMEIRO, de propósito: é SECURITY DEFINER
  -- (bypassa RLS) e já faz a checagem completa de autorização (GERENTE ou
  -- pode_mover_etapa) e a validação de que a negociação pertence ao
  -- cliente. A leitura abaixo (comparação de lifecycle) é SECURITY
  -- INVOKER — sujeita à RLS do chamador (`negociacoes_select`) — então só
  -- é feita DEPOIS de confirmar que o chamador tem autorização real; sem
  -- isso, um chamador sem NENHUMA linha em permissoes_colaborador (0 pode_
  -- ver) receberia "Negociação não encontrada" (linha invisível pra ele)
  -- em vez do 42501 correto — a mesma classe de bug já corrigida nas
  -- rodadas anteriores, desta vez quase reintroduzida por esta checagem.
  perform public.atualizar_cliente_do_card(
    p_cliente_id, p_negociacao_id, p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj,
    p_telefone, p_whatsapp, p_email, p_responsavel, p_cargo, p_instagram, p_observacoes
  );

  select n.etapa_id, n.nicho_id, n.temperatura, n.valor_estimado, n.data_primeira_reuniao,
         n.data_proposta, n.objecao_principal, n.valor_proposta, n.forma_pagamento
    into v_etapa_id, v_nicho_id_atual, v_temperatura_atual, v_valor_estimado_atual,
         v_data_primeira_reuniao_atual, v_data_proposta_atual, v_objecao_principal_atual,
         v_valor_proposta_atual, v_forma_pagamento_atual
    from public.negociacoes n
   where n.id = p_negociacao_id;

  v_aberta := public.etapa_tipo(v_etapa_id) = 'aberta';

  if not v_aberta
     and (
       p_nicho_id, p_temperatura, p_valor_estimado, p_data_primeira_reuniao,
       p_data_proposta, p_objecao_principal, p_valor_proposta, p_forma_pagamento
     ) is distinct from (
       v_nicho_id_atual, v_temperatura_atual, v_valor_estimado_atual, v_data_primeira_reuniao_atual,
       v_data_proposta_atual, v_objecao_principal_atual, v_valor_proposta_atual, v_forma_pagamento_atual
     )
  then
    raise exception 'Os dados comerciais desta negociação estão encerrados e não podem ser alterados.'
      using errcode = '23514';
  end if;

  if v_aberta then
    perform public.atualizar_dados_operacionais_negociacao(
      p_negociacao_id, p_nicho_id, p_temperatura, p_valor_estimado,
      p_data_primeira_reuniao, p_data_proposta, p_objecao_principal,
      p_valor_proposta, p_forma_pagamento
    );
  end if;
end;
$$;

comment on function public.salvar_ficha_negociacao is
  'Única operação atômica do botão "Salvar alterações" da ficha do card: '
  'cliente (atualizar_cliente_do_card) + dados operacionais da negociação '
  '(atualizar_dados_operacionais_negociacao), na MESMA transação — qualquer '
  'exceção em uma delas desfaz as duas. Negociação encerrada: cadastro '
  'continua editável; qualquer um dos 8 campos operacionais diferente do '
  'valor já salvo é rejeitado (23514) SEM salvar nem o cliente nessa '
  'tentativa — nunca ignora uma alteração operacional em silêncio. '
  'SECURITY INVOKER: a autorização real está nas duas funções delegadas '
  '(GERENTE ou pode_mover_etapa, nunca owner_id), não duplicada aqui. '
  'Nunca aceita etapa_id/funil_id/owner_id/origem/fechamento/motivo_perda.';

revoke all on function public.salvar_ficha_negociacao(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text,
  uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) from public, anon;
grant execute on function public.salvar_ficha_negociacao(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text,
  uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) to authenticated;
