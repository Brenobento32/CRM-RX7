-- ===========================================================================
-- Teste de fumaça de `public.funil_metricas` (migration
-- 20261015100000_funil_metricas_entidade_unica.sql).
--
-- AUTO-INSTALAÇÃO TRANSACIONAL (a produção ainda tem a versão ANTIGA —
-- esta migration não foi aplicada):
--   BEGIN
--     -> instala a NOVA versão de public.funil_metricas (DROP + CREATE +
--        COMMENT + REVOKE + GRANT, EXATAMENTE copiados, sem nenhuma
--        diferença, de
--        supabase/migrations/20261015100000_funil_metricas_entidade_unica.sql
--        — se um dos dois arquivos mudar, atualize o outro)
--     -> cria os fixtures de teste
--     -> roda os asserts contra a função recém-instalada
--   ROLLBACK
--     -> DDL é transacional no Postgres: o ROLLBACK desfaz o DROP+CREATE
--        junto com os dados — a função volta a ser exatamente a antiga
--        (mesmo corpo, mesmos grants), como se nada tivesse acontecido.
--
--   Isso prova o CORPO da nova RPC contra o Postgres real de produção sem
--   persistir nada — nem a função nova, nem os fixtures.
--
-- CUIDADO DE CONCORRÊNCIA (não é destrutivo, mas é real): enquanto esta
--   transação está aberta (do BEGIN ao ROLLBACK), o DROP FUNCTION toma um
--   lock em public.funil_metricas que pode bloquear, por alguns
--   milissegundos, uma chamada REAL e concorrente de outro usuário em
--   /funil/metricas. O teste é rápido (cria ~10 negociações e roda os
--   asserts) e nada fica inconsistente — nenhuma outra sessão enxerga a
--   função nova nem o estado intermediário, isolamento de transação
--   padrão — mas, se possível, rode fora do horário de pico.
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. Ele
--   instala a função nova, cria um usuário, três funis de teste e uma
--   dezena de negociações cobrindo os casos de borda decididos na
--   especificação, faz as asserções e dá ROLLBACK no final: nada é
--   gravado, nem a função, nem os dados. Se alguma asserção falhar, a
--   execução para com erro, apontando exatamente qual regra quebrou.
--
--   Roda como `postgres` (superusuário) — bypassa RLS de propósito: este
--   teste prova a MATEMÁTICA da função, não visibilidade por papel (isso já
--   é coberto por rls_smoke_test.sql). Superusuário bypassa RLS, mas NUNCA
--   bypassa TRIGGER — por isso o script concede ao usuário de teste as
--   linhas de `permissoes_colaborador` que ele precisaria ter de verdade
--   pra mover essas negociações (trigger
--   `negociacoes_protege_movimentacao_por_permissao`, 20261014170000) e
--   impersona esse usuário via `set_config('request.jwt.claims', ...)`
--   (mesma técnica de rls_smoke_test.sql) — nenhuma regra de permissão é
--   relaxada, só concedida a quem precisa, nas etapas que precisa.
--
-- O QUE ELE PROVA (mapeado 1:1 na especificação aprovada)
--   1. Coorte = criadas no período, nunca reclassificada por avanço depois.
--   2. Entidade única / retorno: entrar 2x na mesma etapa conta 1.
--   3. Pulo de etapa: sem inferência — etapa pulada nunca é creditada.
--   4. Arquivamento: conta no histórico, nunca em "atual".
--   5. Exclusão (excluida_em): mesmo tratamento do arquivamento.
--   6. Cliente excluído (deleted_at): conta no histórico, nunca em "atual"
--      (Alternativa B, decisão definitiva).
--   7. Perdido -> Recuperação: perdido não desaparece da contagem.
--   8. Perdido deduplicado: 2 entradas em perdida no período = 1 contagem,
--      valor não duplica.
--   9. Ganhos sobrevivem arquivamento: venda histórica real nunca some do
--      financeiro por causa de um arquivamento posterior.
--   10. Zero leads: funil vazio não erra, só zera.
--   11. Dois funis: números nunca se misturam.
--   12. Dois períodos / "entrou fora, avançou dentro": coortes independentes.
--   13. Evolução até o momento: avanço depois do fim do período de entrada
--       ainda é contado em `alcancaram`.
-- ===========================================================================

begin;

-- ===========================================================================
-- Instalação temporária da nova versão (cópia EXATA de
-- supabase/migrations/20261015100000_funil_metricas_entidade_unica.sql,
-- linha por linha — nenhuma lógica diferente). DDL comum, transacional:
-- desfeita pelo ROLLBACK no fim do arquivo, junto com os fixtures.
-- ===========================================================================

drop function if exists public.funil_metricas(date, date, uuid);

create function public.funil_metricas(
  p_inicio    date,
  p_fim       date,
  p_funil_id  uuid
)
returns table (
  etapa_id                uuid,
  nome                    text,
  cor                     public.cor_etapa,
  tipo                    public.tipo_etapa,
  ordem                   numeric,
  pos_fechamento          boolean,
  quantidade              bigint,
  valor                   numeric,
  alcancaram              bigint,
  tempo_medio_segundos    numeric,
  permanencias            bigint,
  parados_medio_segundos  numeric,
  parados_7_dias          bigint,
  total_entraram          bigint
)
language sql
stable
set search_path = ''
as $$
  with
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  ),

  -- BASE HISTÓRICA: toda negociação do funil, sem nenhuma exclusão por
  -- estado de limpeza de cadastro. Usada por tudo que é histórico: coorte,
  -- alcance, ganhos, perdidos, tempo por etapa.
  historico_base as (
    select n.*
    from public.negociacoes n
    where n.funil_id = p_funil_id
  ),

  -- BASE ATUAL: só oportunidades vivas agora. Única CTE que exclui cliente
  -- excluído e negociação arquivada/excluída.
  atuais_base as (
    select n.*
    from historico_base n
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.arquivada_em is null
      and n.excluida_em is null
  ),

  -- Só etapas abertas: ganha e perdida têm CTEs históricas próprias
  -- abaixo, que nunca somem por arquivamento/exclusão posterior.
  atuais as (
    select
      n.etapa_id,
      count(*) as qtd,
      sum(n.valor_estimado) as valor,
      avg(extract(epoch from now() - n.data_entrada_etapa)) as parados,
      count(*) filter (where n.data_entrada_etapa < now() - interval '7 days') as parados_7
    from atuais_base n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta'
    group by n.etapa_id
  ),

  -- Coorte: toda negociação (histórica, sem exclusões) criada no período.
  -- Fixa para sempre — nunca reclassificada por avanço posterior.
  coorte as (
    select n.id
    from historico_base n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),

  total_entraram as (
    select count(*) as total from coorte
  ),

  -- Alcance = evolução da coorte ATÉ AGORA. EXISTS real em
  -- historico_etapas, sem filtro de data e sem inferência por ordem —
  -- pular etapa nunca credita a etapa pulada.
  alcancaram as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id
    group by h.etapa_nova_id
  ),

  -- Ganhos no período: venda histórica real (fechamentos.data_fechamento),
  -- sobre a base histórica completa — nunca apaga uma venda já realizada
  -- por causa de um arquivamento/exclusão posterior da negociação.
  -- fechamentos é 1:1 com negociacao_id: sem necessidade de deduplicar.
  ganhos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'ganha') as etapa_id,
      count(*) as qtd,
      sum(f.valor_vendido) as valor
    from public.fechamentos f
    join historico_base n on n.id = f.negociacao_id
    where f.data_fechamento between p_inicio and p_fim
  ),

  -- Perdidos no período: entrada real em etapa perdida (evento), sobre a
  -- base histórica completa. Deduplicado por negociação ANTES de agregar
  -- valor — count() e sum() sempre leem o mesmo conjunto, mesmo que a
  -- negociação tenha entrado em perdida mais de uma vez no período.
  --
  -- `valor` aqui é negociacoes.valor_estimado — campo ATUAL, sem
  -- histórico de alterações (o schema não guarda snapshot por data).
  -- É uma aproximação, nunca o valor real no momento da perda: a UI
  -- NUNCA deve apresentá-lo como indicador financeiro confiável sem
  -- rotulá-lo como estimado/aproximado.
  negociacoes_perdidas_periodo as (
    select distinct h.negociacao_id
    from public.historico_etapas h
    join public.etapas_funil e on e.id = h.etapa_nova_id
    cross join periodo
    where e.funil_id = p_funil_id
      and e.tipo = 'perdida'
      and h.created_at >= periodo.inicio
      and h.created_at <  periodo.fim
  ),
  perdidos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'perdida') as etapa_id,
      count(*) as qtd,
      sum(n.valor_estimado) as valor
    from negociacoes_perdidas_periodo p
    join historico_base n on n.id = p.negociacao_id
  ),

  -- Tempo por etapa: permanência real sobre a base histórica completa.
  estadias as (
    select
      h.etapa_nova_id as etapa_id,
      h.created_at as entrada,
      lead(h.created_at) over (
        partition by h.negociacao_id order by h.created_at, h.id
      ) as saida
    from public.historico_etapas h
    join historico_base n on n.id = h.negociacao_id
  ),
  tempos as (
    select
      s.etapa_id,
      avg(extract(epoch from s.saida - s.entrada)) as media,
      count(*) as n
    from estadias s, periodo
    where s.saida is not null
      and s.saida >= periodo.inicio
      and s.saida <  periodo.fim
    group by s.etapa_id
  )

  select
    e.id,
    e.nome,
    e.cor,
    e.tipo,
    e.ordem,
    e.pos_fechamento,
    case e.tipo
      when 'perdida' then coalesce(pp.qtd, 0)
      when 'ganha'   then coalesce(gp.qtd, 0)
      else                coalesce(a.qtd, 0)
    end,
    case e.tipo
      when 'perdida' then coalesce(pp.valor, 0)
      when 'ganha'   then coalesce(gp.valor, 0)
      else                coalesce(a.valor, 0)
    end,
    coalesce(al.qtd, 0),
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0),
    (select total from total_entraram)
  from public.etapas_funil e
  left join atuais           a  on a.etapa_id = e.id
  left join alcancaram       al on al.etapa_id = e.id
  left join ganhos_periodo   gp on gp.etapa_id = e.id
  left join perdidos_periodo pp on pp.etapa_id = e.id
  left join tempos           t  on t.etapa_id = e.id
  where e.ativo
    and e.funil_id = p_funil_id
  order by e.ordem;
$$;

comment on function public.funil_metricas is
  'Métricas por etapa ativa de UM funil, entidade única. Coorte = criadas '
  'no período (toda negociação, sem exclusão de arquivada/excluída/'
  'cliente-excluído). Alcançaram = EXISTS real em historico_etapas, '
  'evolução até o momento da consulta (nunca truncado pelo período, nunca '
  'inferido por etapa pulada). Ganhos = venda real por '
  'fechamentos.data_fechamento, sobre o histórico completo. Perdidos = '
  'entrada real em etapa perdida no período, deduplicada por negociação '
  'antes de somar valor_estimado (aproximado, sem histórico de valor). '
  'Atual (quantidade/valor/parados de etapas abertas) é a ÚNICA parte que '
  'exclui arquivada/excluída/cliente-excluído. SECURITY INVOKER.';

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;

-- ===========================================================================
-- Fixtures + asserts.
-- ===========================================================================

do $$
declare
  v_usuario uuid := 'a1111111-1111-1111-1111-111111111111';

  v_funil1_id         uuid;
  v_etapa_lead_novo   uuid;
  v_etapa_reuniao     uuid;
  v_etapa_fechado     uuid;
  v_etapa_perdido     uuid;
  v_etapa_recuperacao uuid;

  v_funil2_id    uuid;
  v_etapa2_aberta uuid;

  v_funil3_id uuid; -- funil vazio, pro caso "zero leads"

  v_cliente_a uuid; v_neg_a uuid;
  v_cliente_b uuid; v_neg_b uuid;
  v_cliente_c uuid; v_neg_c uuid;
  v_cliente_d uuid; v_neg_d uuid;
  v_cliente_e uuid; v_neg_e uuid;
  v_cliente_f uuid; v_neg_f uuid;
  v_cliente_g uuid; v_neg_g uuid;
  v_cliente_h uuid; v_neg_h uuid;
  v_cliente_i uuid; v_neg_i uuid;
  v_cliente_x uuid; v_neg_x uuid; -- outro funil

  r_lead_novo   record;
  r_reuniao     record;
  r_fechado     record;
  r_perdido     record;
  r_recuperacao record;
  r             record;
  v_total       integer;
begin
  -- -------------------------------------------------------------------
  -- 0. Massa de teste: usuário, 3 funis.
  -- -------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    v_usuario, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'teste.funil.metricas@teste.local', '', now(), now(), now(),
    '{}'::jsonb, '{"nome":"Closer Teste Métricas"}'::jsonb
  );

  insert into public.funis (nome, padrao) values ('Teste funil_metricas 1', false)
    returning id into v_funil1_id;
  insert into public.funis (nome, padrao) values ('Teste funil_metricas 2', false)
    returning id into v_funil2_id;
  insert into public.funis (nome, padrao) values ('Teste funil_metricas vazio', false)
    returning id into v_funil3_id;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Lead Novo', 'turquesa', 500, 'aberta') returning id into v_etapa_lead_novo;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Reunião', 'azul', 1000, 'aberta') returning id into v_etapa_reuniao;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Fechado', 'verde', 100000, 'ganha') returning id into v_etapa_fechado;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Perdido', 'vermelho', 100001, 'perdida') returning id into v_etapa_perdido;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento) values
    (v_funil1_id, 'Recuperação', 'cinza', 100002, 'aberta', true) returning id into v_etapa_recuperacao;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil2_id, 'Aberta', 'azul', 1000, 'aberta') returning id into v_etapa2_aberta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil2_id, 'Fechado', 'verde', 100000, 'ganha');
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil2_id, 'Perdido', 'vermelho', 100001, 'perdida');

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil3_id, 'Única', 'azul', 1000, 'aberta');
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil3_id, 'Fechado', 'verde', 100000, 'ganha');
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil3_id, 'Perdido', 'vermelho', 100001, 'perdida');

  -- Caso X: outro funil (funil2), período 1 — prova que os números de um
  -- funil nunca aparecem no resultado do outro. Fica ANTES do `set_config`
  -- de impersonação (abaixo) de propósito: desde
  -- 20261015110000_criacao_manual_sdr_e_integridade_cliente.sql, todo INSERT
  -- em `negociacoes` passa por `negociacoes_protege_criacao_por_permissao`,
  -- que só deixa passar automação (auth.uid() null) ou quem tem
  -- `pode_mover_etapa` na etapa de destino — e `v_usuario` (impersonado
  -- abaixo) deliberadamente não tem NENHUMA permissão em v_funil2_id (ver
  -- comentário da seção 0b). Isto não é teste de permissão — é só massa de
  -- dados para provar isolamento entre funis em `funil_metricas` — por isso
  -- é criado como automação, antes de qualquer impersonação, exatamente como
  -- o restante da massa de dados desta função.
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente X', v_usuario)
    returning id into v_cliente_x;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_x, v_etapa2_aberta)
    returning id into v_neg_x;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_x;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_x;

  -- -------------------------------------------------------------------
  -- 0b. Permissão comercial do usuário de teste.
  --
  -- `v_usuario` é 'closer' (role padrão do trigger de criação de profile,
  -- raw_app_meta_data vazio) — então toda UPDATE de etapa_id passa pelo
  -- trigger `negociacoes_protege_movimentacao_por_permissao`
  -- (20261014170000), que exige `pode_mover_etapa(funil_id, etapa_destino)`
  -- pra quem não é gerente. `pode_mover_etapa`/`is_gerente` leem
  -- `auth.uid()` — e este script roda como `postgres` (superusuário:
  -- ignora RLS, mas NUNCA ignora trigger), sem nenhuma sessão JWT, então
  -- `auth.uid()` seria NULL sem o `set_config` abaixo.
  --
  -- Em vez de usar gerente (que bypassa esse E o trigger de handoff numa
  -- tacada só, mascarando bug), concedemos exatamente as linhas de
  -- `permissoes_colaborador` que o fluxo real exigiria: acesso ao funil de
  -- teste (linha com etapa_id null) + pode_ver/pode_mover=true em CADA
  -- etapa que os cenários abaixo de fato movimentam (as 5 etapas de
  -- v_funil1_id — nenhuma etapa de v_funil2_id/v_funil3_id, que nunca são
  -- alvo de UPDATE de etapa_id nos cenários). Nenhuma regra do sistema é
  -- relaxada: é a MESMA permissão que um closer real precisaria ter pra
  -- fazer essas movimentações de verdade.
  -- -------------------------------------------------------------------
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values (v_usuario, v_funil1_id, null, null, null, v_usuario);

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values
    (v_usuario, v_funil1_id, v_etapa_lead_novo,   true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_reuniao,     true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_fechado,     true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_perdido,     true, true, v_usuario),
    (v_usuario, v_funil1_id, v_etapa_recuperacao, true, true, v_usuario);

  -- Impersona v_usuario pro resto da transação (reverte sozinho no ROLLBACK
  -- final) — mesma técnica de rls_smoke_test.sql. A partir daqui,
  -- auth.uid() = v_usuario em qualquer função que o leia.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);

  -- -------------------------------------------------------------------
  -- Caso A: entra em Lead Novo, nunca avança. Período 1 (jan/2024).
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente A', v_usuario)
    returning id into v_cliente_a;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_a, v_etapa_lead_novo)
    returning id into v_neg_a;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_a;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_a;

  -- -------------------------------------------------------------------
  -- Caso B: Lead Novo -> Reunião -> Lead Novo -> Reunião (retorno à mesma
  -- etapa duas vezes cada). Entidade única: "alcançaram" de cada etapa
  -- tem que contar 1, nunca 2.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente B', v_usuario)
    returning id into v_cliente_b;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_b, v_etapa_lead_novo)
    returning id into v_neg_b;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_b;
  update public.negociacoes set etapa_id = v_etapa_lead_novo where id = v_neg_b;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_b;
  update public.negociacoes set created_at = '2024-01-11' where id = v_neg_b;
  update public.historico_etapas set created_at = '2024-01-11' where negociacao_id = v_neg_b;

  -- -------------------------------------------------------------------
  -- Caso C: Lead Novo -> Fechado DIRETO, pulando Reunião. Sem inferência:
  -- "alcançaram" de Reunião NUNCA pode contar C. Depois de vendida, a
  -- negociação é arquivada — a venda tem que sobreviver no financeiro.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente C', v_usuario)
    returning id into v_cliente_c;
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cliente_c, v_etapa_lead_novo, 1000)
    returning id into v_neg_c;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_c, 9000, '2024-01-15', true, true, 'pago', 'concluido', v_usuario, 'tcv'
  );
  update public.negociacoes set etapa_id = v_etapa_fechado where id = v_neg_c;
  execute 'set constraints all immediate'; -- força checar já "ganha exige fechamento" (deve passar)
  execute 'set constraints all deferred';
  update public.negociacoes set created_at = '2024-01-12' where id = v_neg_c;
  update public.historico_etapas set created_at = '2024-01-12' where negociacao_id = v_neg_c;
  -- Arquivada DEPOIS de vendida — a venda já aconteceu, não pode desaparecer.
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste: arquivada após venda'
    where id = v_neg_c;

  -- -------------------------------------------------------------------
  -- Caso D: Lead Novo -> Perdido -> Recuperação -> Perdido DE NOVO, tudo
  -- no mesmo período. Perdido tem que contar 1 (deduplicado), nunca 2;
  -- Recuperação é zona separada, tem sua própria contagem.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente D', v_usuario)
    returning id into v_cliente_d;
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cliente_d, v_etapa_lead_novo, 2000)
    returning id into v_neg_d;
  update public.negociacoes set etapa_id = v_etapa_perdido, motivo_perda = 'teste' where id = v_neg_d;
  update public.negociacoes set etapa_id = v_etapa_recuperacao where id = v_neg_d;
  update public.negociacoes set etapa_id = v_etapa_perdido, motivo_perda = 'teste de novo' where id = v_neg_d;
  update public.negociacoes set created_at = '2024-01-13' where id = v_neg_d;
  update public.historico_etapas set created_at = '2024-01-13' where negociacao_id = v_neg_d;

  -- -------------------------------------------------------------------
  -- Caso E: alcança Reunião e é arquivada. Conta no histórico, não em
  -- "atual".
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente E', v_usuario)
    returning id into v_cliente_e;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_e, v_etapa_lead_novo)
    returning id into v_neg_e;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_e;
  update public.negociacoes set created_at = '2024-01-14' where id = v_neg_e;
  update public.historico_etapas set created_at = '2024-01-14' where negociacao_id = v_neg_e;
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste: desqualificado'
    where id = v_neg_e;

  -- -------------------------------------------------------------------
  -- Caso F: alcança Reunião e é excluída (arquivada + excluída). Mesmo
  -- tratamento de E.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente F', v_usuario)
    returning id into v_cliente_f;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_f, v_etapa_lead_novo)
    returning id into v_neg_f;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_f;
  update public.negociacoes set created_at = '2024-01-15' where id = v_neg_f;
  update public.historico_etapas set created_at = '2024-01-15' where negociacao_id = v_neg_f;
  update public.negociacoes
     set arquivada_em = now(), motivo_arquivamento = 'teste',
         excluida_em = now(), excluida_por = v_usuario, motivo_exclusao = 'teste: exclusão definitiva'
   where id = v_neg_f;

  -- -------------------------------------------------------------------
  -- Caso G: alcança Reunião; a negociação em si nunca é tocada (campos de
  -- arquivamento próprios ficam null), mas o CLIENTE é excluído (deleted_at)
  -- depois. Alternativa B: conta no histórico, some só de "atual".
  --
  -- FIXTURE ATUALIZADA (achado desta rodada, não é regressão de
  -- `funil_metricas`): desde 20261015110000_criacao_manual_sdr_e_integridade_
  -- cliente.sql, o trigger `clientes_protege_arquivamento_com_negociacao_
  -- ativa` bloqueia `clientes.deleted_at` virar not null enquanto existir
  -- negociação não arquivada/excluída daquele cliente — de propósito,
  -- backstop contra "negociação ativa presa a cliente arquivado". Esta
  -- fixture tentava excluir o cliente com a negociação ainda aberta, estado
  -- que o próprio banco não permite mais alcançar (nem pela UI, nem por SQL
  -- direto) — por isso arquivamos a negociação ANTES de excluir o cliente,
  -- preservando a pergunta original do teste ("histórico nunca some por
  -- cliente excluído") sob o único caminho que o banco hoje de fato permite.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente G', v_usuario)
    returning id into v_cliente_g;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_g, v_etapa_lead_novo)
    returning id into v_neg_g;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_g;
  update public.negociacoes set created_at = '2024-01-16' where id = v_neg_g;
  update public.historico_etapas set created_at = '2024-01-16' where negociacao_id = v_neg_g;
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste: cliente será excluído a seguir'
   where id = v_neg_g;
  update public.clientes set deleted_at = now() where id = v_cliente_g;

  -- -------------------------------------------------------------------
  -- Caso H: criada FORA do período 1 (fev/2024), avança DENTRO do mesmo
  -- mês (fev). Prova coorte por created_at + independência entre períodos.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente H', v_usuario)
    returning id into v_cliente_h;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_h, v_etapa_lead_novo)
    returning id into v_neg_h;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_h;
  update public.negociacoes set created_at = '2024-02-05' where id = v_neg_h;
  update public.historico_etapas set created_at = '2024-02-05' where negociacao_id = v_neg_h;

  -- -------------------------------------------------------------------
  -- Caso I: criada no período 1 (jan/2024), mas avança para Reunião só em
  -- março — "conversão da coorte, evolução até o momento". Consultando
  -- com o período 1, `alcancaram` de Reunião TEM que incluir I mesmo
  -- assim.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente I', v_usuario)
    returning id into v_cliente_i;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente_i, v_etapa_lead_novo)
    returning id into v_neg_i;
  update public.negociacoes set etapa_id = v_etapa_reuniao where id = v_neg_i;
  update public.negociacoes set created_at = '2024-01-20' where id = v_neg_i;
  update public.historico_etapas set created_at = '2024-01-20'
    where negociacao_id = v_neg_i and etapa_nova_id = v_etapa_lead_novo;
  update public.historico_etapas set created_at = '2024-03-05'
    where negociacao_id = v_neg_i and etapa_nova_id = v_etapa_reuniao;

  -- Caso X (outro funil) já foi criado mais acima, ANTES da impersonação —
  -- ver comentário na seção 0.

  -- =====================================================================
  -- ASSERÇÕES — funil 1, período 1 (jan/2024).
  -- Coorte: A, B, C, D, E, F, G, I = 8. (H é fev; X é outro funil.)
  -- =====================================================================
  select * into r_lead_novo   from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Lead Novo';
  select * into r_reuniao     from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Reunião';
  select * into r_fechado     from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Fechado';
  select * into r_perdido     from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Perdido';
  select * into r_recuperacao from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Recuperação';

  -- 1. Coorte / total_entraram: só quem foi CRIADO em janeiro (A,B,C,D,E,F,G,I) — H (fev) fora.
  assert r_lead_novo.total_entraram = 8,
    format('total_entraram deveria ser 8 (A,B,C,D,E,F,G,I), veio %s', r_lead_novo.total_entraram);

  -- 2/3. Entidade única + pulo de etapa: Reunião foi alcançada por
  -- B, E, F, G, I (5) — nunca por A (nunca saiu de Lead Novo), nunca por C
  -- (pulou direto pra Fechado, sem inferência), nunca por D (foi pra
  -- Perdido/Recuperação, nunca passou por Reunião). B conta 1, mesmo tendo
  -- entrado em Reunião duas vezes (retorno).
  assert r_reuniao.alcancaram = 5,
    format('alcancaram(Reunião) deveria ser 5 (B,E,F,G,I), veio %s', r_reuniao.alcancaram);

  -- 4/5/6. Arquivamento/exclusão/cliente excluído: E, F e G alcançaram
  -- Reunião (contam no histórico acima) mas NUNCA aparecem em "atual" —
  -- B, H e I continuam válidas e atualmente em Reunião (3). H entrou em
  -- fevereiro, mas "atuais" é estado presente, SEM filtro de período —
  -- por isso ela conta aqui mesmo consultando o período de janeiro.
  assert r_reuniao.quantidade = 3,
    format('quantidade atual de Reunião deveria ser 3 (B, H, I — E/F/G excluídos), veio %s', r_reuniao.quantidade);

  -- 9. Ganhos sobrevivem arquivamento: C foi vendida (R$ 9000) e arquivada
  -- DEPOIS — o financeiro histórico não pode apagar a venda.
  assert r_fechado.quantidade = 1 and r_fechado.valor = 9000,
    format('Fechado deveria ter 1 venda de 9000 (sobrevive ao arquivamento de C), veio qtd=%s valor=%s',
      r_fechado.quantidade, r_fechado.valor);
  assert r_fechado.alcancaram = 1, format('alcancaram(Fechado) deveria ser 1 (C), veio %s', r_fechado.alcancaram);

  -- 7/8. Perdido: D entrou em Perdido DUAS vezes no período — tem que
  -- contar 1 (não 2), e o valor (2000, de D) não pode dobrar para 4000.
  assert r_perdido.quantidade = 1 and r_perdido.valor = 2000,
    format('Perdido deveria ter 1 negociação (D, deduplicada) de valor 2000, veio qtd=%s valor=%s',
      r_perdido.quantidade, r_perdido.valor);
  assert r_perdido.alcancaram = 1, format('alcancaram(Perdido) deveria ser 1 (D), veio %s', r_perdido.alcancaram);

  -- Recuperação é zona separada: D também alcançou Recuperação, com sua
  -- própria contagem — independente de Perdido.
  assert r_recuperacao.alcancaram = 1,
    format('alcancaram(Recuperação) deveria ser 1 (D), veio %s', r_recuperacao.alcancaram);
  assert r_recuperacao.pos_fechamento is true, 'Recuperação deveria vir com pos_fechamento = true';

  -- =====================================================================
  -- 13. Evolução até o momento: I entrou em janeiro, só alcançou Reunião
  -- em março — mas consultando com o período de janeiro, I já está
  -- contado no alcancaram(Reunião) acima (5, não 4). Confirma de novo,
  -- isolado, pra deixar explícito o que está sendo provado.
  -- =====================================================================
  select count(*) into v_total
    from public.historico_etapas h
   where h.negociacao_id = v_neg_i
     and h.etapa_nova_id = v_etapa_reuniao
     and h.created_at > '2024-01-31'; -- a entrada real de I em Reunião é em março
  assert v_total = 1, 'a entrada de I em Reunião deveria estar fora do período 1 (março), por construção do teste';
  -- ... e MESMO ASSIM r_reuniao.alcancaram (acima) já inclui I: a asserção
  -- "alcancaram(Reunião) = 5" só fecha com I contado, ela já prova o ponto.

  -- =====================================================================
  -- 10. Zero leads: funil vazio não erra, só zera.
  -- =====================================================================
  for r in select * from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) loop
    assert r.quantidade = 0 and r.alcancaram = 0 and r.total_entraram = 0,
      format('funil vazio deveria ter tudo zero na etapa %s, veio qtd=%s alcancaram=%s total=%s',
        r.nome, r.quantidade, r.alcancaram, r.total_entraram);
  end loop;

  -- =====================================================================
  -- 11. Dois funis nunca se misturam: funil2 (só X) não pode aparecer no
  -- resultado do funil1, e vice-versa.
  -- =====================================================================
  select total_entraram into v_total
    from public.funil_metricas('2024-01-01', '2024-01-31', v_funil2_id)
   where nome = 'Aberta';
  assert v_total = 1, format('total_entraram do funil2 deveria ser 1 (só X), veio %s', v_total);

  -- O funil1 continua em 8 mesmo com X existindo em outro funil no mesmo período.
  assert r_lead_novo.total_entraram = 8, 'total_entraram do funil1 não pode mudar por causa de outro funil';

  -- =====================================================================
  -- 12. Dois períodos independentes: consultando funil1 no período de
  -- fevereiro, só H entra na coorte (1), e ele já alcançou Reunião.
  -- =====================================================================
  select * into r from public.funil_metricas('2024-02-01', '2024-02-29', v_funil1_id) where nome = 'Reunião';
  assert r.total_entraram = 1, format('total_entraram de fevereiro deveria ser 1 (só H), veio %s', r.total_entraram);
  assert r.alcancaram = 1, format('alcancaram(Reunião) de fevereiro deveria ser 1 (H), veio %s', r.alcancaram);

  raise notice 'funil_metricas_test.sql: todas as asserções passaram.';
end;
$$;

rollback;

-- ===========================================================================
-- Depois deste ROLLBACK (DDL é transacional no Postgres, igual dado):
--   - public.funil_metricas volta a ser EXATAMENTE a função antiga (mesmo
--     corpo, mesmos grants) — o DROP+CREATE+GRANT/REVOKE de cima é desfeito.
--   - Nenhum fixture permanece: usuário, funis, etapas, clientes,
--     negociações, fechamentos, historico_etapas, permissoes_colaborador —
--     tudo criado acima desaparece junto.
--   - Nenhum lead/negociação real foi tocado — todos os IDs usados são
--     gerados ad-hoc dentro desta mesma transação (gen_random_uuid()/
--     `returning id`), nunca um ID pré-existente.
--   - Nenhuma policy ou trigger foi alterada, desabilitada ou ignorada em
--     nenhum momento — só a função em si foi trocada, temporariamente, e
--     os triggers de permissão/handoff continuaram disparando normalmente
--     contra ela durante o teste (prova disso: o próprio fixture precisou
--     de permissoes_colaborador pra passar).
--   - Nenhuma migration foi registrada em supabase_migrations.schema_migrations
--     — isso só aconteceria com um push real, que não rodou.
-- ===========================================================================
