-- ===========================================================================
-- RPC `desqualificar_negociacao` — "Desqualificar lead" deixa de exigir
-- owner_id e passa a aceitar GERENTE ou pode_ver_etapa(funil_id, etapa_id).
--
-- REGRA DE NEGÓCIO (pedido explícito, independente de `pode_mover_etapa`):
-- SDR e CLOSER devem poder desqualificar qualquer lead/card que CONSIGAM
-- VER, em QUALQUER etapa do funil — inclusive GANHA e PERDIDA, preservando o
-- comportamento que já existe hoje pra owner/gerente (nada no banco nunca
-- bloqueou desqualificar um negócio encerrado; esta migration não introduz
-- essa restrição). `pode_mover_etapa` NUNCA é requisito aqui — "desqualificar"
-- é uma ação diferente de "mover etapa". `owner_id` também não é requisito:
-- mesma mudança de modelo de 20261014160000/20261016160000 (owner_id só
-- segue existindo como atribuição/responsável, nunca como autorização).
--
-- ACHADO (auditoria pedida antes de implementar): `arquivarNegociacao()`
-- (lib/dal/negociacoes.ts) hoje faz um `.update()` direto em `negociacoes`,
-- sem RPC — a única trava é a policy `negociacoes_update` (pré-existente,
-- 20260923120400: owner_id = auth.uid() OR is_gerente()). Resultado: um
-- SDR/CLOSER com `pode_ver_etapa = true` mas que NÃO é owner_id é bloqueado
-- (42501) mesmo enxergando e trabalhando o card normalmente no Kanban — e um
-- owner_id consegue desqualificar em QUALQUER etapa hoje (nenhum trigger de
-- lifecycle cobre `arquivada_em`/`motivo_arquivamento`), inclusive ganha/
-- perdida. O pedido é mudar QUEM autoriza, nunca O QUE é permitido.
--
-- CORREÇÃO: mesmo padrão de `mover_negociacao` (20261014160000) e
-- `atualizar_dados_operacionais_negociacao` (20261016160000) — uma RPC
-- SECURITY DEFINER própria, com a autorização inteiramente explícita no
-- corpo da função (não depende de `negociacoes_update`). Só que aqui a
-- função de permissão é `pode_ver_etapa`, não `pode_mover_etapa` — único
-- caso no código onde VER (não mover) já basta pra autorizar uma escrita,
-- porque a ação em si não é "mover etapa".
--
-- `negociacoes_update` NÃO é alterada por esta migration — continua intacta
-- para as edições comerciais do dono que não passam por nenhuma RPC.
--
-- NÃO toca etapa_id, funil_id, owner_id, origem, fechamento ou motivo_perda
-- — só `arquivada_em`/`motivo_arquivamento`, as duas colunas que a ação
-- "desqualificar" sempre alterou (`arquivarNegociacao`, antes desta
-- migration). Nenhuma regra de movimentação, handoff SDR ou lifecycle dos 8
-- campos operacionais é tocada ou relaxada.
-- ===========================================================================

create or replace function public.desqualificar_negociacao(
  p_negociacao_id uuid,
  p_motivo        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_etapa_id uuid;
  v_motivo   text;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_id
    from public.negociacoes n
   where n.id = p_negociacao_id
     and n.arquivada_em is null
     for update;

  if v_funil_id is null then
    raise exception 'Lead não encontrado ou já está arquivado.' using errcode = 'P0002';
  end if;

  if not public.is_gerente() and not public.pode_ver_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para esta operação.' using errcode = '42501';
  end if;

  v_motivo := btrim(p_motivo);
  if v_motivo is null or v_motivo = '' then
    raise exception 'Informe o motivo da desqualificação.' using errcode = '23514';
  end if;

  update public.negociacoes
     set arquivada_em = now(),
         motivo_arquivamento = v_motivo
   where id = p_negociacao_id;
end;
$$;

comment on function public.desqualificar_negociacao is
  'Único caminho de escrita de "Desqualificar lead" (arquivada_em + '
  'motivo_arquivamento). SECURITY DEFINER: GERENTE ou pode_ver_etapa(funil_id, '
  'etapa_id) autoriza — pode_mover_etapa NUNCA é consultado (desqualificar é '
  'ação diferente de mover etapa) e owner_id NUNCA é consultado (mesma regra '
  'de mover_negociacao/atualizar_dados_operacionais_negociacao). Funciona em '
  'QUALQUER etapa, inclusive ganha/perdida — preserva o comportamento que já '
  'existia antes desta migration (nenhum lifecycle cobria essas duas '
  'colunas). Nunca toca etapa_id/funil_id/owner_id/origem/fechamento/'
  'motivo_perda. negociacoes_update (owner_id OR gerente) continua intacta '
  'para as demais edições comerciais do dono.';

revoke all on function public.desqualificar_negociacao(uuid, text) from public, anon;
grant execute on function public.desqualificar_negociacao(uuid, text) to authenticated;
