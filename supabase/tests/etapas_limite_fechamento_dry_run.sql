-- ===========================================================================
-- Dry-run de "Corrigir limite de posição de etapas abertas"
-- (supabase/migrations/20260929130000_etapas_limite_fechamento.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. NÃO
--   depende da migration 20260929130000 já ter sido aplicada: a própria
--   transação instala, temporariamente, a mesma definição de
--   etapas_funil_regras() que essa migration vai instalar — byte a byte
--   idêntica (copiada de lá, exceto os comentários de cabeçalho da
--   migration). `create or replace function` é DDL transacional no
--   Postgres, então o ROLLBACK no fim desfaz a substituição junto com todo
--   o resto: nada fica gravado, nem dado de teste nem a função.
--
--   Resultado inequívoco: se TODOS os L1-L11 passarem, o Editor termina em
--   "Success" com uma linha de resultado "OK — ...". Se QUALQUER L1-L11
--   falhar, o bloco `do` propaga o erro sem capturá-lo — o Editor termina em
--   ERROR, com a mensagem original do assert que falhou (nunca "Success").
--
-- O QUE ELE PROVA
--   1. Uma etapa aberta pode ficar imediatamente antes de Fechado/Perdido.
--   2. Uma etapa aberta pode passar pela etapa Negociação (não há mais
--      dependência especial da chave 'negociacao' para limitar a ordem).
--   3. Duas etapas abertas podem trocar de posição livremente entre si.
--   4. Fechado continua protegido como etapa final única.
--   5. Perdido continua protegido como etapa final única.
--   6. O Funil Principal continua funcionando com a nova regra.
--   7. Um funil novo (sem chave 'negociacao') continua funcionando igual.
--   8. Nada além de `etapas_funil.ordem` é alterado: negociações, cards
--      (histórico) e fechamentos ficam intocados.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instala TEMPORARIAMENTE, dentro desta transação, a mesma definição de
-- etapas_funil_regras() de
-- supabase/migrations/20260929130000_etapas_limite_fechamento.sql — byte a
-- byte idêntica (copiada de lá). Vale só até o ROLLBACK no fim deste
-- arquivo, que desfaz a substituição junto com os dados de teste.
-- ---------------------------------------------------------------------------
create or replace function public.etapas_funil_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limite numeric;
begin
  if tg_op = 'DELETE' then
    if old.sistema then
      raise exception 'Etapas padrão do funil não podem ser excluídas.' using errcode = '23514';
    end if;
    if exists (select 1 from public.negociacoes n where n.etapa_id = old.id)
       or exists (
         select 1 from public.historico_etapas h
         where h.etapa_nova_id = old.id or h.etapa_anterior_id = old.id
       )
    then
      raise exception 'A etapa "%" já teve negociações. Desative-a em vez de excluir.', old.nome
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.sistema then
    -- Sistema: só a cor muda (nem o funil de uma etapa de sistema muda).
    if new.nome is distinct from old.nome
       or new.ordem is distinct from old.ordem
       or new.tipo is distinct from old.tipo
       or new.sistema is distinct from old.sistema
       or new.chave is distinct from old.chave
       or new.ativo is distinct from old.ativo
       or new.funil_id is distinct from old.funil_id
    then
      raise exception 'Nas etapas padrão do funil só a cor pode ser alterada.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Personalizada (inserção ou edição) — inclusive ganha/perdida de um funil novo.
  if new.sistema or new.chave is not null then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;

  if new.tipo = 'aberta' then
    select min(e.ordem) into v_limite
      from public.etapas_funil e
     where e.funil_id = new.funil_id
       and e.tipo in ('ganha', 'perdida');

    if v_limite is not null and new.ordem >= v_limite then
      raise exception 'Etapas abertas ficam antes das etapas de fechamento do funil.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.ativo and not new.ativo
     and exists (select 1 from public.negociacoes n where n.etapa_id = new.id)
  then
    raise exception 'Mova as negociações da etapa "%" antes de desativá-la.', new.nome
      using errcode = '23514';
  end if;

  return new;
end;
$$;

do $$
declare
  v_gerente     uuid := '55555555-5555-5555-5555-555555555555';

  -- Funil Principal
  v_funil_id    uuid;
  v_negociacao  uuid;
  v_ordem_neg   numeric;
  v_max_aberta  numeric;
  v_fechado     uuid;
  v_ordem_fech  numeric;
  v_perdido     uuid;
  v_ordem_perd  numeric;
  v_recup       uuid;
  v_retencao    uuid;

  -- Funil novo
  v_funil_novo  uuid;
  v_ganha_novo  uuid;
  v_ordem_ganha_novo numeric;
  v_aberta_novo uuid;

  v_neg_antes   integer; v_neg_depois   integer;
  v_hist_antes  integer; v_hist_depois  integer;
  v_fech_antes  integer; v_fech_depois  integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'dryrun.limite.fechamento.gerente@teste.local', '', now(), now(), now(),
    '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Limite Fechamento"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id, ordem into v_fechado, v_ordem_fech from public.etapas_funil where chave = 'fechado';
  select id, ordem into v_perdido, v_ordem_perd from public.etapas_funil where chave = 'perdido';
  select funil_id  into v_funil_id  from public.etapas_funil where chave = 'fechado';
  select id, ordem into v_negociacao, v_ordem_neg from public.etapas_funil where chave = 'negociacao';

  -- Maior `ordem` já usada entre as abertas reais do funil (inclui a
  -- Negociação). Os valores de teste abaixo partem daqui, nunca de números
  -- fixos: por construção, nenhuma etapa real já existente pode ocupar
  -- `v_max_aberta + N` para N > 0 — evita colidir com `etapas_funil_ordem_unica`
  -- mesmo que dados de testes manuais anteriores já estejam no Funil Principal.
  select max(ordem) into v_max_aberta
    from public.etapas_funil
   where funil_id = v_funil_id and tipo = 'aberta';

  -- "Fotografia" de tudo que a reordenação não deve tocar.
  select count(*) into v_neg_antes  from public.negociacoes;
  select count(*) into v_hist_antes from public.historico_etapas;
  select count(*) into v_fech_antes from public.fechamentos;

  -- =========================================================================
  -- FUNIL PRINCIPAL
  -- =========================================================================

  -- L1: sem dependência especial de chave='negociacao' — aberta nasce com
  -- ordem MAIOR que a da Negociação (era barrado antes da correção).
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
  values (v_funil_id, 'Recuperação — dry-run limite', 'ciano', v_max_aberta + 100, 'aberta')
  returning id into v_recup;
  assert (select ordem from public.etapas_funil where id = v_recup) > v_ordem_neg,
    'Recuperação deveria poder nascer com ordem maior que a de Negociação';
  raise notice 'ok  L1  aberta nasce com ordem > ordem(Negociação) — dependência especial removida';

  -- L2: aberta pode ficar imediatamente antes de Fechado (última posição aberta).
  update public.etapas_funil
     set ordem = (v_ordem_fech + v_ordem_neg) / 2   -- entre Negociação e Fechado
   where id = v_recup;
  assert (select ordem from public.etapas_funil where id = v_recup) between v_ordem_neg and v_ordem_fech,
    'Recuperação deveria conseguir ficar logo antes de Fechado, depois de Negociação';
  raise notice 'ok  L2  aberta pode ocupar a última posição aberta, logo antes do fechamento';

  -- L3: aberta continua IMPEDIDA de alcançar ou ultrapassar Fechado.
  begin
    update public.etapas_funil set ordem = v_ordem_fech where id = v_recup;
    assert false, 'não deveria ser possível igualar a ordem de Fechado';
  exception when check_violation then
    raise notice 'ok  L3  Fechado protegido: aberta não alcança nem ultrapassa';
  end;

  -- L4: aberta continua IMPEDIDA de alcançar ou ultrapassar Perdido.
  begin
    update public.etapas_funil set ordem = v_ordem_perd where id = v_recup;
    assert false, 'não deveria ser possível igualar a ordem de Perdido';
  exception when check_violation then
    raise notice 'ok  L4  Perdido protegido: aberta não alcança nem ultrapassa';
  end;

  -- restaura Recuperação pra antes da correção seguinte
  update public.etapas_funil set ordem = v_max_aberta + 200 where id = v_recup;

  -- L5: duas etapas abertas (ambas personalizadas) trocam de posição livremente.
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
  values (v_funil_id, 'Retenção — dry-run limite', 'turquesa', v_max_aberta + 300, 'aberta')
  returning id into v_retencao;
  -- Recuperação (max+200) < Retenção (max+300); troca as duas de lugar. Uma
  -- troca direta colide em `etapas_funil_ordem_unica` (as duas passariam por
  -- um instante com o mesmo `ordem`): move Recuperação pra uma posição
  -- temporária fora da faixa usada pelas duas antes de dar a cada uma a
  -- posição final da outra — mesma técnica que `moverEtapa()` evita ao
  -- calcular sempre um ponto médio livre antes de gravar.
  update public.etapas_funil set ordem = v_max_aberta + 1000 where id = v_recup;    -- temporário, livre
  update public.etapas_funil set ordem = v_max_aberta + 200  where id = v_retencao; -- assume a posição antiga de Recuperação
  update public.etapas_funil set ordem = v_max_aberta + 300  where id = v_recup;    -- assume a posição antiga de Retenção
  assert (select ordem from public.etapas_funil where id = v_recup)
       > (select ordem from public.etapas_funil where id = v_retencao),
    'Recuperação e Retenção deveriam ter trocado de posição';
  raise notice 'ok  L5  duas abertas trocam de posição livremente entre si';

  -- L6: Fechado continua único por funil (índice). `ordem` derivado de
  -- v_ordem_fech (nunca um número fixo) pra não colidir com nenhuma linha
  -- real já existente.
  begin
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Fechado 2 — dry-run limite', 'verde', v_ordem_fech + 12345, 'ganha');
    assert false, 'não deveria haver duas etapas ganha no mesmo funil';
  exception when unique_violation then
    raise notice 'ok  L6  ainda só uma etapa ganha (Fechado) por funil';
  end;

  -- L7: Perdido continua único por funil (índice). Mesma lógica, a partir de
  -- v_ordem_perd.
  begin
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Perdido 2 — dry-run limite', 'vermelho', v_ordem_perd + 12345, 'perdida');
    assert false, 'não deveria haver duas etapas perdida no mesmo funil';
  exception when unique_violation then
    raise notice 'ok  L7  ainda só uma etapa perdida (Perdido) por funil';
  end;

  raise notice 'ok  L8  Funil Principal continua funcionando com a regra nova (L1-L7 acima)';

  -- =========================================================================
  -- FUNIL NOVO (sem etapa de chave 'negociacao') — mesma regra deve valer.
  -- =========================================================================
  select public.criar_funil(
    'Funil Dry-Run — Limite Fechamento',
    'Fechado — dry-run limite', 'verde',
    'Perdido — dry-run limite', 'vermelho',
    '[{"nome":"Contato — dry-run limite","cor":"azul"}]'::jsonb
  ) into v_funil_novo;

  select id, ordem into v_ganha_novo, v_ordem_ganha_novo
    from public.etapas_funil where funil_id = v_funil_novo and tipo = 'ganha';
  select id into v_aberta_novo
    from public.etapas_funil where funil_id = v_funil_novo and tipo = 'aberta' limit 1;

  -- L9: aberta do funil novo pode ir até imediatamente antes de Fechado.
  update public.etapas_funil set ordem = v_ordem_ganha_novo - 1 where id = v_aberta_novo;
  assert (select ordem from public.etapas_funil where id = v_aberta_novo) = v_ordem_ganha_novo - 1,
    'aberta do funil novo deveria conseguir ficar logo antes de Fechado';
  raise notice 'ok  L9  funil novo: aberta ocupa a última posição, logo antes do fechamento';

  -- L10: aberta do funil novo continua IMPEDIDA de alcançar Fechado.
  begin
    update public.etapas_funil set ordem = v_ordem_ganha_novo where id = v_aberta_novo;
    assert false, 'não deveria ser possível igualar a ordem de Fechado no funil novo';
  exception when check_violation then
    raise notice 'ok  L10 funil novo: Fechado protegido, comportamento idêntico ao Principal';
  end;

  -- =========================================================================
  -- Nada além de etapas_funil.ordem foi tocado.
  -- =========================================================================
  select count(*) into v_neg_depois  from public.negociacoes;
  select count(*) into v_hist_depois from public.historico_etapas;
  select count(*) into v_fech_depois from public.fechamentos;
  assert v_neg_antes = v_neg_depois,   format('negociacoes mudou: antes=%s depois=%s', v_neg_antes, v_neg_depois);
  assert v_hist_antes = v_hist_depois, format('historico_etapas mudou: antes=%s depois=%s', v_hist_antes, v_hist_depois);
  assert v_fech_antes = v_fech_depois, format('fechamentos mudou: antes=%s depois=%s', v_fech_antes, v_fech_depois);
  raise notice 'ok  L11 reordenação não altera negociacoes/historico_etapas/fechamentos';

  raise notice 'TODOS OS TESTES DE LIMITE DE FECHAMENTO PASSARAM (L1-L11)';
end $$;

-- Só chega aqui se NENHUM assert L1-L11 falhou: uma falha em qualquer um
-- deles propaga sem ser capturada, o bloco `do` acima termina em erro e o
-- SQL Editor mostra ERROR (nunca "Success") com a mensagem original do
-- assert — este SELECT nunca roda nesse caso. Em sucesso, dá um resultado
-- inequívoco na grade, mesmo que NOTICEs não apareçam na interface.
select 'OK — TODOS OS TESTES DE LIMITE DE FECHAMENTO PASSARAM (L1-L11)' as resultado;

rollback;
