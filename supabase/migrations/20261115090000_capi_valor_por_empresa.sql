set client_encoding = 'UTF8';
-- ===========================================================================
-- PROPOSTA, NÃO APLICADA: valor real da venda aprovado POR EMPRESA, e venda
-- sem valor válido retida para correção (nunca sai como conversão sem valor).
-- Depende de 20261113090100 (venda fechada). Usada com 20261115090100 (entrada, oposição e corte),
-- 20261115090200 (recuperação controlada) e 20261115090300 (três eventos da Rio X7).
--
-- Valor informado à Meta (inalterado em relação ao Pacote 13):
--   - SEMPRE fechamentos.valor_vendido do fechamento válido (não anulado),
--     exatamente como registrado, em BRL;
--   - a modalidade do fechamento (fechamentos.tipo_venda) diz o que é esse valor:
--       tcv   -> valor total do contrato;
--       mrr   -> UMA mensalidade (nunca multiplicada: o AVANTE não guarda a duração);
--       venda -> venda única;
--   - nunca valor_proposta nem valor_estimado da negociação (proposta e estimativa);
--   - sem modalidade (fechamento antigo, "não classificado") -> sem valor.
--
-- O que muda:
--  1. A aprovação passa a poder ser POR EMPRESA (meta_conversoes_valor_empresa),
--     além da aprovação da plataforma (que continua vazia). Só service_role grava;
--     auditado.
--  2. Empresa com `exige_valor`: o evento da etapa de fechamento sem valor válido
--     fica "valor_pendente" (não sai), com a orientação de correção. Quando o
--     fechamento é corrigido, volta para a fila sozinho; anulado, é rejeitado;
--     depois de 7 dias, expira. Empresas sem essa regra seguem como hoje.
--  3. A tela do Administrador mostra as modalidades aprovadas para a empresa.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aprovação do valor por empresa
-- ---------------------------------------------------------------------------
create table public.meta_conversoes_valor_empresa (
  tenant_id    uuid primary key references public.tenants (id) on delete cascade,
  modalidades  public.tipo_venda[] not null check (cardinality(modalidades) between 1 and 3),
  exige_valor  boolean not null default true,
  motivo       text not null check (length(btrim(motivo)) between 10 and 300),
  aprovado_em  timestamptz not null default now()
);
alter table public.meta_conversoes_valor_empresa enable row level security;
revoke all on public.meta_conversoes_valor_empresa from public, anon, authenticated;
comment on table public.meta_conversoes_valor_empresa is
  'Modalidades de venda cujo valor REAL (fechamentos.valor_vendido) vai para a Meta, por empresa. exige_valor: venda sem valor válido fica pendente de correção em vez de sair sem valor. Só service_role grava; auditado.';

create function public.meta_conversoes_valor_empresa_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_valor_empresa_alterado', coalesce(new.tenant_id, old.tenant_id),
          jsonb_build_object('operacao', tg_op,
                             'antes', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'depois', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return null;
end;
$$;
revoke all on function public.meta_conversoes_valor_empresa_auditar() from public, anon, authenticated;
create trigger meta_conversoes_valor_empresa_auditoria after insert or update or delete on public.meta_conversoes_valor_empresa
  for each row execute function public.meta_conversoes_valor_empresa_auditar();

-- ---------------------------------------------------------------------------
-- 2. Situação nova do evento: valor_pendente
-- ---------------------------------------------------------------------------
alter table public.meta_conversoes_eventos drop constraint meta_conversoes_eventos_situacao_check;
alter table public.meta_conversoes_eventos add constraint meta_conversoes_eventos_situacao_check
  check (situacao in ('pendente', 'enviando', 'enviado', 'rejeitado', 'sem_correspondencia', 'expirado', 'valor_pendente'));

-- ---------------------------------------------------------------------------
-- 3. Valor da venda: aprovado pela plataforma OU pela empresa; sempre o registrado
-- ---------------------------------------------------------------------------
create or replace function public.capi_valor_da_venda(p_negociacao uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select f.valor_vendido
    from public.fechamentos f
   where f.negociacao_id = p_negociacao
     and f.anulado_em is null
     and f.tipo_venda is not null
     and f.valor_vendido > 0
     and (f.tipo_venda = any (coalesce((select p.meta_conversoes_valor_modalidades from public.plataforma_integracoes p), '{}'))
          or f.tipo_venda = any (coalesce((select v.modalidades from public.meta_conversoes_valor_empresa v where v.tenant_id = f.tenant_id), '{}')))
$$;

-- Tela do Administrador: modalidades com valor aprovado PARA ESTA EMPRESA (plataforma + empresa).
create or replace function public.capi_valor_modalidades()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform public.exigir_administrador_integracoes();
  v_tenant := public.tenant_atual();
  return coalesce((select array(select distinct m::text from (
            select unnest(p.meta_conversoes_valor_modalidades) m from public.plataforma_integracoes p
            union all
            select unnest(v.modalidades) from public.meta_conversoes_valor_empresa v where v.tenant_id = v_tenant) x order by 1)), '{}');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. capi_reservar: corpo de 20261113090100 + retenção da venda sem valor
-- ---------------------------------------------------------------------------
create or replace function public.capi_reservar(p_limite integer default 50)
returns table (evento_id bigint, tenant_id uuid, conexao_id uuid, dataset_id text, codigo_teste text, evento text, event_id text,
               event_time_unix bigint, lead_id text, valor numeric, moeda text, email text, telefone text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.meta_conversoes_eventos e set situacao = 'expirado', ultimo_erro = 'Mais de 7 dias: a Meta não aceita mais este evento.'
   where e.situacao in ('pendente', 'valor_pendente') and e.event_time < now() - interval '7 days';
  -- Etapa de fechamento sem venda válida (anulada antes do envio ou sem registro): nunca vai para a Meta.
  update public.meta_conversoes_eventos e
     set situacao = 'rejeitado', ultimo_erro = 'Venda anulada ou sem fechamento válido: não é informada à Meta.'
   where e.situacao in ('pendente', 'valor_pendente')
     and exists (select 1 from public.etapas_funil x where x.id = e.etapa_id and x.tipo = 'ganha')
     and not exists (select 1 from public.fechamentos f where f.negociacao_id = e.negociacao_id and f.anulado_em is null);
  -- Empresa que exige o valor real: venda sem valor válido não sai; fica pendente de correção.
  update public.meta_conversoes_eventos e
     set situacao = 'valor_pendente',
         ultimo_erro = 'Fechamento sem valor válido para a Meta (modalidade TCV, MRR ou venda ausente ou não aprovada). Corrija o fechamento para enviar.'
   where e.situacao = 'pendente' and e.enviar_valor
     and exists (select 1 from public.etapas_funil x where x.id = e.etapa_id and x.tipo = 'ganha')
     and exists (select 1 from public.meta_conversoes_valor_empresa v where v.tenant_id = e.tenant_id and v.exige_valor)
     and public.capi_valor_da_venda(e.negociacao_id) is null;
  -- Corrigido dentro do prazo: volta para a fila.
  update public.meta_conversoes_eventos e
     set situacao = 'pendente', ultimo_erro = null, proxima_tentativa_em = now()
   where e.situacao = 'valor_pendente' and public.capi_valor_da_venda(e.negociacao_id) is not null;
  return query
  with lote as (
    select e.id
      from public.meta_conversoes_eventos e
      join public.meta_conversoes_conexoes c on c.id = e.conexao_id
     where e.situacao = 'pendente' and e.proxima_tentativa_em <= now() and e.lead_id is not null
       and (e.bloqueado_ate is null or e.bloqueado_ate < now())
       and c.situacao = 'ativa' and c.vault_secret_id is not null and public.meta_conversoes_elegivel(e.tenant_id)
       and public.integracao_habilitada('meta_conversoes', e.tenant_id)
       -- Empresa travada: nada é reservado, nem com a conexão "ativa".
       and not exists (select 1 from public.meta_conversoes_travas tv where tv.tenant_id = e.tenant_id)
     order by e.proxima_tentativa_em
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
     for update of e skip locked
  ), marcados as (
    update public.meta_conversoes_eventos e
       set situacao = 'enviando', tentativas = e.tentativas + 1, bloqueado_ate = now() + interval '5 minutes'
      from lote where e.id = lote.id
    returning e.*
  )
  select m.id, m.tenant_id, m.conexao_id, c.dataset_id, c.codigo_teste, m.evento, m.event_id,
         extract(epoch from m.event_time)::bigint, m.lead_id,
         v.valor,
         case when v.valor is not null then 'BRL' end,
         case when c.enviar_contato_hash then cl.email end,
         case when c.enviar_contato_hash then cl.telefone end
    from marcados m
    join public.meta_conversoes_conexoes c on c.id = m.conexao_id
    left join public.negociacoes n on n.id = m.negociacao_id
    left join public.clientes cl on cl.id = n.cliente_id
    cross join lateral (select case when m.enviar_valor then public.capi_valor_da_venda(m.negociacao_id) end as valor) v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Permissões (as mesmas de 20261113090100)
-- ---------------------------------------------------------------------------
revoke all on function public.capi_valor_da_venda(uuid) from public, anon, authenticated;
grant execute on function public.capi_valor_da_venda(uuid) to service_role;
revoke all on function public.capi_valor_modalidades() from public, anon;
grant execute on function public.capi_valor_modalidades() to authenticated;
revoke all on function public.capi_reservar(integer) from public, anon, authenticated;
grant execute on function public.capi_reservar(integer) to service_role;
