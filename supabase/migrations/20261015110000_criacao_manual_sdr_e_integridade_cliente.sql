-- ===========================================================================
-- Duas correções relacionadas, pedidas juntas:
--
-- 1. SDR/CLOSER não conseguiam cadastrar cliente/negociação manualmente
--    (incluindo Outbound): `criar_cliente` sempre criava a negociação na
--    etapa de sistema do Funil Principal, hardcoded, sem nenhum parâmetro de
--    funil — e nem essa, nem `criar_negociacao`, checavam
--    `permissoes_colaborador` no INSERT (só `owner_id = auth.uid() OR
--    is_gerente()`, policy de 20260923120400, nunca reescrita). O owner_id
--    sempre bastava pra o INSERT passar, então a negociação nascia e,
--    dependendo da etapa, ficava invisível pro próprio criador (porque
--    `negociacoes_select`/`clientes_select`, de 20261014160000, já não usam
--    mais owner_id — usam `pode_ver_etapa`). Criar não dava erro; só
--    desaparecia.
--
-- 2. "Cliente não encontrado" ao abrir a ficha de um lead do Kanban:
--    investigado com leitura real de produção. NÃO há negociação sem
--    cliente (a FK `negociacoes.cliente_id not null references clientes`
--    já impede isso estruturalmente) e NÃO há cliente sem nenhuma
--    negociação (os 3 caminhos que criam cliente+negociação —
--    `criar_cliente`, `criar_cliente_whatsapp`, `ingerir_lead_formulario`
--    — sempre fazem isso na mesma transação). O que EXISTE é uma negociação
--    ATIVA cujo cliente foi arquivado (`clientes.deleted_at`) depois —
--    `obterCliente()` filtra `deleted_at is null` corretamente, então o
--    comportamento observado ("Cliente não encontrado") é o esperado PRA
--    ESSE DADO, mas o dado em si é uma inconsistência que o sistema deveria
--    ter impedido de existir. `arquivarCliente()` (lib/dal/clientes.ts) já
--    bloqueia arquivar cliente com negociação GANHA, mas só em TypeScript,
--    e só para 'ganha' — nunca para uma negociação aberta comum. Fecha-se
--    agora, no banco, pra qualquer negociação ativa (não arquivada/excluída).
--
-- Ordem do arquivo:
--   1. negociacoes_protege_criacao_por_permissao — trigger BEFORE INSERT,
--      espelha exatamente a de UPDATE (20261014170000), nunca a substitui.
--   2. criar_cliente ganha p_funil_id (default = funil padrão, compatível
--      com todo caller existente) — resolve a etapa inicial DENTRO desse
--      funil, em vez do chave fixa 'reuniao_agendada' do Funil Principal.
--   3. clientes_protege_arquivamento_com_negociacao_ativa — trigger BEFORE
--      UPDATE OF deleted_at em clientes, bloqueia arquivar com negociação
--      ativa (fecha a classe do bug encontrado; mais ampla que a checagem
--      de TypeScript hoje, que só olha 'ganha' — fica documentado como
--      decisão deliberada, não acidente).
--
-- NADA aqui toca `negociacoes_valida_handoff_sdr`,
-- `negociacoes_protege_movimentacao_por_permissao`, `pode_ver_etapa`,
-- `pode_mover_etapa`, RLS de SELECT, `funil_metricas`, ou qualquer coisa de
-- WhatsApp. `funil_metricas` nem é mencionada neste arquivo.
--
-- ---------------------------------------------------------------------------
-- BUG ENCONTRADO DEPOIS (teste SQL real, 2026-10-15) e CORRIGIDO NESTA MESMA
-- VERSÃO, ainda não aplicada: `criar_cliente` sempre fez
-- `insert into public.clientes (...) returning id into v_cliente_id` — e
-- `RETURNING` exige reler a linha recém-inserida sob a policy de SELECT
-- (`clientes_select`, reescrita em 20261014160000: GERENTE ou EXISTS uma
-- negociação já visível). No instante exato desse insert, o cliente ainda
-- não tem NENHUMA negociação (ela só é criada na instrução seguinte, dentro
-- da mesma função) — logo `clientes_select` NUNCA pode ser satisfeita
-- para um não-gerente, e o RETURNING falha com "new row violates row-level
-- security policy for table clientes", mesmo com owner_id/permissões
-- corretos (o próprio WITH CHECK de `clientes_insert` passa; é a releitura
-- implícita do RETURNING que não passa). Bug pré-existente desde
-- 20261014160000 — nunca exercido antes porque nenhum teste tinha feito um
-- INSERT em `clientes` sob impersonação real de não-gerente.
--
-- CORREÇÃO (sem SECURITY DEFINER, sem bypass): gerar o `id` explicitamente
-- em PL/pgSQL (`gen_random_uuid()`) e inserir esse valor já pronto — então
-- não precisamos mais ler a linha de volta (sem RETURNING, só o WITH CHECK
-- do INSERT é avaliado, que já é owner_id = auth.uid() OR is_gerente(),
-- continua intacto). Confirmado com teste real (rollback, sem tocar
-- produção): o mesmo insert, sem RETURNING, passa; com RETURNING, falha —
-- isolando a causa com certeza antes de mudar qualquer coisa.
--
-- Também corrigido aqui: a versão de `criar_cliente` com `p_funil_id` é uma
-- assinatura NOVA (14 parâmetros) — sem GRANT EXECUTE explícito ela fica
-- sem o REVOKE ALL FROM public, anon que todo outro RPC do projeto tem,
-- dependendo só do EXECUTE padrão do Postgres para PUBLIC (que inclui
-- `anon`). Adicionado o par revoke/grant que faltava, igual o padrão já
-- usado em todo outro RPC deste arquivo.
-- ---------------------------------------------------------------------------
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Criação de negociação exige permissão (INSERT) — simétrico à
-- movimentação (UPDATE). Automação (service_role, sem usuário logado:
-- `ingerir_lead_formulario`, `criar_cliente_whatsapp`) nunca tem
-- `auth.uid()` — passa direto, nunca é bloqueada por permissão comercial
-- (ela já resolve funil/etapa pela própria config, não pelo usuário).
--
-- BUG ENCONTRADO E CORRIGIDO AQUI (teste SQL real, 2026-10-15): `negociacoes`
-- tem OUTRA trigger BEFORE INSERT OR UPDATE já existente,
-- `negociacoes_sincroniza_funil` (20260929120000), que é quem de fato
-- preenche `funil_id` a partir de `etapa_id` — a coluna nunca é escrita
-- diretamente por `criar_cliente`/`criar_negociacao`. O Postgres dispara
-- múltiplas triggers BEFORE no mesmo evento em ORDEM ALFABÉTICA pelo nome:
-- "negociacoes_protege_criacao_por_permissao" vem antes de
-- "negociacoes_sincroniza_funil" ("p" < "s") — ou seja, esta trigger
-- SEMPRE rodava com `NEW.funil_id` ainda `NULL`, e
-- `pode_mover_etapa(null, etapa_id)` é estruturalmente sempre `false`
-- (nenhuma linha de `permissoes_colaborador` tem `funil_id null`) —
-- bloqueava QUALQUER criação de SDR/CLOSER, mesmo com permissão perfeita.
-- Confirmado instrumentando a trigger e lendo `NEW.funil_id` no instante
-- exato em que ela dispara: veio `null`, a etapa veio certa.
--
-- CORREÇÃO: resolver o funil localmente, sem depender da ordem de
-- disparo de nenhuma outra trigger — se `NEW.funil_id` já veio preenchido
-- (não deveria depender disso, mas não custa aceitar), usa; senão, deriva
-- de `etapas_funil` pela própria `NEW.etapa_id`, exatamente como
-- `negociacoes_sincroniza_funil` faz. Não altera essa trigger de
-- sincronização, não a renomeia, não depende da ordem dela — só para de
-- confiar que ela já rodou antes.
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_protege_criacao_por_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.is_gerente() then
    return new;
  end if;

  v_funil_id := coalesce(
    new.funil_id,
    (select e.funil_id from public.etapas_funil e where e.id = new.etapa_id)
  );

  if not public.pode_mover_etapa(v_funil_id, new.etapa_id) then
    raise exception 'Você não tem permissão para criar uma negociação nesta etapa.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.negociacoes_protege_criacao_por_permissao is
  'Backstop no banco pra TODO INSERT em negociacoes (criar_cliente, '
  'criar_negociacao, ou qualquer outro caminho futuro) — espelha '
  'negociacoes_protege_movimentacao_por_permissao (20261014170000), agora '
  'pra criação. auth.uid() nulo = automação (service_role), sempre passa. '
  'Gerente passa direto. Qualquer outro papel precisa de '
  'pode_mover_etapa(funil_id, etapa_id) — owner_id nunca decide aqui.';

revoke all on function public.negociacoes_protege_criacao_por_permissao() from public, anon;

create trigger negociacoes_protege_criacao_por_permissao
  before insert on public.negociacoes
  for each row
  execute function public.negociacoes_protege_criacao_por_permissao();

-- ---------------------------------------------------------------------------
-- 2. criar_cliente ganha p_funil_id. DROP antes do CREATE OR REPLACE —
-- parâmetro novo sem DROP cria uma segunda função sobrecarregada (lição já
-- registrada em 20261008100000/20261008120000).
-- ---------------------------------------------------------------------------
drop function if exists public.criar_cliente(
  public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, uuid, text
);

create or replace function public.criar_cliente(
  p_tipo_cliente public.tipo_cliente,
  p_nome         text,
  p_empresa      text default null,
  p_cpf          text default null,
  p_cnpj         text default null,
  p_telefone     text default null,
  p_whatsapp     text default null,
  p_email        text default null,
  p_responsavel  text default null,
  p_cargo        text default null,
  p_observacoes  text default null,
  p_owner_id     uuid default null,
  p_instagram    text default null,
  p_funil_id     uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_cliente_id uuid;
  v_funil_id   uuid;
  v_etapa_id   uuid;
begin
  v_funil_id := coalesce(p_funil_id, (select id from public.funis where padrao));

  if v_funil_id is null then
    raise exception 'Nenhum funil padrão configurado.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.funis f where f.id = v_funil_id and f.ativo) then
    raise exception 'Funil não encontrado ou desativado.' using errcode = 'P0002';
  end if;

  -- Primeira etapa aberta e ativa do funil — mesma regra de criar_negociacao
  -- (a leitura é repetida aqui, não a decisão de negócio em si: delegar pra
  -- criar_negociacao bateria na RLS de clientes_select, que exige uma
  -- negociação JÁ visível pra enxergar o cliente — impossível pra PRIMEIRA
  -- negociação de um cliente recém-criado, ainda dentro desta transação).
  select e.id into v_etapa_id
    from public.etapas_funil e
   where e.funil_id = v_funil_id
     and e.tipo = 'aberta'
     and e.ativo
   order by e.ordem
   limit 1;

  if v_etapa_id is null then
    raise exception 'O funil não tem etapa aberta disponível para receber a negociação.'
      using errcode = '23514';
  end if;

  -- Gerado aqui, não pelo DEFAULT da coluna: assim o INSERT abaixo não
  -- precisa de RETURNING, que exigiria reler a linha pela RLS de SELECT
  -- (impossível pra um não-gerente neste instante — a negociação que daria
  -- essa visibilidade só é criada na instrução seguinte). O WITH CHECK de
  -- clientes_insert (owner_id = auth.uid() OR is_gerente()) continua sendo
  -- a única checagem desta escrita — nada foi relaxado.
  v_cliente_id := gen_random_uuid();

  insert into public.clientes (
    id, tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
    responsavel, cargo, observacoes, owner_id, instagram
  )
  values (
    v_cliente_id, p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone,
    p_whatsapp, p_email, p_responsavel, p_cargo, p_observacoes,
    coalesce(p_owner_id, (select auth.uid())), p_instagram
  );

  insert into public.negociacoes (cliente_id, owner_id, etapa_id, origem)
  values (
    v_cliente_id,
    coalesce(p_owner_id, (select auth.uid())),
    v_etapa_id,
    'manual'
  );

  return v_cliente_id;
end;
$$;

comment on function public.criar_cliente is
  'Cria o cliente e a negociação inicial na mesma transação. p_funil_id '
  'opcional (default: funil padrão, compatível com todo caller existente) — '
  'entra na primeira etapa aberta e ativa DESSE funil. id gerado em '
  'PL/pgSQL (não via RETURNING): clientes_select exige uma negociação já '
  'visível, que ainda não existe no instante do insert em clientes — '
  'RETURNING falharia a RLS de SELECT mesmo com owner_id/permissão certos. '
  'A negociação passa pelo trigger negociacoes_protege_criacao_por_permissao '
  'como qualquer outro INSERT: só cria se o chamador for gerente ou tiver '
  'pode_mover_etapa nessa etapa inicial.';

-- Assinatura nova (14 parâmetros, por causa de p_funil_id) = objeto de
-- função novo pro Postgres — GRANT de uma assinatura antiga nunca migra
-- pra uma diferente. Sem isto, a função ficaria exequível só pelo dono
-- (postgres) + o que sobrar do default de PUBLIC, igual todo outro RPC
-- deste schema já revoga/concede explicitamente.
revoke all on function public.criar_cliente(
  public.tipo_cliente, text, text, text, text, text, text, text, text, text,
  text, uuid, text, uuid
) from public, anon;
grant execute on function public.criar_cliente(
  public.tipo_cliente, text, text, text, text, text, text, text, text, text,
  text, uuid, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Não deixar arquivar cliente com negociação ATIVA (não arquivada, não
-- excluída) — fecha a classe do bug "Cliente não encontrado" encontrado em
-- produção (uma negociação aberta ficou presa a um cliente arquivado).
--
-- MAIS AMPLA que a checagem hoje em TypeScript (lib/dal/clientes.ts,
-- arquivarCliente): aquela só bloqueia negociação GANHA; esta bloqueia
-- QUALQUER negociação ativa (aberta, ganha ou perdida-mas-não-arquivada).
-- Decisão deliberada: "toda negociação que entrar no funil deve continuar
-- vinculada a um cliente válido" não se sustenta se só a venda fechada for
-- protegida.
-- ---------------------------------------------------------------------------
create or replace function public.clientes_protege_arquivamento_com_negociacao_ativa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (
      select 1 from public.negociacoes n
      where n.cliente_id = new.id
        and n.arquivada_em is null
        and n.excluida_em is null
    ) then
      raise exception 'Este cliente tem negociação ativa no funil. Arquive ou encerre a negociação antes de arquivar o cliente.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.clientes_protege_arquivamento_com_negociacao_ativa is
  'Backstop no banco: nunca permite clientes.deleted_at virar not null '
  'enquanto existir negociação ativa (nem arquivada, nem excluída) pra esse '
  'cliente — fecha a classe de bug "negociação ativa presa a cliente '
  'arquivado" (obterCliente() passaria a não achar o cliente). Mais amplo '
  'que a checagem de TypeScript existente (só "ganha") — intencional.';

create trigger clientes_protege_arquivamento_com_negociacao_ativa
  before update of deleted_at on public.clientes
  for each row
  execute function public.clientes_protege_arquivamento_com_negociacao_ativa();
