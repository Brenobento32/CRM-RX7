-- ===========================================================================
-- Fecha o gap: UPDATE direto de negociacoes.etapa_id fora da RPC
-- mover_negociacao.
--
-- ACHADO (auditoria pós-aplicação de 20261014160000_permissoes_colaborador):
-- a policy `negociacoes_update` (pré-existente, NÃO criada por esta
-- migration) ainda é `owner_id = auth.uid() OR is_gerente()` — ela precisa
-- continuar existindo para edições comerciais comuns (valor_estimado,
-- temperatura, observações, etc.), mas isso também libera, pra quem for
-- owner_id, qualquer UPDATE de `etapa_id` que não passe por
-- `mover_negociacao` — e no código existem pelo menos três desses caminhos:
--   1. `fechar_negociacao()` (RPC, NÃO security definer) — UPDATE direto de
--      etapa_id = etapa "ganha" do funil.
--   2. `marcarPerdida()` (lib/dal/funil.ts) — `.update({ etapa_id: ... })`
--      direto pra etapa "perdida" do funil.
--   3. `reativarNegociacao()` (lib/dal/negociacoes.ts) — `.update({ etapa_id:
--      ... })` direto pra etapa inicial do funil, ao reativar um lead
--      arquivado.
-- Nos três, owner_id (sozinho) hoje basta pra RLS aceitar o UPDATE —
-- `pode_mover_etapa` nunca é consultado. Isso viola a regra definitiva do
-- modelo de permissões (20261014160000): "owner_id NÃO concede permissão
-- pra alterar etapa", que até agora só valia de fato dentro do RPC
-- `mover_negociacao`.
--
-- CORREÇÃO: um trigger `BEFORE UPDATE OF etapa_id` em `negociacoes` —
-- dispara em QUALQUER UPDATE que mude a coluna, seja lá de onde vier (RPC
-- não-security-definer, `.update()` direto do Next.js, ou uma chamada crua
-- na API REST do Supabase ignorando a aplicação inteira). Gerente passa
-- direto; qualquer outro papel precisa de `pode_mover_etapa(funil_id,
-- etapa_destino)` — a MESMA função já usada pela policy de SELECT e pelo
-- RPC `mover_negociacao` (nenhuma regra nova, só a regra de sempre aplicada
-- em mais um lugar).
--
-- NÃO SUBSTITUI nem remove o trigger de handoff
-- (`negociacoes_valida_handoff_sdr`, 20261014150000) — os dois continuam
-- existindo e disparando juntos em todo UPDATE de etapa_id. Esta migration
-- só adiciona a camada de PERMISSÃO (pode_mover_etapa); o teto de handoff do
-- SDR continua sendo uma camada SEPARADA e adicional, nunca relaxada por
-- permissão configurada (mesma regra de antes).
--
-- NÃO toca na migration já aplicada (20261014160000_permissoes_colaborador.sql)
-- nem na policy `negociacoes_update` em si — ela continua permitindo que o
-- owner (ou gerente) edite os OUTROS campos da negociação; só a MUDANÇA DE
-- ETAPA ganha essa trava extra, pelo trigger, não pela policy.
--
-- UPDATE que não muda etapa_id (ex.: só editar valor_estimado, ou um UPDATE
-- que reafirma a mesma etapa) passa direto, sem nenhuma checagem de
-- permissão — ver a comparação `new.etapa_id is not distinct from
-- old.etapa_id` abaixo. Não é uma regra nova: é a garantia de que esta
-- migration só protege a MUDANÇA real de etapa, nunca o resto do UPDATE.
-- ===========================================================================

create or replace function public.negociacoes_protege_movimentacao_por_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- etapa_id não mudou de fato (coluna só citada no SET, ou UPDATE de outro
  -- campo junto) — nada a proteger aqui, nunca bloquear uma edição comercial
  -- legítima só porque etapa_id apareceu na lista de colunas tocadas.
  if new.etapa_id is not distinct from old.etapa_id then
    return new;
  end if;

  -- Gerente continua com acesso total de movimentação, sem precisar de
  -- nenhuma linha em permissoes_colaborador — mesma regra de sempre.
  if public.is_gerente() then
    return new;
  end if;

  -- owner_id NUNCA é bypass aqui: só pode_mover_etapa decide, pra qualquer
  -- papel que não seja gerente (SDR ou CLOSER). `pode_mover_etapa` já é
  -- SECURITY DEFINER e usa auth.uid() internamente (sessão, não afetado por
  -- quem é o "dono" da função/RPC que disparou este UPDATE).
  if not public.pode_mover_etapa(new.funil_id, new.etapa_id) then
    raise exception 'Você não tem permissão para mover esta negociação.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.negociacoes_protege_movimentacao_por_permissao is
  'Backstop no banco pra TODO UPDATE de negociacoes.etapa_id (RPC não '
  'security definer, código da aplicação, ou API/REST direta) — fecha o '
  'bypass que a policy negociacoes_update (owner_id OR gerente) ainda '
  'permitia só pra essa coluna, já que ela existe pra permitir edição dos '
  'OUTROS campos da negociação pelo dono. Gerente passa direto; qualquer '
  'outro papel precisa de pode_mover_etapa(funil_id, etapa_destino) — owner_id '
  'nunca entra nesta decisão. Coexiste com negociacoes_valida_handoff_sdr '
  '(20261014150000): este trigger não substitui, nem remove, nem relaxa o '
  'teto de handoff do SDR — as duas camadas (permissão + handoff) continuam '
  'valendo juntas. UPDATE que não muda etapa_id de fato (new = old) passa '
  'direto, sem checagem nenhuma.';

revoke all on function public.negociacoes_protege_movimentacao_por_permissao() from public, anon;

-- A trava específica de handoff (negociacoes_valida_handoff_sdr) e esta
-- (genérica, de permissão) coexistem como dois triggers independentes na
-- mesma coluna — o Postgres dispara os dois, em ordem alfabética pelo nome
-- do trigger (sem relação de precedência que importe aqui: cada um só
-- bloqueia o próprio motivo, e um RAISE EXCEPTION em qualquer um já aborta o
-- UPDATE inteiro).
create trigger negociacoes_protege_movimentacao_por_permissao
  before update of etapa_id on public.negociacoes
  for each row
  execute function public.negociacoes_protege_movimentacao_por_permissao();
