-- ===========================================================================
-- "Cliente não encontrado" ficou resolvido (20261015110000); agora, ao abrir
-- um CARD existente como SDR e tentar salvar uma OBSERVAÇÃO, a operação
-- falha. Investigado sem assumir a causa:
--
-- 1. `atividades_select` já foi reescrita em 20261014160000 para usar
--    `pode_ver_etapa` — leitura da timeline já funciona para SDR/CLOSER
--    com qualquer permissão (ver OU mover).
-- 2. `atividades_insert`, porém, nunca foi tocada por 20261014160000 (essa
--    migration só reescreveu policies de SELECT, de propósito — ver seu
--    próprio comentário de seção 4). Ela continua exigindo o modelo ANTIGO:
--    `usuario_id = auth.uid() AND (cliente_owner(cliente_id) = auth.uid()
--    OR is_gerente()) AND (negociacao_id is null OR negociacao_owner(...)
--    = auth.uid() OR is_gerente())` — só quem É o dono da carteira do
--    cliente (ou da negociação) pode registrar uma atividade. Um SDR com
--    permissão perfeita, mas que não é `owner_id`, era bloqueado com 42501.
-- 3. O card do Kanban (`ModalFichaCliente`) ainda não tinha NENHUM controle
--    de "observação" ligado a `atividades` — só o campo `observacoes`
--    (cadastral, de `clientes`, editado junto com nome/telefone/empresa via
--    `ClienteForm`/`clientes_update`, que exige owner_id/gerente — isso é
--    edição de CADASTRO, fora do escopo deste pedido, não alterado). Esta
--    migration cobre o modelo de dados (`atividades_insert`); a UI nova é
--    tratada no código da aplicação, não aqui.
--
-- DECISÃO DE NEGÓCIO REFINADA (pedida explicitamente depois da primeira
-- versão desta migration, nunca aplicada): a permissão que importa para
-- "trabalhar o card" — incluindo registrar observação/atividade — é
-- `pode_mover`, não `pode_ver`. `pode_ver=true` sozinho é SÓ VISUALIZAÇÃO;
-- `pode_ver=true AND pode_mover=true` é quem pode de fato operar o card.
-- Por isso esta policy usa `pode_mover_etapa`, não `pode_ver_etapa` (meu
-- primeiro rascunho usava `pode_ver_etapa` — trocado antes de qualquer
-- aplicação real, nunca chegou a ir para produção).
--
-- NADA MAIS MUDA: `atividades_select` (continua `pode_ver_etapa` — ver
-- a timeline exige só visualização, não exige poder trabalhar o card),
-- `atividades_delete`, `proximas_acoes` (qualquer policy), `clientes_select`,
-- `negociacoes_select`, `clientes_update`, `negociacoes_update`,
-- `negociacoes_protege_movimentacao_por_permissao`,
-- `negociacoes_valida_handoff_sdr`, `pode_ver_etapa`, `pode_mover_etapa`,
-- `permissoes_colaborador` (tabela), `funil_metricas` — nenhum destes é
-- tocado por este arquivo.
--
-- REGRA NOVA de `atividades_insert`:
--   GERENTE: sempre.
--   SDR/CLOSER: precisa de `pode_mover_etapa(funil_id, etapa_id)` da
--     negociação indicada em `negociacao_id` — autorização ligada a uma
--     negociação ESPECÍFICA, nunca "qualquer uma do cliente", quando o
--     chamador informa qual negociação (é o caso do card do Kanban: o
--     formulário novo sempre manda `negociacao_id = card.id` explícito,
--     nunca deixa em aberto). Se `negociacao_id` vier null (fluxo livre de
--     `/clientes/[id]`, nota sem negociação específica), cai no mesmo
--     critério, mas sobre QUALQUER negociação do cliente (pode_mover em
--     pelo menos uma).
--   `usuario_id = auth.uid()` continua exigido (autor é sempre quem está
--     logado — ninguém registra em nome de outro).
--   `owner_id`/`cliente_owner()`/`negociacao_owner()` NÃO decidem mais
--     aqui — mesma migração de modelo que já valeu para SELECT, agora
--     também para esta policy de INSERT.
-- ===========================================================================

drop policy if exists atividades_insert on public.atividades;

create policy atividades_insert on public.atividades
  for insert
  to authenticated
  with check (
    usuario_id = (select auth.uid())
    and (
      public.is_gerente()
      or (
        negociacao_id is not null
        and exists (
          select 1 from public.negociacoes n
          where n.id = atividades.negociacao_id
            and n.cliente_id = atividades.cliente_id
            and public.pode_mover_etapa(n.funil_id, n.etapa_id)
        )
      )
      or (
        negociacao_id is null
        and exists (
          select 1 from public.negociacoes n
          where n.cliente_id = atividades.cliente_id
            and public.pode_mover_etapa(n.funil_id, n.etapa_id)
        )
      )
    )
  );

comment on policy atividades_insert on public.atividades is
  'GERENTE sempre. SDR/CLOSER: pode_MOVER_etapa (não só pode_ver) na '
  'negociação indicada em negociacao_id — "ver" não é suficiente para '
  'registrar; só quem pode trabalhar o card registra. Se negociacao_id vier '
  'null, exige pode_mover em qualquer negociação do cliente. '
  'owner_id/cliente_owner()/negociacao_owner() não decidem mais.';
