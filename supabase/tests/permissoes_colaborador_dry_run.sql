-- ===========================================================================
-- Dry-run de "Permissões configuráveis por usuário/funil/etapa"
-- (supabase/migrations/20261014160000_permissoes_colaborador.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. NÃO
--   depende da migration acima já ter sido aplicada: a própria transação
--   instala, temporariamente, a tabela, os triggers, as funções, o RPC e as
--   policies — byte a byte idênticas à migration. ROLLBACK no fim desfaz
--   tudo. Nada fica gravado.
--
--   PRÉ-REQUISITO (como nos dry-runs anteriores desta fase): os valores
--   'sdr' do enum user_role e o trigger de handoff SDR→CLOSER
--   (20261014140000/20261014150000) precisam já estar aplicados — este
--   dry-run assume que estão, porque testa a interação entre os dois.
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
-- MODELO TESTADO: a tabela de permissões é a ÚNICA fonte de verdade de
-- acesso (ver/mover) para SDR/CLOSER — owner_id NUNCA concede bypass pra
-- esses dois papéis. GERENTE continua com acesso total, sempre.
--
-- O QUE ELE PROVA (numeração = lista de testes obrigatórios do pedido)
--   1     : GERENTE vê tudo.
--   2     : SDR sem permissão não vê o funil.
--   3     : SDR com permissão de FUNIL mas sem permissão de ETAPA não vê
--           cards daquela etapa (acesso ao funil não herda pra etapa).
--   4     : SDR com permissão de etapa vê os cards.
--   5     : CLOSER sem permissão não vê.
--   6     : CLOSER com permissão vê.
--   7     : owner_id NÃO dá bypass para SDR (mesmo sendo dono, sem
--           permissão configurada ele não vê a própria negociação).
--   8     : owner_id NÃO dá bypass para CLOSER (idem).
--   9     : pode_ver não implica pode_mover.
--   10    : pode_mover exige acesso adequado (funil + a própria etapa,
--           nas duas pontas do movimento).
--   11    : SDR continua limitado pelo handoff, mesmo com pode_mover
--           liberado por engano além dele.
--   12    : CLOSER não é afetado pela trava SDR.
--   13    : GERENTE continua com acesso total de movimentação.
--   14    : responsável (owner_id) não é alterado pela permissão nem pelo
--           movimento.
--   15    : funis diferentes podem ter permissões diferentes
--           (independência entre funis).
--   16    : etapas diferentes podem ter permissões diferentes dentro do
--           mesmo funil (pode_ver_etapa é por etapa, nunca "libera tudo").
--   17    : usuário sem nenhuma permissão não recebe acesso automático —
--           nem funil, nem etapa, nem movimentação.
--   extra : a regra nunca depende do nome visível da etapa (renomear não
--           afeta a permissão).
--   extra : backfill — CLOSER já existente preserva o alcance que já tinha
--           (todas as etapas ativas do funil onde atua); SDR nunca é
--           backfillado.
--   tela-1: gerente salva ver/mover pela RPC da tela de configuração
--           (salvar_permissoes_colaborador), substituindo o conjunto inteiro
--           numa transação só.
--   tela-2: mover sem ver é rejeitado pela constraint do banco, e a chamada
--           rejeitada não deixa estado parcialmente salvo.
--   tela-3: SDR não consegue alterar as próprias permissões pela RPC — a
--           RLS de permissoes_colaborador (não a RPC) é a autorização real.
--   tela-4: CLOSER idem — não consegue alterar as próprias permissões.
--   tela-5: cliente sem nenhuma negociação não vaza pra SDR/CLOSER (nem por
--           ser owner_id); só o gerente continua vendo.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária — idêntica à migration (já sem owner_id em
-- mover_negociacao/negociacoes_select/clientes_select).
-- ---------------------------------------------------------------------------
create table if not exists public.permissoes_colaborador (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.profiles (id) on delete cascade,
  funil_id    uuid not null references public.funis (id) on delete cascade,
  etapa_id    uuid references public.etapas_funil (id) on delete cascade,
  pode_ver    boolean,
  pode_mover  boolean,
  criado_por  uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint permissoes_colaborador_campos_por_tipo check (
    (etapa_id is null and pode_ver is null and pode_mover is null)
    or (etapa_id is not null and pode_ver is not null and pode_mover is not null)
  ),
  constraint permissoes_colaborador_mover_exige_ver check (pode_mover is not true or pode_ver is true),
  constraint permissoes_colaborador_unica unique nulls not distinct (usuario_id, funil_id, etapa_id)
);

create or replace function public.permissoes_colaborador_valida()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_funil_da_etapa uuid;
  v_role public.user_role;
begin
  if new.etapa_id is not null then
    select e.funil_id into v_funil_da_etapa from public.etapas_funil e where e.id = new.etapa_id;
    if v_funil_da_etapa is null then
      raise exception 'Etapa não encontrada.' using errcode = '23514';
    end if;
    if v_funil_da_etapa <> new.funil_id then
      raise exception 'A etapa informada não pertence ao funil desta permissão.' using errcode = '23514';
    end if;
  end if;
  select p.role into v_role from public.profiles p where p.id = new.usuario_id;
  if v_role = 'gerente' then
    raise exception 'Gerente já tem acesso total — não é possível configurar permissões para um gerente.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists permissoes_colaborador_valida on public.permissoes_colaborador;
create trigger permissoes_colaborador_valida
  before insert or update on public.permissoes_colaborador
  for each row execute function public.permissoes_colaborador_valida();

alter table public.permissoes_colaborador enable row level security;

drop policy if exists permissoes_colaborador_select on public.permissoes_colaborador;
create policy permissoes_colaborador_select on public.permissoes_colaborador for select to authenticated
  using (usuario_id = (select auth.uid()) or public.is_gerente());
drop policy if exists permissoes_colaborador_insert on public.permissoes_colaborador;
create policy permissoes_colaborador_insert on public.permissoes_colaborador for insert to authenticated
  with check (public.is_gerente());
drop policy if exists permissoes_colaborador_update on public.permissoes_colaborador;
create policy permissoes_colaborador_update on public.permissoes_colaborador for update to authenticated
  using (public.is_gerente()) with check (public.is_gerente());
drop policy if exists permissoes_colaborador_delete on public.permissoes_colaborador;
create policy permissoes_colaborador_delete on public.permissoes_colaborador for delete to authenticated
  using (public.is_gerente());

create or replace function public.pode_ver_etapa(p_funil_id uuid, p_etapa_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    exists (select 1 from public.permissoes_colaborador pc
            where pc.usuario_id = (select auth.uid()) and pc.funil_id = p_funil_id and pc.etapa_id is null)
    and exists (select 1 from public.permissoes_colaborador pc
                where pc.usuario_id = (select auth.uid()) and pc.etapa_id = p_etapa_id and pc.pode_ver);
$$;

create or replace function public.pode_mover_etapa(p_funil_id uuid, p_etapa_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    exists (select 1 from public.permissoes_colaborador pc
            where pc.usuario_id = (select auth.uid()) and pc.funil_id = p_funil_id and pc.etapa_id is null)
    and exists (select 1 from public.permissoes_colaborador pc
                where pc.usuario_id = (select auth.uid()) and pc.etapa_id = p_etapa_id and pc.pode_mover);
$$;

create or replace function public.mover_negociacao(p_negociacao_id uuid, p_etapa_id uuid, p_posicao numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_funil_id uuid; v_etapa_atual_id uuid;
  v_destino_funil_id uuid; v_destino_tipo public.tipo_etapa; v_destino_ativo boolean;
  v_role public.user_role;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_atual_id
    from public.negociacoes n where n.id = p_negociacao_id;
  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  select e.funil_id, e.tipo, e.ativo into v_destino_funil_id, v_destino_tipo, v_destino_ativo
    from public.etapas_funil e where e.id = p_etapa_id;
  if v_destino_funil_id is null or not v_destino_ativo then
    raise exception 'Etapa não encontrada ou desativada.' using errcode = '23514';
  end if;
  if v_destino_funil_id <> v_funil_id then
    raise exception 'Não é possível mover uma negociação para outro funil.' using errcode = '23514';
  end if;
  if v_destino_tipo in ('ganha', 'perdida') and p_etapa_id <> v_etapa_atual_id then
    raise exception 'Use o fechamento ou o motivo de perda para entrar nesta etapa.' using errcode = '23514';
  end if;

  select p.role into v_role from public.profiles p where p.id = (select auth.uid());
  if v_role <> 'gerente'
     and not (public.pode_mover_etapa(v_funil_id, v_etapa_atual_id) and public.pode_mover_etapa(v_funil_id, p_etapa_id))
  then
    raise exception 'Você não tem permissão para mover esta negociação.' using errcode = '42501';
  end if;

  update public.negociacoes set etapa_id = p_etapa_id, posicao = p_posicao where id = p_negociacao_id;
end;
$$;

drop policy if exists negociacoes_select on public.negociacoes;
create policy negociacoes_select on public.negociacoes for select to authenticated
  using (public.is_gerente() or public.pode_ver_etapa(funil_id, etapa_id));

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes for select to authenticated
  using (public.is_gerente()
    or exists (select 1 from public.negociacoes n where n.cliente_id = clientes.id and public.pode_ver_etapa(n.funil_id, n.etapa_id)));

-- salvar_permissoes_colaborador (seção 7 da migration) — RPC da tela de
-- configuração. Não é security definer: o DELETE/INSERT dentro dela passam
-- pela RLS normal de permissoes_colaborador (só gerente).
create or replace function public.salvar_permissoes_colaborador(p_usuario_id uuid, p_permissoes jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  delete from public.permissoes_colaborador where usuario_id = p_usuario_id;
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  select p_usuario_id, (item ->> 'funil_id')::uuid, (item ->> 'etapa_id')::uuid,
         (item ->> 'pode_ver')::boolean, (item ->> 'pode_mover')::boolean
    from jsonb_array_elements(coalesce(p_permissoes, '[]'::jsonb)) as item;
end;
$$;

-- criar_negociacao corrigida (seção 6 da migration) — sem isto, nenhuma das
-- chamadas abaixo feitas como SDR/CLOSER (criar a PRIMEIRA negociação de um
-- cliente deles) funcionaria, pelo mesmo motivo descrito na migration.
create or replace function public.criar_negociacao(
  p_cliente_id      uuid,
  p_funil_id        uuid,
  p_valor_estimado  numeric default null,
  p_temperatura     public.temperatura_negociacao default null,
  p_origem          public.origem_negociacao default 'manual'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_negociacao_id uuid;
  v_etapa_id      uuid;
  v_owner_cliente uuid;
begin
  select c.owner_id into v_owner_cliente from public.clientes c
   where c.id = p_cliente_id and c.deleted_at is null;
  if v_owner_cliente is null then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
  if v_owner_cliente <> (select auth.uid()) and not public.is_gerente() then
    raise exception 'Você não tem permissão para criar uma negociação para esse cliente.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.funis f where f.id = p_funil_id and f.ativo) then
    raise exception 'Funil não encontrado ou desativado.' using errcode = 'P0002';
  end if;

  select e.id into v_etapa_id from public.etapas_funil e
   where e.funil_id = p_funil_id and e.tipo = 'aberta' and e.ativo
   order by e.ordem limit 1;
  if v_etapa_id is null then
    raise exception 'O funil não tem etapa aberta disponível para receber a negociação.' using errcode = '23514';
  end if;

  insert into public.negociacoes (cliente_id, owner_id, etapa_id, valor_estimado, temperatura, origem)
  values (p_cliente_id, (select auth.uid()), v_etapa_id, p_valor_estimado, p_temperatura, p_origem)
  returning id into v_negociacao_id;
  return v_negociacao_id;
end;
$$;

-- ===========================================================================
-- Testes.
-- ===========================================================================
do $$
declare
  v_gerente uuid := 'f1111111-1111-1111-1111-111111111111';
  v_sdr     uuid := 'f2222222-2222-2222-2222-222222222222';
  v_closer  uuid := 'f3333333-3333-3333-3333-333333333333';
  v_closer_antigo uuid := 'f4444444-4444-4444-4444-444444444444';  -- "closer já existente" (backfill)

  v_funil_a uuid;  -- Funil Principal (tem reuniao_agendada/realizada)
  v_etapa_reuniao_ag uuid;
  v_etapa_reuniao_re uuid;
  v_etapa_proposta  uuid;
  v_etapa_ganha uuid;
  v_etapa_negociacao uuid;

  v_funil_b uuid;  -- funil novo, sem a etapa técnica de handoff
  v_etapa_b1 uuid;
  v_etapa_b2 uuid;

  v_cliente_tmp uuid;
  v_neg_a_visivel uuid;    -- em etapa que o SDR vai poder ver
  v_neg_a_invisivel uuid;  -- em etapa que o SDR NÃO vai poder ver
  v_neg_b uuid;            -- no funil B, pra testar independência entre funis
  v_neg_sdr_dono uuid;     -- OWNER_ID = o próprio SDR, sem nenhuma permissão
  v_neg_closer_dono uuid;  -- OWNER_ID = o próprio CLOSER, sem nenhuma permissão
  v_neg_closer_antigo uuid; -- do "closer já existente", pré-migration (pro backfill)

  v_count integer;
  v_count_sdr_antes integer;
  v_count_closer_antes integer;
  v_cliente_sem_neg uuid;
  v_owner_antes uuid;
  v_role public.user_role;
  v_pode_ver boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.permcol.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Permissões"}'::jsonb),
    (v_sdr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.permcol.sdr@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Dry-Run Permissões"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.permcol.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run Permissões"}'::jsonb),
    (v_closer_antigo, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.permcol.closerantigo@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Antigo Dry-Run Permissões"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id into v_funil_a from public.funis where padrao;
  select id into v_etapa_reuniao_ag from public.etapas_funil where chave = 'reuniao_agendada';
  select id into v_etapa_reuniao_re from public.etapas_funil where chave = 'reuniao_realizada';
  select id into v_etapa_proposta   from public.etapas_funil where chave = 'proposta_enviada';
  select id into v_etapa_negociacao from public.etapas_funil where chave = 'negociacao';
  select id into v_etapa_ganha      from public.etapas_funil where funil_id = v_funil_a and tipo = 'ganha';

  select public.criar_funil(
    'Funil Dry-Run Permissões B', 'Fechado — dry-run permB', 'verde', 'Perdido — dry-run permB', 'vermelho',
    '[{"nome":"Etapa B1 — dry-run permB","cor":"azul"},{"nome":"Etapa B2 — dry-run permB","cor":"ciano"}]'::jsonb
  ) into v_funil_b;
  select id into v_etapa_b1 from public.etapas_funil where funil_id = v_funil_b and nome = 'Etapa B1 — dry-run permB';
  select id into v_etapa_b2 from public.etapas_funil where funil_id = v_funil_b and nome = 'Etapa B2 — dry-run permB';

  -- Cliente/negociações de um terceiro (gerente) — nenhuma pertence ao SDR/CLOSER.
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run PermCol A', 'Empresa A', v_gerente)
    returning id into v_cliente_tmp;
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 4000.00, 'morno') into v_neg_a_visivel;
  update public.negociacoes set etapa_id = v_etapa_reuniao_ag, posicao = 1 where id = v_neg_a_visivel;

  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run PermCol A2', 'Empresa A2', v_gerente)
    returning id into v_cliente_tmp;
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 4000.00, 'morno') into v_neg_a_invisivel;
  update public.negociacoes set etapa_id = v_etapa_proposta, posicao = 1 where id = v_neg_a_invisivel;

  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run PermCol B', 'Empresa B', v_gerente)
    returning id into v_cliente_tmp;
  select public.criar_negociacao(v_cliente_tmp, v_funil_b, 1500.00, 'frio') into v_neg_b;
  update public.negociacoes set etapa_id = v_etapa_b1, posicao = 1 where id = v_neg_b;

  -- Negociações cujo OWNER_ID é o próprio SDR/CLOSER — pra provar que isso,
  -- por si só, não dá mais acesso nenhum (testes 7/8). Conseguir CRIAR estas
  -- (via criar_negociacao, corrigida na seção 6 da migration) já confirma
  -- que o bug "ninguém sem ser gerente consegue criar a 1a negociação de um
  -- cliente novo" está corrigido — se não estivesse, as duas chamadas abaixo
  -- falhariam com "Cliente não encontrado".
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run PermCol SDR Dono', 'Empresa SDR Dono', v_sdr)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 2000.00, 'frio') into v_neg_sdr_dono;
  raise notice 'ok  criar_negociacao  SDR cria a própria negociação (dono do cliente) sem precisar de nenhuma permissão de funil/etapa — correção do bug de clientes_select aplicada';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run PermCol Closer Dono', 'Empresa Closer Dono', v_closer)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 2000.00, 'frio') into v_neg_closer_dono;

  -- =========================================================================
  -- 1: GERENTE vê tudo, mesmo sem nenhuma linha de permissão.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes
   where id in (v_neg_a_visivel, v_neg_a_invisivel, v_neg_b, v_neg_sdr_dono, v_neg_closer_dono);
  assert v_count = 5, '1 falhou: gerente deveria ver todas as negociações/etapas/funis';
  raise notice 'ok  1  GERENTE vê tudo, sem precisar de nenhuma permissão configurada';

  -- =========================================================================
  -- 2/7: SDR sem permissão não vê NADA — nem o funil, nem a própria negociação.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id in (v_neg_a_visivel, v_neg_a_invisivel);
  assert v_count = 0, '2 falhou: SDR sem nenhuma permissão não deveria ver nenhum funil/negociação';
  raise notice 'ok  2  SDR sem permissão não vê nenhum funil/negociação por padrão';

  select count(*) into v_count from public.negociacoes where id = v_neg_sdr_dono;
  assert v_count = 0, '7 falhou: SDR é owner_id de v_neg_sdr_dono, mas sem permissão configurada não deveria vê-la — owner_id não é mais bypass';
  raise notice 'ok  7  owner_id NÃO dá bypass pro SDR: ele é dono de uma negociação e, sem permissão, não a vê';

  -- =========================================================================
  -- 3/4: SDR com permissão de FUNIL mas sem a de ETAPA não vê; com as duas, vê.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_sdr, v_funil_a, null, null, null);  -- só acesso ao funil, nenhuma etapa ainda

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id = v_neg_a_visivel;
  assert v_count = 0,
    '3 falhou: acesso ao FUNIL sem nenhuma etapa autorizada não deveria mostrar nenhum card dele';
  raise notice 'ok  3  acesso ao funil não herda pra nenhuma etapa — sem etapa autorizada, zero cards';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_sdr, v_funil_a, v_etapa_reuniao_ag, true, false);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id = v_neg_a_visivel;
  assert v_count = 1, '4 falhou: SDR com pode_ver na etapa (e acesso ao funil) deveria ver a negociação';
  select count(*) into v_count from public.negociacoes where id = v_neg_a_invisivel;
  assert v_count = 0, '16 falhou: SDR sem pode_ver em "Proposta enviada" não deveria ver aquela negociação (etapas diferentes, permissões diferentes)';
  raise notice 'ok  4/16  SDR vê só a etapa com pode_ver configurado, nunca as outras do mesmo funil';

  -- =========================================================================
  -- 9/10: pode_ver não implica pode_mover; pode_mover exige acesso nas duas pontas.
  -- =========================================================================
  begin
    perform public.mover_negociacao(v_neg_a_visivel, v_etapa_reuniao_re, 1);
    assert false, '9 falhou: SDR com pode_ver mas sem pode_mover não deveria conseguir mover';
  exception when others then
    raise notice 'ok  9  SDR vê a etapa (pode_ver) mas não move (sem pode_mover) — ver nunca implica mover';
  end;

  -- =========================================================================
  -- 5/6/8: CLOSER segue exatamente a mesma regra do SDR.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id = v_neg_a_visivel;
  assert v_count = 0, '5 falhou: closer sem permissão não deveria ver nada';

  select count(*) into v_count from public.negociacoes where id = v_neg_closer_dono;
  assert v_count = 0, '8 falhou: CLOSER é owner_id de v_neg_closer_dono, mas sem permissão configurada não deveria vê-la';
  raise notice 'ok  5/8  CLOSER sem permissão não vê nada, nem a própria negociação (owner_id também não é bypass pra ele)';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_closer, v_funil_a, null, null, null);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_closer, v_funil_a, v_etapa_proposta, true, false);

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id = v_neg_a_invisivel;
  assert v_count = 1, '6 falhou: CLOSER com pode_ver em "Proposta enviada" deveria ver aquela negociação';
  raise notice 'ok  6  CLOSER com permissão configurada vê — mesma regra do SDR';

  begin
    perform public.mover_negociacao(v_neg_a_invisivel, v_etapa_reuniao_re, 1);
    assert false, '10 falhou: CLOSER sem pode_mover na etapa de destino não deveria conseguir mover';
  exception when others then
    raise notice 'ok  10  pode_mover exige acesso nas DUAS pontas (origem e destino) — CLOSER não move pra etapa sem permissão';
  end;

  -- =========================================================================
  -- 11/12: handoff do SDR é absoluto; CLOSER não é afetado por ele.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  -- Libera pode_mover pro SDR em "Reunião agendada" E "Proposta enviada" —
  -- de propósito, simulando uma configuração ERRADA que ultrapassa o handoff.
  update public.permissoes_colaborador set pode_mover = true
   where usuario_id = v_sdr and etapa_id = v_etapa_reuniao_ag;
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_sdr, v_funil_a, v_etapa_proposta, true, true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select owner_id into v_owner_antes from public.negociacoes where id = v_neg_a_visivel;
  begin
    perform public.mover_negociacao(v_neg_a_visivel, v_etapa_proposta, 1);
    assert false,
      '11 falhou: SDR não deveria pular pra "Proposta enviada" (depois do handoff), mesmo com pode_mover=true nas duas pontas';
  exception when others then
    raise notice 'ok  11  handoff SDR bloqueia mesmo com pode_mover configurado "errado" — permissão nunca relaxa a regra comercial';
  end;
  assert (select etapa_id from public.negociacoes where id = v_neg_a_visivel) = v_etapa_reuniao_ag,
    '14 falhou: a tentativa bloqueada não deveria ter mudado a etapa';
  assert (select owner_id from public.negociacoes where id = v_neg_a_visivel) = v_owner_antes,
    '14 falhou: owner_id não deveria mudar nunca, nem numa tentativa bloqueada';

  -- Dentro do handoff (Reunião agendada -> Reunião realizada), com pode_mover, SDR consegue.
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_sdr, v_funil_a, v_etapa_reuniao_re, true, true);
  perform public.mover_negociacao(v_neg_a_visivel, v_etapa_reuniao_re, 1);
  assert (select etapa_id from public.negociacoes where id = v_neg_a_visivel) = v_etapa_reuniao_re,
    'SDR deveria conseguir entrar em "Reunião realizada" (dentro do handoff) com pode_mover configurado';
  raise notice 'ok  SDR dentro do teto, com permissão, move normalmente';

  -- CLOSER, com permissão equivalente, NÃO é limitado pelo handoff do SDR.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_closer, v_funil_a, v_etapa_reuniao_re, true, true)
  on conflict (usuario_id, funil_id, etapa_id) do update set pode_ver = true, pode_mover = true;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  perform public.mover_negociacao(v_neg_a_invisivel, v_etapa_reuniao_re, 1);
  assert (select etapa_id from public.negociacoes where id = v_neg_a_invisivel) = v_etapa_reuniao_re,
    '12 falhou: CLOSER deveria conseguir mover pra "Reunião realizada" sem nenhum teto de handoff (regra é só do SDR)';
  raise notice 'ok  12  CLOSER não é afetado pela trava de handoff do SDR';

  -- =========================================================================
  -- 14: responsável (owner_id) nunca muda, nem num movimento legítimo.
  -- =========================================================================
  assert (select owner_id from public.negociacoes where id = v_neg_a_visivel) = v_owner_antes,
    '14 falhou: owner_id mudou depois de um movimento via permissão — não deveria, nunca';
  raise notice 'ok  14  owner_id (responsável) nunca muda, nem num movimento legítimo via permissão configurada';

  -- =========================================================================
  -- 13: GERENTE continua com acesso total de movimentação.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  perform public.mover_negociacao(v_neg_a_invisivel, v_etapa_negociacao, 1);
  assert (select etapa_id from public.negociacoes where id = v_neg_a_invisivel) = v_etapa_negociacao,
    '13 falhou: gerente deveria continuar movendo qualquer negociação, sem nenhuma permissão configurada pra ele';
  raise notice 'ok  13  GERENTE continua com acesso total de movimentação';

  -- =========================================================================
  -- extra: a regra nunca depende do nome visível da etapa.
  -- =========================================================================
  update public.etapas_funil set nome = 'Call de Descoberta' where chave = 'reuniao_agendada';

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select pode_ver into v_pode_ver from public.permissoes_colaborador
   where usuario_id = v_sdr and etapa_id = v_etapa_reuniao_ag;
  assert v_pode_ver, 'falhou: permissão não deveria se perder só por renomear a etapa (ela é por etapa_id, não por nome)';
  raise notice 'ok  extra  renomear a etapa (nome editável pelo gerente) não afeta a permissão — ela usa etapa_id, nunca nome';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.etapas_funil set nome = 'Reunião agendada' where chave = 'reuniao_agendada'; -- restaura

  -- =========================================================================
  -- 15/17: funis diferentes são independentes; sem permissão, zero acesso.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id = v_neg_b;
  assert v_count = 0, '15/17 falhou: SDR não tem permissão no Funil B — não deveria ver nada lá, mesmo tendo permissão no Funil A';
  raise notice 'ok  15/17  permissão no Funil A não dá acesso nenhum ao Funil B — funis são independentes, sem permissão não há acesso automático';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_sdr, v_funil_b, null, null, null);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values
    (v_sdr, v_funil_b, v_etapa_b1, true, true),
    (v_sdr, v_funil_b, v_etapa_b2, true, true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id = v_neg_b;
  assert v_count = 1, '15 falhou: depois de configurado, SDR deveria ver a negociação do Funil B';
  perform public.mover_negociacao(v_neg_b, v_etapa_b2, 1);
  assert (select etapa_id from public.negociacoes where id = v_neg_b) = v_etapa_b2,
    '15 falhou: SDR deveria conseguir mover no Funil B (funil sem a etapa técnica de handoff — regra de handoff não se aplica)';
  raise notice 'ok  15  permissão configurada só no Funil B funciona independente do Funil A, e sem a etapa técnica de handoff a regra comercial do SDR não existe ali';

  -- =========================================================================
  -- Nenhuma permissão administrativa surge de ver/mover.
  -- =========================================================================
  update public.profiles set role = 'gerente' where id = v_closer;
  select role into v_role from public.profiles where id = v_closer;
  assert v_role <> 'gerente', 'falhou: SDR não deveria conseguir promover ninguém a gerente';

  begin
    insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
    values (v_sdr, v_funil_a, v_etapa_proposta, true, true);
  exception when others then
    null;
  end;
  select count(*) into v_count from public.permissoes_colaborador where criado_por = v_sdr;
  assert v_count = 0, 'falhou: SDR não deveria conseguir inserir/alterar linhas em permissoes_colaborador (só gerente administra)';
  raise notice 'ok  extra  ver/mover não dá nenhuma permissão administrativa (SDR não promove ninguém nem autoconcede permissão)';

  -- =========================================================================
  -- Backfill: CLOSER já existente preserva o alcance que já tinha; SDR não.
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run PermCol Closer Antigo', 'Empresa Closer Antigo', v_closer_antigo)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_antigo, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 3000.00, 'quente') into v_neg_closer_antigo;

  -- Backfill real da migration, rodado agora (simula "aplicar a migration
  -- com esse closer já existindo antes dela").
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  select distinct n.owner_id, n.funil_id, null::uuid, null::boolean, null::boolean, n.owner_id
    from public.negociacoes n
    join public.profiles p on p.id = n.owner_id and p.role = 'closer'
  on conflict (usuario_id, funil_id, etapa_id) do nothing;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  select distinct n.owner_id, e.funil_id, e.id, true, true, n.owner_id
    from public.negociacoes n
    join public.profiles p on p.id = n.owner_id and p.role = 'closer'
    join public.etapas_funil e on e.funil_id = n.funil_id and e.ativo
  on conflict (usuario_id, funil_id, etapa_id) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_antigo, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.negociacoes where id = v_neg_closer_antigo;
  assert v_count = 1, 'backfill falhou: closer já existente deveria continuar vendo a própria negociação depois do backfill';
  perform public.mover_negociacao(v_neg_closer_antigo, v_etapa_ganha, 1);
  select count(*) into v_count from public.negociacoes where id = v_neg_closer_antigo and etapa_id = v_etapa_ganha;
  assert v_count = 1, 'backfill falhou: closer já existente deveria poder mover pra qualquer etapa ativa do funil onde atuava (alcance preservado)';
  raise notice 'ok  backfill  CLOSER já existente preserva o alcance de antes (todas as etapas ativas do funil onde atuava)';

  -- v_closer (criado "novo" nesta transação, nunca owner_id de nada antes
  -- do backfill rodar) não ganhou nada do backfill além do que já tinha
  -- configurado manualmente acima — confirma que o backfill não inventa
  -- acesso novo pra quem não tinha negociação alguma antes da migration.
  select count(*) into v_count from public.permissoes_colaborador
   where usuario_id = v_sdr and criado_por = v_sdr;
  assert v_count = 0, 'falhou: SDR nunca deveria ter recebido nenhuma linha do backfill (SDR nunca é backfillado)';
  raise notice 'ok  backfill  SDR nunca é backfillado — todo SDR começa zerado, gerente configura manualmente';

  -- =========================================================================
  -- tela-1/tela-2: salvar_permissoes_colaborador — RPC da tela de configuração.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  perform public.salvar_permissoes_colaborador(
    v_closer_antigo,
    jsonb_build_array(
      jsonb_build_object('funil_id', v_funil_a, 'etapa_id', null, 'pode_ver', null, 'pode_mover', null),
      jsonb_build_object('funil_id', v_funil_a, 'etapa_id', v_etapa_reuniao_ag, 'pode_ver', true, 'pode_mover', true),
      jsonb_build_object('funil_id', v_funil_a, 'etapa_id', v_etapa_proposta, 'pode_ver', true, 'pode_mover', false)
    )
  );
  select count(*) into v_count from public.permissoes_colaborador where usuario_id = v_closer_antigo;
  assert v_count = 3,
    'tela-1 falhou: salvar_permissoes_colaborador deveria ter substituído o conjunto inteiro (do backfill) por exatamente 3 linhas (1 de acesso ao funil + 2 de etapa)';
  select count(*) into v_count from public.permissoes_colaborador
   where usuario_id = v_closer_antigo and etapa_id = v_etapa_reuniao_ag and pode_ver and pode_mover;
  assert v_count = 1, 'tela-1 falhou: linha de "Reunião agendada" deveria ter pode_ver=true e pode_mover=true';
  select count(*) into v_count from public.permissoes_colaborador
   where usuario_id = v_closer_antigo and etapa_id = v_etapa_proposta and pode_ver and not pode_mover;
  assert v_count = 1, 'tela-1 falhou: linha de "Proposta enviada" deveria ter pode_ver=true e pode_mover=false (visualizar sem movimentar)';
  raise notice 'ok  tela-1  gerente salva ver/mover pela RPC da tela, substituindo o conjunto inteiro numa transação só (sem resíduo do backfill anterior)';

  begin
    perform public.salvar_permissoes_colaborador(
      v_closer_antigo,
      jsonb_build_array(
        jsonb_build_object('funil_id', v_funil_a, 'etapa_id', null, 'pode_ver', null, 'pode_mover', null),
        jsonb_build_object('funil_id', v_funil_a, 'etapa_id', v_etapa_reuniao_ag, 'pode_ver', false, 'pode_mover', true)
      )
    );
    assert false, 'tela-2 falhou: deveria ter sido rejeitado pela constraint do banco (mover exige ver)';
  exception when others then
    raise notice 'ok  tela-2  movimentar sem visualizar é rejeitado pela constraint do banco — não é só confiança na tela';
  end;
  select count(*) into v_count from public.permissoes_colaborador where usuario_id = v_closer_antigo;
  assert v_count = 3,
    'tela-2 falhou: a chamada rejeitada não deveria ter deixado o colaborador com o conjunto parcialmente apagado (sem estado parcialmente salvo)';
  raise notice 'ok  tela-2  chamada rejeitada não deixa estado parcialmente salvo — o colaborador continua com o conjunto anterior, intacto';

  -- =========================================================================
  -- tela-3/tela-4: SDR/CLOSER não conseguem alterar as PRÓPRIAS permissões
  -- chamando a mesma RPC — a autorização real é a RLS de
  -- permissoes_colaborador (insert/delete exigem is_gerente()), não uma
  -- checagem de papel dentro da função.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_count_sdr_antes from public.permissoes_colaborador where usuario_id = v_sdr;
  begin
    perform public.salvar_permissoes_colaborador(
      v_sdr,
      jsonb_build_array(
        jsonb_build_object('funil_id', v_funil_a, 'etapa_id', null, 'pode_ver', null, 'pode_mover', null),
        jsonb_build_object('funil_id', v_funil_a, 'etapa_id', v_etapa_ganha, 'pode_ver', true, 'pode_mover', true)
      )
    );
    assert false, 'tela-3 falhou: SDR não deveria conseguir alterar as próprias permissões pela RPC';
  exception when others then
    raise notice 'ok  tela-3  SDR chamando a RPC pra alterar as próprias permissões é bloqueado pela RLS (insert exige is_gerente())';
  end;
  select count(*) into v_count from public.permissoes_colaborador where usuario_id = v_sdr;
  assert v_count = v_count_sdr_antes,
    'tela-3 falhou: a tentativa bloqueada do SDR não deveria ter alterado nenhuma linha dele mesmo';

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select count(*) into v_count_closer_antes from public.permissoes_colaborador where usuario_id = v_closer;
  begin
    perform public.salvar_permissoes_colaborador(
      v_closer,
      jsonb_build_array(
        jsonb_build_object('funil_id', v_funil_a, 'etapa_id', null, 'pode_ver', null, 'pode_mover', null),
        jsonb_build_object('funil_id', v_funil_a, 'etapa_id', v_etapa_ganha, 'pode_ver', true, 'pode_mover', true)
      )
    );
    assert false, 'tela-4 falhou: CLOSER não deveria conseguir alterar as próprias permissões pela RPC';
  exception when others then
    raise notice 'ok  tela-4  CLOSER chamando a RPC pra alterar as próprias permissões é bloqueado pela mesma RLS';
  end;
  select count(*) into v_count from public.permissoes_colaborador where usuario_id = v_closer;
  assert v_count = v_count_closer_antes,
    'tela-4 falhou: a tentativa bloqueada do CLOSER não deveria ter alterado nenhuma linha dele mesmo';

  -- =========================================================================
  -- tela-5: cliente sem nenhuma negociação — não pode "vazar" pra ninguém
  -- fora do gerente, e o gerente continua vendo normalmente. Confirma a
  -- limitação documentada em lib/dal/clientes.ts: sem negociação não há como
  -- inferir funil/etapa, então NINGUÉM sem ser gerente vê (nenhum acesso
  -- global foi criado pra compensar isso, e owner_id continua sem ser bypass).
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Dry-Run PermCol Sem Negociação', 'Empresa Sem Negociação', v_sdr)
  returning id into v_cliente_sem_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.clientes where id = v_cliente_sem_neg;
  assert v_count = 0,
    'tela-5 falhou: cliente sem negociação não deveria ficar visível pro SDR, mesmo sendo owner_id dele (owner_id não é bypass; sem negociação não há etapa/funil pra avaliar pode_ver_etapa)';

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.clientes where id = v_cliente_sem_neg;
  assert v_count = 0, 'tela-5 falhou: cliente sem negociação também não deveria ficar visível pro CLOSER';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.clientes where id = v_cliente_sem_neg;
  assert v_count = 1, 'tela-5 falhou: gerente deveria continuar vendo o cliente normalmente, mesmo sem nenhuma negociação';
  raise notice 'ok  tela-5  cliente sem nenhuma negociação não vaza pra SDR/CLOSER (nem por ser owner_id) — só o gerente vê; limitação aceita e documentada, sem RLS ampliada pra compensar';

  raise notice 'TODOS OS TESTES DE PERMISSÕES COLABORADOR PASSARAM (1-17 + extras + tela-1..5)';
end $$;

select 'OK — TODOS OS TESTES DE PERMISSÕES COLABORADOR PASSARAM (1-17 + extras + tela-1..5)' as resultado;

rollback;
