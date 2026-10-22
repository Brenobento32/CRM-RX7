-- ===========================================================================
-- T3 — tenant_id nas 25 tabelas comerciais (depende da T1 e da T2).
--
-- REGISTROS ATUAIS: todos ficam na empresa de arquivo (tenant_arquivo_id()).
--   `ADD COLUMN tenant_id ... NOT NULL DEFAULT '<arquivo>'` com valor constante
--   não reescreve a tabela: as linhas existentes passam a ler o arquivo sem
--   UPDATE, sem trigger e sem mudar updated_at (mesma técnica da M1). Nenhum
--   registro antigo vai para a Rio X7.
--
-- REGISTROS NOVOS: o default é REMOVIDO logo depois. Não existe default
--   permanente nem "empresa ativa" de sessão:
--   - 6 tabelas-raiz (clientes, funis, nichos, servicos, agenda_google_conexao,
--     agenda_google_oauth_estados) exigem tenant_id explícito;
--   - as outras 19 herdam o tenant do registro pai obrigatório
--     (`_tenant_10_derivar`); se o tenant vier informado e divergir do pai, a
--     gravação é recusada;
--   - em toda gravação (`_tenant_20_validar`): o tenant_id é imutável e, quando
--     há usuário (auth.uid()), ele precisa poder escrever naquela empresa
--     (vínculo ativo e empresa que não seja somente leitura). Sem usuário
--     (service_role: webhooks/integrações), o tenant tem de vir explícito ou
--     derivado — a integração identifica a empresa por credencial própria.
--
-- EFEITO NO APP ATUAL (não liberar sozinha em produção; ver
-- docs/SAAS-MULTIEMPRESA.md): inserts nas tabelas-raiz sem tenant_id falham, e
-- usuários deixam de alterar registros do arquivo (somente leitura).
--
-- Não altera FKs, policies, funções nem triggers existentes; só acrescenta.
-- ===========================================================================

-- Herda o tenant do registro pai (args: tabela pai, coluna FK). Se o tenant
-- vier informado e divergir do pai, recusa. SECURITY DEFINER para enxergar o
-- pai mesmo quando a RLS de leitura o esconderia (o erro fica explícito).
create or replace function public.tenant_derivar_do_pai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pai_id     uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  v_tenant_pai uuid;
begin
  if v_pai_id is null then
    return new;  -- sem pai: o tenant tem de vir explícito (NOT NULL garante)
  end if;

  execute format('select tenant_id from public.%I where id = $1', tg_argv[0])
     into v_tenant_pai using v_pai_id;

  if v_tenant_pai is null then
    return new;  -- pai inexistente: a FK do próprio registro recusa
  end if;

  if new.tenant_id is null then
    new.tenant_id := v_tenant_pai;
  elsif new.tenant_id <> v_tenant_pai then
    raise exception 'O registro e o seu registro pai (%) pertencem a empresas diferentes.', tg_argv[1]
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- tenant_id imutável; com usuário, exige permissão de escrita na empresa.
create or replace function public.tenant_validar_gravacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'A empresa de um registro não pode ser alterada.' using errcode = '23514';
  end if;

  v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;

  if (select auth.uid()) is not null and not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Você não tem permissão para gravar nesta empresa.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.tenant_derivar_do_pai() from public, anon, authenticated;
revoke all on function public.tenant_validar_gravacao() from public, anon, authenticated;

do $$
declare
  v_raiz text[] := array['clientes','funis','nichos','servicos','agenda_google_conexao','agenda_google_oauth_estados'];
  v_filhas text[][] := array[
    ['negociacoes',         'clientes',    'cliente_id'],
    ['fechamentos',         'negociacoes', 'negociacao_id'],
    ['negociacao_servicos', 'negociacoes', 'negociacao_id'],
    ['respostas_lead',      'negociacoes', 'negociacao_id'],
    ['historico_etapas',    'negociacoes', 'negociacao_id'],
    ['atividades',          'clientes',    'cliente_id'],
    ['proximas_acoes',      'clientes',    'cliente_id'],
    ['eventos',             'clientes',    'cliente_id'],
    ['eventos_series',      'clientes',    'cliente_id'],
    ['conversas',           'clientes',    'cliente_id'],
    ['mensagens',           'conversas',   'conversa_id'],
    ['mensagem_reacoes',    'mensagens',   'mensagem_id'],
    ['mensagem_exclusoes',  'mensagens',   'mensagem_id'],
    ['etapas_funil',        'funis',       'funil_id'],
    ['formularios',         'nichos',      'nicho_id'],
    ['perguntas',           'formularios', 'formulario_id'],
    ['permissoes_colaborador', 'funis',    'funil_id'],
    ['whatsapp_conexoes',   'funis',       'funil_id'],
    ['metas',               'funis',       'funil_id']
  ];
  v_todas  text[];
  v_t      text;
  v_i      int;
  v_fora   bigint;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '60s', true);

  if to_regprocedure('public.pode_escrever_no_tenant(uuid)') is null
     or not exists (select 1 from public.tenants where id = public.tenant_arquivo_id() and tipo = 'arquivo') then
    raise exception 'T3 exige a T1 e a T2 (empresa de arquivo ausente).';
  end if;

  v_todas := v_raiz;
  for v_i in 1 .. array_length(v_filhas, 1) loop
    v_todas := v_todas || v_filhas[v_i][1];
  end loop;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and column_name = 'tenant_id' and table_name = any (v_todas)) then
    raise exception 'T3 já aplicada (há tenant_id em alguma das 25 tabelas).';
  end if;

  -- 1. Coluna: todas as linhas atuais no arquivo, sem UPDATE; depois sem default.
  foreach v_t in array v_todas loop
    execute format(
      'alter table public.%I add column tenant_id uuid not null default %L references public.tenants (id) on delete restrict',
      v_t, public.tenant_arquivo_id()
    );
    execute format('alter table public.%I alter column tenant_id drop default', v_t);
    execute format('create index %I on public.%I (tenant_id)', v_t || '_tenant_idx', v_t);
    execute format('comment on column public.%I.tenant_id is %L', v_t,
      'Empresa dona do registro. Sem default: explícita nas tabelas-raiz, herdada do registro pai nas demais. Imutável.');
  end loop;

  -- 2. Herança do tenant pelo registro pai (19 tabelas).
  for v_i in 1 .. array_length(v_filhas, 1) loop
    execute format(
      'create trigger _tenant_10_derivar before insert or update on public.%I for each row execute function public.tenant_derivar_do_pai(%L, %L)',
      v_filhas[v_i][1], v_filhas[v_i][2], v_filhas[v_i][3]
    );
  end loop;

  -- 3. Validação em toda gravação (25 tabelas).
  foreach v_t in array v_todas loop
    execute format(
      'create trigger _tenant_20_validar before insert or update or delete on public.%I for each row execute function public.tenant_validar_gravacao()',
      v_t
    );
  end loop;

  -- 4. Conferência: 25 colunas NOT NULL sem default e toda linha atual no arquivo.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and column_name = 'tenant_id' and table_name = any (v_todas)
         and is_nullable = 'NO' and column_default is null) <> 25 then
    raise exception 'T3 abortada: tenant_id não ficou NOT NULL e sem default nas 25 tabelas.';
  end if;
  foreach v_t in array v_todas loop
    execute format('select count(*) from public.%I where tenant_id <> %L', v_t, public.tenant_arquivo_id()) into v_fora;
    if v_fora <> 0 then
      raise exception 'T3 abortada: % linha(s) de % fora do arquivo.', v_fora, v_t;
    end if;
  end loop;
end $$;
