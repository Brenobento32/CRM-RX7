-- ===========================================================================
-- Dry-run de "Valor do fechamento + serviços contratados + observações +
-- Histórico do funil"
-- (supabase/migrations/20260930130000_funil_cards_valor_vendido.sql,
--  supabase/migrations/20260930140000_fechamentos_observacoes.sql,
--  supabase/migrations/20260930150000_fechar_negociacao_servicos_observacoes.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. NÃO
--   depende das 3 migrations acima já terem sido aplicadas: a própria
--   transação instala, temporariamente, a view `funil_cards` e a função
--   `fechar_negociacao()` novas — byte a byte idênticas às migrations
--   (`fechamentos.observacoes` também é criada aqui dentro, só pra este
--   teste, e some no ROLLBACK). `create or replace view/function` e `alter
--   table` são DDL transacional no Postgres: o ROLLBACK no fim desfaz tudo
--   — coluna, view, função e dados de teste. Nada fica gravado.
--
--   `fechar_negociacao()` muda de 9 para 11 parâmetros — como a identidade
--   de uma função no Postgres é (nome + tipos dos parâmetros), acrescentar
--   parâmetros cria uma SEGUNDA sobrecarga em vez de substituir a antiga.
--   Por isso este dry-run faz `DROP FUNCTION` da assinatura de 9 ANTES de
--   instalar a de 11 — exatamente como a migration `20260930150000` corrigida
--   faz. Sem esse DROP, as duas coexistiriam dentro da transação e qualquer
--   chamada com só os 8 parâmetros originais falharia com "function ... is
--   not unique" (é o que quebrou a primeira versão deste dry-run).
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
-- O QUE ELE PROVA
--   V1: aberta mostra valor_estimado (valor_vendido nulo na view).
--   V2: fechada (ganha) mostra valor_vendido na view.
--   V3: perdida continua com valor_estimado disponível (comportamento atual).
--   S1: fechar_negociacao sincroniza negociacao_servicos pra substituição
--       explícita (remove o que não está mais na lista, adiciona o que é
--       novo) ANTES de mudar a etapa.
--   S2: fechar com os MESMOS serviços que já estavam vinculados (o cenário
--       real do modal, que agora pré-marca via funil_cards.servico_ids)
--       preserva esses serviços — fechar não pode apagar o que já existia.
--   S3: p_servico_ids = '{}' (vazio, explícito) sincroniza para ZERO serviços.
--   S4: p_servico_ids = null é tratado igual a '{}' — também ZERO serviços,
--       nunca "preserva" (mesma semântica de salvar_negociacao()).
--   O1: fechamentos.observacoes grava o texto informado.
--   N1: o mesmo fluxo (valor/serviços/observações) funciona em um SEGUNDO
--       funil, escolhendo a etapa ganha DELE (não a do Principal).
--   H1: histórico completo de uma cadeia Reunião agendada -> Proposta
--       enviada -> Reunião agendada (repete) -> Perdido -> Recuperação ->
--       Fechado — todas as transições preservadas, na ordem certa.
--   X1: nenhuma negociação/card duplicado em nenhum dos testes acima.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária: coluna, view e função novas.
-- ---------------------------------------------------------------------------
alter table public.fechamentos add column observacoes text;

create or replace view public.funil_cards
with (security_invoker = true)
as
select
  n.id,
  n.etapa_id,
  e.nome            as etapa_nome,
  e.cor             as etapa_cor,
  e.tipo            as etapa_tipo,
  n.posicao,
  n.valor_estimado,
  n.temperatura,
  n.data_entrada_etapa,
  n.owner_id,
  p.nome            as responsavel_nome,
  c.id              as cliente_id,
  c.nome            as cliente_nome,
  c.empresa         as cliente_empresa,
  pa.titulo         as proxima_acao_titulo,
  pa.data           as proxima_acao_data,
  ua.tipo           as ultima_atividade_tipo,
  ua.data           as ultima_atividade_data,
  ua.descricao      as ultima_atividade_descricao,
  n.funil_id,
  f.valor_vendido,
  coalesce(
    (select array_agg(ns.servico_id order by ns.servico_id)
       from public.negociacao_servicos ns
      where ns.negociacao_id = n.id),
    '{}'
  ) as servico_ids
from public.negociacoes n
join public.etapas_funil e
  on e.id = n.etapa_id
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
left join public.profiles p
  on p.id = n.owner_id
left join public.fechamentos f
  on f.negociacao_id = n.id
left join lateral (
  select x.titulo, x.data
  from (
    select a.titulo, a.data
    from public.proximas_acoes a
    where a.concluida_em is null
      and (
        a.negociacao_id = n.id
        or (a.negociacao_id is null and a.cliente_id = n.cliente_id)
      )
    union all
    select ev.titulo, (ev.inicio at time zone 'America/Sao_Paulo')::date
    from public.eventos ev
    where ev.status = 'agendado'
      and ev.inicio >= now()
      and (
        ev.negociacao_id = n.id
        or (ev.negociacao_id is null and ev.cliente_id = n.cliente_id)
      )
  ) x
  order by x.data
  limit 1
) pa on true
left join lateral (
  select a.tipo, a.data, a.descricao
  from public.atividades a
  where a.cliente_id = n.cliente_id
  order by a.data desc
  limit 1
) ua on true;

drop function if exists public.fechar_negociacao(
  uuid,
  numeric,
  numeric,
  date,
  boolean,
  boolean,
  public.status_pagamento,
  public.status_onboarding,
  text
);

create or replace function public.fechar_negociacao(
  p_negociacao_id      uuid,
  p_posicao            numeric,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null,
  p_servico_ids        uuid[] default null,
  p_observacoes        text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_ganha_id uuid;
begin
  select n.funil_id into v_funil_id
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  -- null tratado como '{}' (zero serviços) — mesma semântica de
  -- salvar_negociacao(), nunca "preserva".
  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id
        from public.negociacao_servicos ns
       where ns.negociacao_id = p_negociacao_id
    ) novo;

  select e.id into v_ganha_id
    from public.etapas_funil e
   where e.funil_id = v_funil_id
     and e.tipo = 'ganha';

  update public.negociacoes
     set etapa_id = v_ganha_id,
         posicao = p_posicao
   where id = p_negociacao_id;

  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado,
    contrato_assinado, link_contrato, status_pagamento, status_onboarding, observacoes
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding, p_observacoes
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        observacoes        = excluded.observacoes,
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
end;
$$;

-- O DROP acima também derruba os grants da assinatura antiga (revoke/grant
-- são amarrados à assinatura específica, não ao nome) — sem isso, a função
-- recém-recriada só teria o EXECUTE padrão do Postgres para PUBLIC, e o
-- teste rodaria "certo por acidente", sem provar que os grants explícitos da
-- migration realmente saem consistentes.
revoke all on function public.fechar_negociacao(
  uuid, numeric, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
) from public, anon;

grant execute on function public.fechar_negociacao(
  uuid, numeric, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Testes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente uuid := 'cccccccc-2222-2222-2222-222222222222';
  v_closer  uuid := 'dddddddd-2222-2222-2222-222222222222';

  v_funil_principal uuid;
  v_perdido_principal uuid;
  v_recuperacao_id  uuid;

  v_funil_novo  uuid;

  v_servico_1 uuid;
  v_servico_2 uuid;
  v_servico_3 uuid;

  v_cliente_a uuid;
  v_cliente_b uuid;
  v_cliente_c uuid;
  v_cliente_s2 uuid;
  v_cliente_s3 uuid;
  v_cliente_s4 uuid;
  v_negociacao_a uuid;  -- valor/servicos/observacoes no Principal (S1: substituição explícita)
  v_negociacao_b uuid;  -- perdida (V3)
  v_negociacao_c uuid;  -- funil novo (N1)
  v_negociacao_h uuid;  -- histórico completo (H1)
  v_negociacao_s2 uuid; -- fecha com os MESMOS serviços já vinculados (S2)
  v_negociacao_s3 uuid; -- fecha com '{}' explícito (S3)
  v_negociacao_s4 uuid; -- fecha com null (S4)

  v_etapa_reuniao   uuid;
  v_etapa_proposta  uuid;

  v_valor_estimado_view numeric;
  v_valor_vendido_view  numeric;

  v_neg_antes  integer;
  v_neg_depois integer;

  v_qtd_servicos integer;
  v_hist_total   integer;
  v_hist_etapas  text[];
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.fecham.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Fechamento"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.fecham.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run Fechamento"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id into v_funil_principal from public.funis where padrao;
  select id into v_perdido_principal
    from public.etapas_funil where funil_id = v_funil_principal and tipo = 'perdida';
  select id into v_recuperacao_id
    from public.etapas_funil
   where funil_id = v_funil_principal and tipo = 'aberta' and pos_fechamento
   limit 1;
  select id into v_etapa_reuniao  from public.etapas_funil where chave = 'reuniao_agendada';
  select id into v_etapa_proposta from public.etapas_funil where chave = 'proposta_enviada';

  -- Se este banco ainda não tiver nenhuma etapa de recuperação (zona nova),
  -- cria uma só pra este teste — sem isso H1 não consegue testar a cadeia
  -- completa Perdido -> Recuperação -> Fechado.
  if v_recuperacao_id is null then
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento)
    select v_funil_principal, 'Recuperação — dry-run fechamento', 'amarelo',
           (select max(ordem) from public.etapas_funil
             where funil_id = v_funil_principal and tipo in ('ganha', 'perdida')) + 1000,
           'aberta', true
    returning id into v_recuperacao_id;
  end if;

  select id into v_servico_1 from public.servicos where ativo order by nome limit 1;
  select id into v_servico_2 from public.servicos where ativo order by nome offset 1 limit 1;
  select id into v_servico_3 from public.servicos where ativo order by nome offset 2 limit 1;
  assert v_servico_1 is not null and v_servico_2 is not null and v_servico_3 is not null,
    'precisa de pelo menos 3 serviços ativos cadastrados pra este dry-run (catálogo seed)';

  select public.criar_funil(
    'Funil Dry-Run Fechamento Multi',
    'Fechado — dry-run fecham', 'verde',
    'Perdido — dry-run fecham', 'vermelho',
    '[{"nome":"Contato — dry-run fecham","cor":"azul"}]'::jsonb
  ) into v_funil_novo;

  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Fecham A', 'Empresa A', v_closer) returning id into v_cliente_a;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Fecham B', 'Empresa B', v_closer) returning id into v_cliente_b;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Fecham C', 'Empresa C', v_closer) returning id into v_cliente_c;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Fecham S2', 'Empresa S2', v_closer) returning id into v_cliente_s2;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Fecham S3', 'Empresa S3', v_closer) returning id into v_cliente_s3;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run Fecham S4', 'Empresa S4', v_closer) returning id into v_cliente_s4;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_a, v_funil_principal, 7000.00, 'quente') into v_negociacao_a;
  select public.criar_negociacao(v_cliente_b, v_funil_principal, 3000.00, 'morno')  into v_negociacao_b;
  select public.criar_negociacao(v_cliente_c, v_funil_novo,      9000.00, 'quente') into v_negociacao_c;
  select public.criar_negociacao(v_cliente_a, v_funil_principal, 4000.00, 'frio')   into v_negociacao_h;
  select public.criar_negociacao(v_cliente_s2, v_funil_principal, 5000.00, 'morno') into v_negociacao_s2;
  select public.criar_negociacao(v_cliente_s3, v_funil_principal, 5000.00, 'morno') into v_negociacao_s3;
  select public.criar_negociacao(v_cliente_s4, v_funil_principal, 5000.00, 'morno') into v_negociacao_s4;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select count(*) into v_neg_antes from public.negociacoes;

  -- =========================================================================
  -- V1: aberta mostra valor_estimado na view; valor_vendido é nulo.
  -- =========================================================================
  select valor_estimado, valor_vendido into v_valor_estimado_view, v_valor_vendido_view
    from public.funil_cards where id = v_negociacao_a;
  assert v_valor_estimado_view = 7000.00, 'view deveria mostrar valor_estimado da negociação aberta';
  assert v_valor_vendido_view is null, 'view não deveria ter valor_vendido antes do fechamento';
  raise notice 'ok  V1  aberta: funil_cards mostra valor_estimado, valor_vendido nulo';

  -- Serviço já vinculado ANTES do fechamento, pra provar que S1 remove o que
  -- não está mais na lista final (não só adiciona).
  insert into public.negociacao_servicos (negociacao_id, servico_id) values (v_negociacao_a, v_servico_1);

  -- =========================================================================
  -- V2 + S1 + O1: fecha com valor vendido, 2 serviços (removendo o 1o,
  -- adicionando o 2o e o 3o) e observações.
  -- =========================================================================
  perform public.fechar_negociacao(
    v_negociacao_a, 1, 8500.00, current_date,
    true, true, 'pago', 'concluido', null,
    array[v_servico_2, v_servico_3], 'Cliente pediu desconto de 10% à vista.'
  );

  select valor_estimado, valor_vendido into v_valor_estimado_view, v_valor_vendido_view
    from public.funil_cards where id = v_negociacao_a;
  assert v_valor_vendido_view = 8500.00, 'view deveria mostrar valor_vendido depois do fechamento';
  assert v_valor_estimado_view = 7000.00, 'valor_estimado original não deveria ser sobrescrito';
  raise notice 'ok  V2  fechada: funil_cards mostra valor_vendido (valor_estimado original preservado)';

  select count(*) into v_qtd_servicos
    from public.negociacao_servicos where negociacao_id = v_negociacao_a;
  assert v_qtd_servicos = 2, format('deveriam sobrar exatamente 2 serviços vinculados, tem %s', v_qtd_servicos);
  assert not exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_a and servico_id = v_servico_1
  ), 'o serviço que saiu da lista final deveria ter sido removido';
  assert exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_a and servico_id = v_servico_2
  ) and exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_a and servico_id = v_servico_3
  ), 'os dois serviços novos deveriam estar vinculados';
  raise notice 'ok  S1  fechar_negociacao sincroniza negociacao_servicos (remove o antigo, adiciona os novos)';

  assert (select observacoes from public.fechamentos where negociacao_id = v_negociacao_a)
       = 'Cliente pediu desconto de 10% à vista.',
    'observacoes deveria estar gravada exatamente como enviada';
  raise notice 'ok  O1  fechamentos.observacoes gravada certa';

  -- funil_cards.servico_ids reflete os vínculos atuais (2 serviços, sem o antigo).
  assert (
    select servico_ids from public.funil_cards where id = v_negociacao_a
  ) @> array[v_servico_2, v_servico_3]
    and cardinality((select servico_ids from public.funil_cards where id = v_negociacao_a)) = 2,
    'funil_cards.servico_ids deveria refletir exatamente os 2 serviços atuais';
  raise notice 'ok  S1b funil_cards.servico_ids reflete os vínculos atuais, pronto pro modal pré-marcar';

  -- =========================================================================
  -- S2: fechar com os MESMOS serviços já vinculados preserva esses serviços
  -- — o cenário real do modal, que agora pré-marca via card.servicoIds. Isso
  -- prova que fechar sem MEXER nos checkboxes não apaga o que já existia.
  -- =========================================================================
  insert into public.negociacao_servicos (negociacao_id, servico_id) values
    (v_negociacao_s2, v_servico_1), (v_negociacao_s2, v_servico_2);

  perform public.fechar_negociacao(
    v_negociacao_s2, 1, 5500.00, current_date,
    false, false, 'pendente', 'nao_iniciado', null,
    array[v_servico_1, v_servico_2],  -- exatamente o que já estava vinculado
    null
  );

  select count(*) into v_qtd_servicos
    from public.negociacao_servicos where negociacao_id = v_negociacao_s2;
  assert v_qtd_servicos = 2, format('S2: deveriam continuar exatamente 2 serviços, tem %s', v_qtd_servicos);
  assert exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_s2 and servico_id = v_servico_1
  ) and exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_s2 and servico_id = v_servico_2
  ), 'S2: os dois serviços originais deveriam continuar vinculados';
  raise notice 'ok  S2  fechar com os mesmos serviços já marcados preserva esses serviços (não apaga por fechar)';

  -- =========================================================================
  -- S3: p_servico_ids = '{}' (vazio, explícito) sincroniza para ZERO serviços.
  -- =========================================================================
  insert into public.negociacao_servicos (negociacao_id, servico_id) values (v_negociacao_s3, v_servico_1);

  perform public.fechar_negociacao(
    v_negociacao_s3, 1, 6100.00, current_date,
    false, false, 'pendente', 'nao_iniciado', null,
    '{}'::uuid[], null
  );

  select count(*) into v_qtd_servicos
    from public.negociacao_servicos where negociacao_id = v_negociacao_s3;
  assert v_qtd_servicos = 0, format('S3: deveriam sobrar 0 serviços com array vazio explícito, tem %s', v_qtd_servicos);
  raise notice 'ok  S3  p_servico_ids = ''{}'' (vazio) sincroniza para zero serviços';

  -- =========================================================================
  -- S4: p_servico_ids = null é tratado IGUAL a '{}' — também ZERO serviços,
  -- nunca "preserva" (mesma semântica de salvar_negociacao()).
  -- =========================================================================
  insert into public.negociacao_servicos (negociacao_id, servico_id) values (v_negociacao_s4, v_servico_1);

  perform public.fechar_negociacao(
    v_negociacao_s4, 1, 6200.00, current_date,
    false, false, 'pendente', 'nao_iniciado', null,
    null, null
  );

  select count(*) into v_qtd_servicos
    from public.negociacao_servicos where negociacao_id = v_negociacao_s4;
  assert v_qtd_servicos = 0,
    format('S4: p_servico_ids = null deveria zerar os serviços (mesma semântica de ''{}''), tem %s', v_qtd_servicos);
  raise notice 'ok  S4  p_servico_ids = null tratado igual a ''{}'' — zero serviços, nunca "preserva"';

  -- =========================================================================
  -- V3: perdida continua usando valor_estimado (comportamento atual).
  -- =========================================================================
  update public.negociacoes
     set etapa_id = v_perdido_principal, motivo_perda = 'Motivo dry-run fechamento', posicao = 1
   where id = v_negociacao_b;

  select valor_estimado, valor_vendido into v_valor_estimado_view, v_valor_vendido_view
    from public.funil_cards where id = v_negociacao_b;
  assert v_valor_estimado_view = 3000.00, 'perdida deveria continuar mostrando valor_estimado';
  assert v_valor_vendido_view is null, 'perdida nunca deveria ter valor_vendido (nenhum fechamento existe)';
  raise notice 'ok  V3  perdida continua usando valor_estimado — comportamento inalterado';

  -- =========================================================================
  -- N1: mesmo fluxo (valor/serviço/observação) num SEGUNDO funil, na etapa
  -- ganha DELE (não a do Principal).
  -- =========================================================================
  perform public.fechar_negociacao(
    v_negociacao_c, 1, 9900.00, current_date,
    true, true, 'pendente', 'nao_iniciado', null,
    array[v_servico_1], 'Fechamento do funil novo.'
  );
  assert (
    select e.tipo from public.negociacoes n join public.etapas_funil e on e.id = n.etapa_id
     where n.id = v_negociacao_c
  ) = 'ganha', 'negociação do funil novo deveria estar na etapa ganha DELE';
  assert (
    select e.funil_id from public.negociacoes n join public.etapas_funil e on e.id = n.etapa_id
     where n.id = v_negociacao_c
  ) = v_funil_novo, 'a etapa ganha usada deveria pertencer ao funil novo, não ao Principal';
  select valor_vendido into v_valor_vendido_view from public.funil_cards where id = v_negociacao_c;
  assert v_valor_vendido_view = 9900.00, 'funil novo: valor_vendido também deveria aparecer na view';
  assert exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_c and servico_id = v_servico_1
  ), 'funil novo: serviço também deveria ter sido sincronizado';
  raise notice 'ok  N1  valor/serviços/observações funcionam igual num segundo funil, na etapa ganha certa';

  -- =========================================================================
  -- H1: histórico completo — Reunião agendada -> Proposta enviada ->
  -- Reunião agendada (repete) -> Perdido -> Recuperação -> Fechado.
  -- =========================================================================
  update public.negociacoes set etapa_id = v_etapa_proposta, posicao = 1 where id = v_negociacao_h;
  update public.negociacoes set etapa_id = v_etapa_reuniao,  posicao = 1 where id = v_negociacao_h; -- repete a etapa
  update public.negociacoes
     set etapa_id = v_perdido_principal, motivo_perda = 'Motivo dry-run histórico', posicao = 1
   where id = v_negociacao_h;
  update public.negociacoes set etapa_id = v_recuperacao_id, posicao = 1 where id = v_negociacao_h;
  perform public.fechar_negociacao(
    v_negociacao_h, 1, 4200.00, current_date,
    false, false, 'pendente', 'nao_iniciado'
  );

  select count(*) into v_hist_total from public.historico_etapas where negociacao_id = v_negociacao_h;
  assert v_hist_total = 6,
    format('deveriam existir 6 linhas de histórico (criação + 5 transições), vieram %s', v_hist_total);

  select array_agg(e.nome order by h.created_at, h.id) into v_hist_etapas
    from public.historico_etapas h
    join public.etapas_funil e on e.id = h.etapa_nova_id
   where h.negociacao_id = v_negociacao_h;
  assert v_hist_etapas[1] = 'Reunião agendada' and v_hist_etapas[2] = 'Proposta enviada'
     and v_hist_etapas[3] = 'Reunião agendada' and v_hist_etapas[4] = 'Perdido',
    format('sequência inicial do histórico errada: %s', v_hist_etapas);
  assert v_hist_etapas[5] = (select nome from public.etapas_funil where id = v_recuperacao_id),
    'a 5a transição deveria ser para a etapa de recuperação';
  assert v_hist_etapas[6] = (
    select e.nome from public.etapas_funil e where e.funil_id = v_funil_principal and e.tipo = 'ganha'
  ), 'a 6a e última transição deveria ser para Fechado (ganha) do Funil Principal';
  raise notice 'ok  H1  histórico completo preservado: %', array_to_string(v_hist_etapas, ' -> ');

  -- Timestamps não-decrescentes ao longo da cadeia (created_at sempre >= anterior).
  assert not exists (
    select 1
      from (
        select created_at,
               lag(created_at) over (order by created_at, id) as anterior
          from public.historico_etapas
         where negociacao_id = v_negociacao_h
      ) x
     where anterior is not null and created_at < anterior
  ), 'created_at do histórico deveria ser sempre crescente (nunca volta no tempo)';
  raise notice 'ok  H2  created_at do histórico é sempre crescente — dá pra calcular duração por diferença';

  -- =========================================================================
  -- X1: nenhuma negociação/card duplicado em nenhum dos testes acima.
  -- =========================================================================
  select count(*) into v_neg_depois from public.negociacoes;
  assert v_neg_depois = v_neg_antes,
    format('não deveria haver negociação/card novo além dos criados explicitamente (antes=%s depois=%s)',
           v_neg_antes, v_neg_depois);
  raise notice 'ok  X1  nenhuma negociação/card duplicado';

  raise notice 'TODOS OS TESTES DE VALOR/SERVICOS/OBSERVACOES/HISTORICO PASSARAM (V1-V3, S1, S1b, S2-S4, O1, N1, H1-H2, X1)';
end $$;

select 'OK — TODOS OS TESTES DE VALOR/SERVICOS/OBSERVACOES/HISTORICO PASSARAM' as resultado;

rollback;
