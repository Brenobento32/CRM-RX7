-- ===========================================================================
-- T4–T7 — Isolamento por empresa (depende de T1, T2 e T3).
--
-- EMPRESA DA REQUISIÇÃO
--   `tenant_atual()` lê o header `x-rx7-tenant` (slug) que o app manda em cada
--   requisição ao PostgREST (`request.headers`) e só devolve o id se o
--   `auth.uid()` tiver vínculo ATIVO nessa empresa. Não há linha de sessão
--   gravada: cada requisição (cada aba) carrega a própria empresa e o banco
--   revalida o vínculo toda vez. Sem header, header inválido ou empresa alheia
--   → null → nenhuma linha visível e nenhuma gravação.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Helpers: tenant_atual, tenant_exigir, papel_comercial,
--      usuario_na_empresa_atual, pode_gerir_usuario.
--   2. Papéis por empresa: is_gerente, pode_ver_etapa, pode_mover_etapa,
--      cliente_owner, negociacao_owner, nomes_de_usuarios passam a valer só
--      na empresa da requisição (as policies PERMISSIVE existentes ficam
--      iguais e passam a usar o papel da empresa).
--   3. Integridade: UNIQUE (tenant_id, id) nos pais e FK composta
--      (tenant_id, coluna) em cada referência entre tabelas comerciais
--      (NOT VALID + VALIDATE; as FKs simples atuais continuam).
--   4. Índices únicos por empresa (criados ANTES de remover os globais).
--   5. Usuários referenciados (owner, responsável, autor...) precisam ter
--      vínculo ativo na empresa do registro.
--   6. Empresa somente leitura (arquivo/suspensa/cancelada) não recebe
--      gravação de nenhuma requisição da API, nem da service_role.
--   7. Policies RESTRICTIVE nas 25 tabelas e em profiles.
--
-- Não altera dados. Não muda nenhuma linha do legado.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.tenant_validar_gravacao()') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'clientes' and column_name = 'tenant_id') then
    raise exception 'T4 exige a T3 (tenant_id ausente).';
  end if;
  if to_regprocedure('public.tenant_atual()') is not null then
    raise exception 'T4 já aplicada (tenant_atual existe).';
  end if;
end $$;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- Empresa da requisição, validada. Null = nenhuma.
create function public.tenant_atual()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_hdr  text;
  v_slug text;
  v_id   uuid;
begin
  if v_uid is null then
    return null;
  end if;

  v_hdr := nullif(current_setting('request.headers', true), '');
  if v_hdr is null then
    return null;
  end if;

  begin
    v_slug := lower(btrim(v_hdr::json ->> 'x-rx7-tenant'));
  exception when others then
    return null;
  end;

  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return null;
  end if;

  select t.id into v_id
    from public.tenants t
    join public.tenant_memberships m on m.tenant_id = t.id
    join public.profiles p on p.id = m.user_id
   where t.slug = v_slug
     and m.user_id = v_uid
     and m.ativo
     and p.ativo;

  return v_id;
end;
$$;

-- Primeira linha das RPCs: exige empresa válida na requisição.
create function public.tenant_exigir()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_atual();
begin
  if v_tenant is null then
    raise exception 'Empresa não informada ou sem acesso.' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

-- Papel comercial (gerente/sdr/closer) de um usuário numa empresa.
-- admin_empresa tem os poderes de gerente. Null = sem vínculo ativo.
create function public.papel_comercial(p_user uuid, p_tenant uuid)
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select case m.papel
           when 'admin_empresa' then 'gerente'
           when 'gerente'       then 'gerente'
           when 'sdr'           then 'sdr'
           when 'closer'        then 'closer'
         end::public.user_role
    from public.tenant_memberships m
    join public.profiles p on p.id = m.user_id
   where m.tenant_id = p_tenant
     and m.user_id = p_user
     and m.ativo
     and p.ativo;
$$;

create function public.usuario_na_empresa_atual(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_memberships m
     where m.user_id = p_user
       and m.tenant_id = public.tenant_atual()
       and m.ativo
  );
$$;

-- Gerente da empresa atual só administra o perfil (global) de quem não tem
-- vínculo ativo em nenhuma empresa onde ele próprio não seja gerente/admin.
create function public.pode_gerir_usuario(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_gerente()
     and public.usuario_na_empresa_atual(p_user)
     and not exists (
       select 1 from public.tenant_memberships m
        where m.user_id = p_user
          and m.ativo
          and not public.tem_papel_no_tenant(m.tenant_id, array['admin_empresa', 'gerente']::public.tenant_papel[])
     );
$$;

-- ---------------------------------------------------------------------------
-- 2. Papéis e permissões por empresa (mesmas assinaturas)
-- ---------------------------------------------------------------------------

create or replace function public.is_gerente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_comercial((select auth.uid()), public.tenant_atual()) = 'gerente', false);
$$;

create or replace function public.pode_ver_etapa(p_funil_id uuid, p_etapa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.tenant_id = public.tenant_atual()
        and pc.funil_id = p_funil_id
        and pc.etapa_id is null
    )
    and exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.tenant_id = public.tenant_atual()
        and pc.funil_id = p_funil_id
        and pc.etapa_id = p_etapa_id
        and pc.pode_ver
    );
$$;

create or replace function public.pode_mover_etapa(p_funil_id uuid, p_etapa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.tenant_id = public.tenant_atual()
        and pc.funil_id = p_funil_id
        and pc.etapa_id is null
    )
    and exists (
      select 1 from public.permissoes_colaborador pc
      where pc.usuario_id = (select auth.uid())
        and pc.tenant_id = public.tenant_atual()
        and pc.funil_id = p_funil_id
        and pc.etapa_id = p_etapa_id
        and pc.pode_mover
    );
$$;

-- Com usuário: só registros da empresa da requisição. Sem usuário
-- (service_role/trigger de integração): o registro, qualquer empresa.
create or replace function public.cliente_owner(p_cliente_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.owner_id
    from public.clientes c
   where c.id = p_cliente_id
     and ((select auth.uid()) is null or c.tenant_id = public.tenant_atual());
$$;

create or replace function public.negociacao_owner(p_negociacao_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select n.owner_id
    from public.negociacoes n
   where n.id = p_negociacao_id
     and ((select auth.uid()) is null or n.tenant_id = public.tenant_atual());
$$;

create or replace function public.nomes_de_usuarios(p_ids uuid[])
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nome
    from public.profiles p
   where p.id = any (p_ids)
     and exists (
       select 1 from public.tenant_memberships m
        where m.user_id = p.id
          and m.tenant_id = public.tenant_atual()
     );
$$;

-- ---------------------------------------------------------------------------
-- 3. Integridade referencial por empresa
-- ---------------------------------------------------------------------------
do $$
declare
  v_pais text[] := array['clientes','negociacoes','funis','etapas_funil','eventos_series','nichos',
                         'formularios','perguntas','mensagens','conversas','servicos'];
  -- filha, coluna, pai
  v_fks text[][] := array[
    ['atividades',            'cliente_id',        'clientes'],
    ['atividades',            'negociacao_id',     'negociacoes'],
    ['conversas',             'cliente_id',        'clientes'],
    ['etapas_funil',          'funil_id',          'funis'],
    ['eventos',               'cliente_id',        'clientes'],
    ['eventos',               'negociacao_id',     'negociacoes'],
    ['eventos',               'serie_id',          'eventos_series'],
    ['eventos_series',        'cliente_id',        'clientes'],
    ['eventos_series',        'negociacao_id',     'negociacoes'],
    ['fechamentos',           'negociacao_id',     'negociacoes'],
    ['formularios',           'nicho_id',          'nichos'],
    ['historico_etapas',      'etapa_anterior_id', 'etapas_funil'],
    ['historico_etapas',      'etapa_nova_id',     'etapas_funil'],
    ['historico_etapas',      'negociacao_id',     'negociacoes'],
    ['mensagem_exclusoes',    'mensagem_id',       'mensagens'],
    ['mensagem_reacoes',      'mensagem_id',       'mensagens'],
    ['mensagens',             'conversa_id',       'conversas'],
    ['mensagens',             'encaminhada_de_id', 'mensagens'],
    ['mensagens',             'resposta_a_id',     'mensagens'],
    ['metas',                 'funil_id',          'funis'],
    ['negociacao_servicos',   'negociacao_id',     'negociacoes'],
    ['negociacao_servicos',   'servico_id',        'servicos'],
    ['negociacoes',           'cliente_id',        'clientes'],
    ['negociacoes',           'etapa_id',          'etapas_funil'],
    ['negociacoes',           'formulario_id',     'formularios'],
    ['negociacoes',           'funil_id',          'funis'],
    ['negociacoes',           'nicho_id',          'nichos'],
    ['perguntas',             'formulario_id',     'formularios'],
    ['permissoes_colaborador','etapa_id',          'etapas_funil'],
    ['permissoes_colaborador','funil_id',          'funis'],
    ['proximas_acoes',        'cliente_id',        'clientes'],
    ['proximas_acoes',        'negociacao_id',     'negociacoes'],
    ['respostas_lead',        'negociacao_id',     'negociacoes'],
    ['respostas_lead',        'pergunta_id',       'perguntas'],
    ['whatsapp_conexoes',     'funil_id',          'funis']
  ];
  v_t    text;
  v_i    int;
  v_nome text;
begin
  foreach v_t in array v_pais loop
    execute format('alter table public.%I add constraint %I unique (tenant_id, id)', v_t, v_t || '_tenant_id_id_key');
  end loop;

  for v_i in 1 .. array_length(v_fks, 1) loop
    v_nome := left(v_fks[v_i][1] || '_' || v_fks[v_i][2], 50) || '_tenant_fkey';
    execute format(
      'alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id) not valid',
      v_fks[v_i][1], v_nome, v_fks[v_i][2], v_fks[v_i][3]
    );
    execute format('alter table public.%I validate constraint %I', v_fks[v_i][1], v_nome);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Índices únicos por empresa (novos primeiro; globais removidos depois)
-- ---------------------------------------------------------------------------
create unique index clientes_cnpj_unico_tenant on public.clientes (tenant_id, cnpj) where cnpj is not null and deleted_at is null;
create unique index clientes_cpf_unico_tenant on public.clientes (tenant_id, cpf) where cpf is not null and deleted_at is null;
create unique index conversas_telefone_unica_tenant on public.conversas (tenant_id, telefone);
create unique index etapas_funil_chave_tenant on public.etapas_funil (tenant_id, chave);
create unique index eventos_google_event_id_tenant on public.eventos (tenant_id, google_event_id) where google_event_id is not null;
create unique index formularios_slug_unico_tenant on public.formularios (tenant_id, slug);
create unique index funis_nome_ativo_unico_tenant on public.funis (tenant_id, lower(btrim(nome))) where ativo;
create unique index funis_padrao_unico_tenant on public.funis (tenant_id) where padrao;
create unique index metas_uma_por_mes_tenant on public.metas (tenant_id, usuario_id, funil_id, periodo_mes, tipo_meta) nulls not distinct;
create unique index negociacoes_origem_external_id_tenant on public.negociacoes (tenant_id, origem, external_id) where external_id is not null;
create unique index nichos_nome_ativo_unico_tenant on public.nichos (tenant_id, lower(btrim(nome))) where ativo;
create unique index nichos_slug_unico_tenant on public.nichos (tenant_id, slug);
create unique index servicos_nome_unico_tenant on public.servicos (tenant_id, lower(btrim(nome)));

do $$
begin
  if (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relnamespace = 'public'::regnamespace and c.relname like '%\_tenant' escape '\'
         and i.indisunique and i.indisvalid) <> 13 then
    raise exception 'T4 abortada: os 13 índices únicos por empresa não ficaram válidos.';
  end if;
end $$;

-- Remove os globais (alguns são CONSTRAINT UNIQUE, outros só índice).
do $$
declare
  v_nome text;
  v_tab  text;
begin
  foreach v_nome in array array[
    'clientes_cnpj_unico','clientes_cpf_unico','conversas_telefone_unica','etapas_funil_chave_key',
    'eventos_google_event_id_key','formularios_slug_unico','funis_nome_ativo_unico','funis_padrao_unico',
    'metas_uma_por_mes','negociacoes_origem_external_id_unico','nichos_nome_ativo_unico',
    'nichos_slug_unico','servicos_nome_unico'
  ] loop
    v_tab := null;
    select c.conrelid::regclass::text into v_tab
      from pg_constraint c where c.connamespace = 'public'::regnamespace and c.conname = v_nome;
    if v_tab is not null then
      execute format('alter table %s drop constraint %I', v_tab, v_nome);
    else
      execute format('drop index public.%I', v_nome);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Usuário referenciado precisa ter vínculo ativo na empresa do registro
--    (AFTER: vê o valor final, inclusive o preenchido por outros triggers).
-- ---------------------------------------------------------------------------
create function public.tenant_validar_usuarios()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo  jsonb := to_jsonb(new);
  v_velho jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_col   text;
  v_user  uuid;
begin
  foreach v_col in array tg_argv loop
    v_user := (v_novo ->> v_col)::uuid;
    continue when v_user is null;
    continue when v_velho is not null and (v_velho ->> v_col) is not distinct from (v_novo ->> v_col);
    if not exists (
      select 1 from public.tenant_memberships m
       where m.tenant_id = new.tenant_id and m.user_id = v_user and m.ativo
    ) then
      raise exception 'O usuário informado em % não pertence a esta empresa.', v_col
        using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.tenant_validar_usuarios() from public, anon, authenticated;

do $$
declare
  v_def text[][] := array[
    ['agenda_google_conexao',       'conectado_por'],
    ['agenda_google_oauth_estados', 'usuario_id'],
    ['atividades',                  'usuario_id'],
    ['clientes',                    'owner_id,excluido_por'],
    ['etapas_funil',                'criado_por'],
    ['eventos',                     'usuario_id,criado_por'],
    ['eventos_series',              'usuario_id,criado_por'],
    ['fechamentos',                 'responsavel_id,fechado_por,anulado_por'],
    ['funis',                       'criado_por'],
    ['historico_etapas',            'usuario_id'],
    ['mensagem_exclusoes',          'usuario_id'],
    ['mensagem_reacoes',            'usuario_id'],
    ['mensagens',                   'autor_id'],
    ['metas',                       'usuario_id,criado_por'],
    ['negociacoes',                 'owner_id,excluida_por'],
    ['permissoes_colaborador',      'usuario_id,criado_por'],
    ['proximas_acoes',              'usuario_id'],
    ['whatsapp_conexoes',           'responsavel_padrao_id']
  ];
  v_i    int;
  v_args text;
begin
  for v_i in 1 .. array_length(v_def, 1) loop
    select string_agg(quote_literal(c), ', ') into v_args from unnest(string_to_array(v_def[v_i][2], ',')) c;
    execute format(
      'create trigger zz_tenant_30_usuarios after insert or update on public.%I for each row execute function public.tenant_validar_usuarios(%s)',
      v_def[v_i][1], v_args
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Empresa somente leitura: nenhuma gravação vinda da API (usuário ou
--    service_role). Migrations do dono do banco (sem JWT) continuam possíveis.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_validar_gravacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'A empresa de um registro não pode ser alterada.' using errcode = '23514';
  end if;

  v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;

  if (select auth.uid()) is not null and not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Você não tem permissão para gravar nesta empresa.' using errcode = '42501';
  end if;

  if v_claims is not null and exists (
    select 1 from public.tenants t where t.id = v_tenant and t.somente_leitura
  ) then
    raise exception 'Esta empresa está somente leitura.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Policies RESTRICTIVE
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabelas text[] := array[
    'clientes','funis','nichos','servicos','agenda_google_conexao','agenda_google_oauth_estados',
    'negociacoes','fechamentos','negociacao_servicos','respostas_lead','historico_etapas',
    'atividades','proximas_acoes','eventos','eventos_series','conversas','mensagens',
    'mensagem_reacoes','mensagem_exclusoes','etapas_funil','formularios','perguntas',
    'permissoes_colaborador','whatsapp_conexoes','metas'
  ];
  v_t text;
  v_ok constant text := 'tenant_id = (select public.tenant_atual())';
  v_escrita constant text := 'tenant_id = (select public.tenant_atual()) and public.pode_escrever_no_tenant(tenant_id)';
begin
  foreach v_t in array v_tabelas loop
    execute format('create policy %I on public.%I as restrictive for select to public using (%s)',
                   v_t || '_tenant_ler', v_t, v_ok);
    execute format('create policy %I on public.%I as restrictive for insert to public with check (%s)',
                   v_t || '_tenant_incluir', v_t, v_escrita);
    execute format('create policy %I on public.%I as restrictive for update to public using (%s) with check (%s)',
                   v_t || '_tenant_alterar', v_t, v_escrita, v_escrita);
    execute format('create policy %I on public.%I as restrictive for delete to public using (%s)',
                   v_t || '_tenant_excluir', v_t, v_escrita);
  end loop;
end $$;

-- profiles é global (um perfil por pessoa): só aparece quem é da empresa da
-- requisição; só é alterado pelo próprio usuário ou por quem gere todas as
-- empresas dele.
create policy profiles_tenant_ler on public.profiles as restrictive for select to public
  using (id = (select auth.uid()) or public.usuario_na_empresa_atual(id));
create policy profiles_tenant_alterar on public.profiles as restrictive for update to public
  using (id = (select auth.uid()) or public.pode_gerir_usuario(id))
  with check (id = (select auth.uid()) or public.pode_gerir_usuario(id));

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
revoke all on function public.tenant_atual() from public, anon;
revoke all on function public.tenant_exigir() from public, anon;
revoke all on function public.papel_comercial(uuid, uuid) from public, anon;
revoke all on function public.usuario_na_empresa_atual(uuid) from public, anon;
revoke all on function public.pode_gerir_usuario(uuid) from public, anon;
grant execute on function public.tenant_atual() to authenticated, service_role;
grant execute on function public.tenant_exigir() to authenticated, service_role;
grant execute on function public.papel_comercial(uuid, uuid) to authenticated, service_role;
grant execute on function public.usuario_na_empresa_atual(uuid) to authenticated, service_role;
grant execute on function public.pode_gerir_usuario(uuid) to authenticated, service_role;

-- Conferência final
do $$
begin
  if (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
       where c.relnamespace = 'public'::regnamespace and not p.polpermissive) <> 102 then
    raise exception 'T4 abortada: esperadas 102 policies RESTRICTIVE.';
  end if;
  if (select count(*) from pg_constraint where connamespace = 'public'::regnamespace
       and contype = 'f' and conname like '%\_tenant\_fkey' escape '\' and convalidated) <> 35 then
    raise exception 'T4 abortada: esperadas 35 FKs compostas validadas.';
  end if;
end $$;
