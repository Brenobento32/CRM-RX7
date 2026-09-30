-- ===========================================================================
-- Dry-run de "Exclusão de cliente com auditoria"
-- (supabase/migrations/20260930170000_clientes_exclusao.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. NÃO
--   depende da migration acima já ter sido aplicada: a própria transação
--   adiciona, temporariamente, as colunas `excluido_em`, `excluido_por`,
--   `motivo_exclusao` e a constraint `clientes_motivo_exclusao_obrigatorio`
--   em `clientes` — byte a byte idênticas à migration. ROLLBACK no final
--   desfaz tudo (colunas, constraint e dados de teste). Nada fica gravado.
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
--   Não há função/RPC nova aqui — `excluirCliente`/`restaurarClienteExcluido`
--   (lib/dal/clientes.ts) são UPDATE direto com WHERE guardando a regra
--   ("só se já arquivado", "só se já excluído"). Este dry-run reproduz
--   exatamente essas mesmas queries, linha a linha.
--
-- O QUE ELE PROVA
--   M1  as 3 colunas novas existem depois da migration.
--   C1  motivo obrigatório — constraint recusa excluido_em preenchido com
--       motivo_exclusao nulo.
--   E2  excluir cliente que NÃO está arquivado (ativo) não afeta nenhuma
--       linha — a WHERE da DAL bloqueia antes de chegar na constraint.
--   E1  excluir cliente arquivado grava excluido_em, excluido_por e
--       motivo_exclusao; deleted_at (arquivado) não é tocado.
--   E3  excluir cliente já excluído (2ª tentativa) não afeta nenhuma linha
--       — não sobrescreve excluido_por/motivo_exclusao existentes.
--   H1  negociação e historico_etapas do cliente continuam intactos depois
--       de excluir.
--   D1  nenhuma linha de clientes/negociacoes/historico_etapas foi apagada
--       (nenhum DELETE físico em lugar nenhum do fluxo) — o próprio cliente
--       excluído continua existindo como linha.
--   R1  restaurar excluído volta pra ARQUIVADO — deleted_at continua
--       preenchido, excluido_em/excluido_por/motivo_exclusao voltam a null.
--   R2  restaurar-de-exclusão não afeta cliente que nunca foi excluído.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária (migration 20260930170000_clientes_exclusao.sql).
-- ---------------------------------------------------------------------------
alter table public.clientes
  add column excluido_em     timestamptz,
  add column excluido_por    uuid references public.profiles (id) on delete set null,
  add column motivo_exclusao text;

alter table public.clientes
  add constraint clientes_motivo_exclusao_obrigatorio
  check (excluido_em is null or motivo_exclusao is not null);

comment on column public.clientes.excluido_em is
  'Soft delete "definitivo" (nunca DELETE físico). A RLS não filtra por esta '
  'coluna — quem filtra é a DAL, igual a deleted_at.';
comment on column public.clientes.excluido_por is
  'Quem excluiu. Null se o profile foi apagado depois (on delete set null).';
comment on column public.clientes.motivo_exclusao is
  'Texto livre obrigatório ao excluir (ver constraint clientes_motivo_exclusao_obrigatorio).';

-- ---------------------------------------------------------------------------
-- Testes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente uuid := 'eeeeeeee-5555-5555-5555-555555555555';
  v_closer  uuid := 'ffffffff-5555-5555-5555-555555555555';

  v_funil_principal uuid;

  v_cliente_arquivado uuid; -- C1, E2 (negativo), E1, H1, D1, R1
  v_cliente_ativo     uuid; -- E2, R2
  v_cliente_excluido  uuid; -- E3

  v_negociacao uuid;

  v_clientes_antes  integer;
  v_neg_antes       integer;
  v_hist_antes      integer;
  v_clientes_depois integer;
  v_neg_depois      integer;
  v_hist_depois     integer;

  v_linhas_afetadas integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.exclusao.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Exclusão"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.exclusao.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run Exclusão"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);

  select id into v_funil_principal from public.funis where padrao;

  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Exclusão Arquivado', 'Empresa Arq', v_closer) returning id into v_cliente_arquivado;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Exclusão Ativo', 'Empresa Ativo', v_closer) returning id into v_cliente_ativo;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Exclusão Já Excluído', 'Empresa Exc', v_closer) returning id into v_cliente_excluido;

  -- Negociação + histórico do cliente que vai ser excluído — prova de H1.
  select public.criar_negociacao(v_cliente_arquivado, v_funil_principal, 4000.00, 'quente') into v_negociacao;

  -- Arquiva os dois que precisam estar arquivados (mesma UPDATE de arquivarCliente).
  update public.clientes set deleted_at = now() where id in (v_cliente_arquivado, v_cliente_excluido);

  -- v_cliente_excluido já entra pré-excluído, pra testar E3 (idempotência).
  update public.clientes
     set excluido_em = now(), excluido_por = v_gerente, motivo_exclusao = 'Motivo pré-existente — dry-run'
   where id = v_cliente_excluido;

  select count(*) into v_clientes_antes from public.clientes;
  select count(*) into v_neg_antes      from public.negociacoes;
  select count(*) into v_hist_antes     from public.historico_etapas;

  -- =========================================================================
  -- M1: colunas existem.
  -- =========================================================================
  assert (
    select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'clientes'
       and column_name in ('excluido_em', 'excluido_por', 'motivo_exclusao')
  ) = 3, 'M1: as 3 colunas da migration deveriam existir em clientes';
  raise notice 'ok  M1  colunas excluido_em/excluido_por/motivo_exclusao existem';

  -- =========================================================================
  -- C1: motivo obrigatório — constraint recusa motivo nulo quando
  -- excluido_em está preenchido.
  -- =========================================================================
  begin
    update public.clientes
       set excluido_em = now(), motivo_exclusao = null
     where id = v_cliente_arquivado;
    assert false, 'C1: constraint deveria ter recusado excluido_em sem motivo_exclusao';
  exception when check_violation then
    raise notice 'ok  C1  motivo obrigatório (constraint recusa excluido_em sem motivo)';
  end;
  assert (select excluido_em from public.clientes where id = v_cliente_arquivado) is null,
    'C1: excluido_em não poderia ter sido gravado (tentativa deveria ter sido revertida)';

  -- =========================================================================
  -- E2: excluir cliente ATIVO (nunca arquivado) — WHERE da DAL bloqueia.
  -- =========================================================================
  update public.clientes
     set excluido_em = now(), excluido_por = v_gerente, motivo_exclusao = 'Não deveria gravar'
   where id = v_cliente_ativo
     and deleted_at is not null
     and excluido_em is null;
  get diagnostics v_linhas_afetadas = row_count;
  assert v_linhas_afetadas = 0, 'E2: excluir cliente ativo (não arquivado) não deveria afetar nenhuma linha';
  assert (select excluido_em from public.clientes where id = v_cliente_ativo) is null,
    'E2: excluido_em do cliente ativo deveria continuar null';
  raise notice 'ok  E2  excluir cliente ativo (não arquivado) é ignorado pela WHERE da DAL';

  -- =========================================================================
  -- E1: excluir cliente arquivado — grava excluido_em, excluido_por,
  -- motivo_exclusao. Mesma UPDATE de excluirCliente().
  -- =========================================================================
  update public.clientes
     set excluido_em = now(), excluido_por = v_gerente, motivo_exclusao = 'Cliente inativo há 2 anos — dry-run'
   where id = v_cliente_arquivado
     and deleted_at is not null
     and excluido_em is null;
  get diagnostics v_linhas_afetadas = row_count;
  assert v_linhas_afetadas = 1, 'E1: excluir cliente arquivado deveria afetar exatamente 1 linha';
  raise notice 'ok  E1  UPDATE de exclusão afeta exatamente o cliente arquivado';

  assert (select excluido_em from public.clientes where id = v_cliente_arquivado) is not null,
    'E1: excluido_em deveria estar preenchido';
  raise notice 'ok  E1  excluido_em registrado';

  assert (select excluido_por from public.clientes where id = v_cliente_arquivado) = v_gerente,
    'E1: excluido_por deveria ser quem excluiu';
  raise notice 'ok  E1  excluido_por registrado';

  assert (select motivo_exclusao from public.clientes where id = v_cliente_arquivado)
       = 'Cliente inativo há 2 anos — dry-run',
    'E1: motivo_exclusao deveria ter sido salvo exatamente como enviado';
  raise notice 'ok  E1  motivo_exclusao salvo';

  assert (select deleted_at from public.clientes where id = v_cliente_arquivado) is not null,
    'E1: deleted_at (arquivado) não deveria ter sido tocado por excluirCliente';
  raise notice 'ok  E1  deleted_at (arquivado) preservado';

  -- =========================================================================
  -- E3: excluir cliente JÁ excluído (idempotência) — WHERE bloqueia de novo.
  -- =========================================================================
  update public.clientes
     set excluido_em = now(), excluido_por = v_closer, motivo_exclusao = 'Segunda tentativa — não deveria gravar'
   where id = v_cliente_excluido
     and deleted_at is not null
     and excluido_em is null;
  get diagnostics v_linhas_afetadas = row_count;
  assert v_linhas_afetadas = 0, 'E3: excluir cliente já excluído não deveria afetar nenhuma linha';
  assert (select excluido_por from public.clientes where id = v_cliente_excluido) = v_gerente,
    'E3: excluido_por não poderia ter sido sobrescrito';
  raise notice 'ok  E3  excluir cliente já excluído é ignorado (sem sobrescrever)';

  -- =========================================================================
  -- H1: negociação e histórico do cliente continuam intactos.
  -- =========================================================================
  assert exists (select 1 from public.negociacoes where id = v_negociacao and cliente_id = v_cliente_arquivado),
    'H1: a negociação do cliente excluído deveria continuar existindo';
  assert exists (select 1 from public.historico_etapas where negociacao_id = v_negociacao),
    'H1: o histórico da negociação deveria continuar existindo';
  raise notice 'ok  H1  negociação e histórico do cliente continuam intactos após excluir';

  -- =========================================================================
  -- D1: nenhum DELETE físico em lugar nenhum do fluxo (só UPDATE).
  -- =========================================================================
  select count(*) into v_clientes_depois from public.clientes;
  select count(*) into v_neg_depois      from public.negociacoes;
  select count(*) into v_hist_depois     from public.historico_etapas;
  assert v_clientes_depois = v_clientes_antes,
    format('D1: contagem de clientes não poderia ter mudado (antes=%s depois=%s)', v_clientes_antes, v_clientes_depois);
  assert v_neg_depois = v_neg_antes,
    format('D1: contagem de negociações não poderia ter mudado (antes=%s depois=%s)', v_neg_antes, v_neg_depois);
  assert v_hist_depois = v_hist_antes,
    format('D1: contagem de historico_etapas não poderia ter mudado (antes=%s depois=%s)', v_hist_antes, v_hist_depois);
  assert exists (select 1 from public.clientes where id = v_cliente_arquivado),
    'D1: o próprio cliente excluído continua existindo como linha (soft delete, não DELETE)';
  raise notice 'ok  D1  nenhuma linha física apagada em clientes/negociacoes/historico_etapas';

  -- =========================================================================
  -- R1: restaurar excluído volta pra ARQUIVADO (não pra ativo). Mesma UPDATE
  -- de restaurarClienteExcluido().
  -- =========================================================================
  update public.clientes
     set excluido_em = null, excluido_por = null, motivo_exclusao = null
   where id = v_cliente_arquivado
     and excluido_em is not null;
  get diagnostics v_linhas_afetadas = row_count;
  assert v_linhas_afetadas = 1, 'R1: restaurar excluído deveria afetar exatamente 1 linha';

  assert (select excluido_em from public.clientes where id = v_cliente_arquivado) is null
     and (select excluido_por from public.clientes where id = v_cliente_arquivado) is null
     and (select motivo_exclusao from public.clientes where id = v_cliente_arquivado) is null,
    'R1: os 3 campos de exclusão deveriam voltar a null';
  assert (select deleted_at from public.clientes where id = v_cliente_arquivado) is not null,
    'R1: deleted_at deveria continuar preenchido — volta pra ARQUIVADO, não pra ativo';
  raise notice 'ok  R1  restaurar excluído volta pra arquivado (deleted_at preservado)';

  -- =========================================================================
  -- R2: restaurar-de-exclusão num cliente que NÃO está excluído não afeta nada.
  -- =========================================================================
  update public.clientes
     set excluido_em = null, excluido_por = null, motivo_exclusao = null
   where id = v_cliente_ativo
     and excluido_em is not null;
  get diagnostics v_linhas_afetadas = row_count;
  assert v_linhas_afetadas = 0, 'R2: restaurar-de-exclusão não deveria afetar cliente que nunca foi excluído';
  raise notice 'ok  R2  restaurar-de-exclusão ignora cliente que não está excluído';

  raise notice 'TODOS OS TESTES DE EXCLUSÃO DE CLIENTE PASSARAM (M1, C1, E1-E3, H1, D1, R1-R2)';
end $$;

select 'OK — TODOS OS TESTES DE EXCLUSÃO DE CLIENTE PASSARAM' as resultado;

rollback;
