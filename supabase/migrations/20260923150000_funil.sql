-- ===========================================================================
-- Fase 4 — Funil Kanban.
--
-- 1. Campos do modal de fechamento que faltavam em `fechamentos`.
-- 2. `fechar_negociacao`: mover para "fechado" e gravar o fechamento na
--    mesma transação.
-- 3. View `funil_cards`: tudo o que um card mostra, numa consulta só.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Fechamentos.
--
-- `cancelado` entra no status de pagamento. `atrasado` continua existindo no
-- enum (remover valor de enum no Postgres exige recriar o tipo), mas o modal
-- de fechamento não o oferece.
-- ---------------------------------------------------------------------------
alter type public.status_pagamento add value if not exists 'cancelado';

-- Data de fechamento informada pelo closer, e não o carimbo técnico
-- `fechado_em`. O default só existe para preencher linhas antigas e é removido
-- em seguida: daqui em diante toda gravação precisa informar a data.
alter table public.fechamentos
  add column data_fechamento date not null
    default ((now() at time zone 'America/Sao_Paulo')::date),
  add column link_contrato text
    constraint fechamentos_link_contrato_http
      check (link_contrato is null or link_contrato ~* '^https?://\S+$');

alter table public.fechamentos
  alter column data_fechamento drop default;

create index fechamentos_data_fechamento_idx
  on public.fechamentos (data_fechamento desc);

-- ---------------------------------------------------------------------------
-- 2. Fechar negociação.
--
-- O constraint trigger `negociacoes_exige_fechamento` já impede que uma
-- negociação fique em "fechado" sem fechamento. Esta função só junta as duas
-- escritas numa transação, para a aplicação não ter como deixar uma pela
-- metade.
--
-- Upsert porque uma negociação reaberta (tirada de "fechado") mantém o
-- registro antigo; ao fechar de novo, os dados são substituídos.
--
-- SECURITY INVOKER: a RLS de negociacoes e fechamentos vale para quem chama.
-- Closer que tente fechar negociação alheia não enxerga a linha (0 linhas no
-- UPDATE) e recebe "não encontrada".
-- ---------------------------------------------------------------------------
create or replace function public.fechar_negociacao(
  p_negociacao_id      uuid,
  p_posicao            numeric,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.negociacoes
     set etapa = 'fechado',
         posicao = p_posicao
   where id = p_negociacao_id;

  if not found then
    raise exception 'Negociação não encontrada.'
      using errcode = 'P0002';
  end if;

  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado,
    contrato_assinado, link_contrato, status_pagamento, status_onboarding
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
end;
$$;

comment on function public.fechar_negociacao is
  'Move a negociação para "fechado" e grava o fechamento na mesma transação.';

revoke all on function public.fechar_negociacao from public, anon;
grant execute on function public.fechar_negociacao to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cards do funil.
--
-- `security_invoker = true` faz a view respeitar a RLS de quem consulta — sem
-- isso ela rodaria como o dono (postgres) e mostraria o funil inteiro para um
-- closer. É a linha mais importante deste arquivo.
--
-- Próxima ação: o próximo evento agendado da negociação (ou do cliente, se o
-- evento não estiver ligado a uma negociação).
-- Último contato: a atividade de contato mais recente (qualquer tipo menos
-- nota) ou o último evento realizado, o que for mais novo.
-- ---------------------------------------------------------------------------
create view public.funil_cards
with (security_invoker = true)
as
select
  n.id,
  n.etapa,
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
  pa.tipo           as proxima_acao_tipo,
  pa.inicio         as proxima_acao_inicio,
  uc.em             as ultimo_contato_em,
  uc.tipo           as ultimo_contato_tipo
from public.negociacoes n
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
left join public.profiles p
  on p.id = n.owner_id
left join lateral (
  select e.titulo, e.tipo, e.inicio
  from public.eventos e
  where e.status = 'agendado'
    and e.inicio >= now()
    and (
      e.negociacao_id = n.id
      or (e.negociacao_id is null and e.cliente_id = n.cliente_id)
    )
  order by e.inicio
  limit 1
) pa on true
left join lateral (
  select x.em, x.tipo
  from (
    select a.created_at as em, a.tipo::text as tipo
    from public.atividades a
    where a.cliente_id = n.cliente_id
      and a.tipo <> 'nota'
    union all
    select e.inicio as em, e.tipo::text as tipo
    from public.eventos e
    where e.status = 'realizado'
      and e.inicio <= now()
      and (
        e.negociacao_id = n.id
        or (e.negociacao_id is null and e.cliente_id = n.cliente_id)
      )
  ) x
  order by x.em desc
  limit 1
) uc on true;

comment on view public.funil_cards is
  'Um card do Kanban por negociação. security_invoker: respeita a RLS.';

revoke all on public.funil_cards from anon;
grant select on public.funil_cards to authenticated;
