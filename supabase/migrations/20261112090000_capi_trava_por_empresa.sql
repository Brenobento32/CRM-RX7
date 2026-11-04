set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Meta Conversions API (CRM): trava por empresa contra reativação acidental.
-- LOCAL. Ainda NÃO aplicada em produção.
--
-- Por quê: a CAPI da Rio X7 foi ativada pela tela em 03/11 sem a homologação
-- e a política de privacidade concluídas, e enviou 4 eventos. Ela está
-- pausada, mas qualquer Administrador da empresa pode clicar em "Retomar".
--
-- O que muda (só servidor; a tela já mostra a mensagem do banco):
--  1. Tabela meta_conversoes_travas: uma linha = empresa travada. Invisível
--     para anon e authenticated. Retirar ou alterar só pelo procedimento do
--     Super Admin (gatilho de guarda), sempre auditado.
--  2. capi_acao: com a empresa travada, "ativar" e "retomar" são recusados
--     (42501). "pausar", "desconectar" e o código de teste seguem iguais.
--  3. Fila geral: evento de empresa travada não nasce (meta_conversoes_enfileirar),
--     não é reservado (capi_reservar) e o token não sai (capi_obter_token),
--     mesmo que a conexão fique "ativa" por outro caminho.
--  4. admin_capi_travar / admin_capi_retirar_trava: só Super Admin, com motivo,
--     auditados. Retirar exige digitar "RETIRAR TRAVA <slug>" e NÃO reativa
--     nada: a conexão continua pausada até o Administrador clicar em "Retomar".
--  5. Dados: trava a Rio X7 (pausa a conexão se, por acaso, estiver ativa).
--
-- Não muda: a homologação de UM evento (capi_homologacao_preparar) usa
-- tabela e credencial próprias e já exige a conexão pausada; a trava não a
-- bloqueia. Outras empresas sem linha na tabela: nada muda.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela da trava
-- ---------------------------------------------------------------------------
create table public.meta_conversoes_travas (
  tenant_id    uuid primary key references public.tenants (id) on delete restrict,
  motivo       text not null check (length(btrim(motivo)) between 10 and 300),
  travada_por  uuid references auth.users (id) on delete set null,
  travada_em   timestamptz not null default now()
);
alter table public.meta_conversoes_travas enable row level security;
revoke all on public.meta_conversoes_travas from public, anon, authenticated;

-- Retirar ou alterar a trava só dentro de admin_capi_retirar_trava (que liga
-- esta marca só na própria transação). Nem service_role nem SQL avulso apagam.
create function public.meta_conversoes_travas_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('rx7.capi_trava_procedimento', true), '') <> 'super_admin' then
    raise exception 'A trava da CAPI só é retirada pelo procedimento do Super Admin (admin_capi_retirar_trava).' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then return new; end if;
  return null; -- TRUNCATE (por comando)
end;
$$;
revoke all on function public.meta_conversoes_travas_guarda() from public, anon, authenticated;
create trigger meta_conversoes_travas_guarda before update or delete on public.meta_conversoes_travas
  for each row execute function public.meta_conversoes_travas_guarda();
create trigger meta_conversoes_travas_guarda_truncate before truncate on public.meta_conversoes_travas
  for each statement execute function public.meta_conversoes_travas_guarda();

create function public.capi_travada(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.meta_conversoes_travas t where t.tenant_id = p_tenant) $$;

-- ---------------------------------------------------------------------------
-- 2. capi_acao: mesmo corpo de 20261031100000 + a trava em ativar/retomar
-- ---------------------------------------------------------------------------
create or replace function public.capi_acao(p_acao text, p_codigo_teste text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_c      public.meta_conversoes_conexoes;
begin
  select * into v_c from public.meta_conversoes_conexoes where tenant_id = v_tenant and situacao <> 'desconectada' for update;
  if v_c.id is null then raise exception 'Nenhuma conta Meta Ads conectada nesta empresa.' using errcode = 'P0002'; end if;
  if p_acao in ('ativar', 'retomar') then
    -- Trava da plataforma: vale para todos, inclusive o Super Admin pelo "Acessar CRM".
    if public.capi_travada(v_tenant) then
      raise exception 'Envio de conversões travado pela plataforma até a conclusão da homologação e da política de privacidade. Só o Super Admin retira a trava.'
        using errcode = '42501';
    end if;
    perform public.capi_exigir();
    if v_c.vault_secret_id is null then raise exception 'Conecte a conta Meta Ads de novo.' using errcode = '23514'; end if;
    if not exists (select 1 from public.meta_conversoes_mapeamento where tenant_id = v_tenant) then
      raise exception 'Mapeie ao menos uma etapa para um evento antes de ativar.' using errcode = '23514';
    end if;
    update public.meta_conversoes_conexoes set situacao = 'ativa', ativada_em = coalesce(ativada_em, now()), ultimo_erro = null
     where id = v_c.id;
  elsif p_acao = 'pausar' then
    update public.meta_conversoes_conexoes set situacao = 'pausada' where id = v_c.id;
  elsif p_acao = 'definir_codigo_teste' then
    update public.meta_conversoes_conexoes set codigo_teste = nullif(btrim(coalesce(p_codigo_teste, '')), '') where id = v_c.id;
  elsif p_acao = 'desconectar' then
    if v_c.vault_secret_id is not null then delete from vault.secrets where id = v_c.vault_secret_id; end if;
    update public.meta_conversoes_conexoes set situacao = 'desconectada', vault_secret_id = null where id = v_c.id;
    update public.meta_conversoes_eventos set situacao = 'rejeitado', ultimo_erro = 'Conexão desconectada antes do envio.'
     where conexao_id = v_c.id and situacao in ('pendente', 'enviando');
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_' || p_acao, v_tenant, jsonb_build_object('conexao', v_c.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fila geral: mesmos corpos de 20261031100000 + a trava
-- ---------------------------------------------------------------------------
create or replace function public.meta_conversoes_enfileirar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_con   public.meta_conversoes_conexoes;
  v_map   public.meta_conversoes_mapeamento;
  v_neg   public.negociacoes;
  v_lead  text;
  v_criado timestamptz;
  v_sit   text;
begin
  if not public.integracao_habilitada('meta_conversoes', new.tenant_id) then return null; end if;
  -- Empresa travada: nenhum evento nasce (nada acumula para sair depois).
  if public.capi_travada(new.tenant_id) then return null; end if;
  select * into v_con from public.meta_conversoes_conexoes where tenant_id = new.tenant_id and situacao = 'ativa';
  if v_con.id is null or not public.meta_conversoes_elegivel(new.tenant_id) then return null; end if;
  select m.* into v_map from public.meta_conversoes_mapeamento m
    join public.meta_conversoes_funis f on f.tenant_id = m.tenant_id and f.funil_id = m.funil_id
   where m.tenant_id = new.tenant_id and m.etapa_id = new.etapa_nova_id;
  if v_map.etapa_id is null then return null; end if;
  select * into v_neg from public.negociacoes where id = new.negociacao_id and tenant_id = new.tenant_id;
  if v_neg.id is null then return null; end if;

  v_lead := public.meta_lead_id_da_negociacao(v_neg.atribuicao);
  v_criado := case when (v_neg.atribuicao ->> 'created_time') ~ '^\d{4}-\d{2}-\d{2}' then (v_neg.atribuicao ->> 'created_time')::timestamptz end;
  v_sit := case when v_lead is null then 'sem_correspondencia'
                when v_criado is not null and new.created_at < v_criado then 'expirado'
                else 'pendente' end;
  insert into public.meta_conversoes_eventos (tenant_id, conexao_id, negociacao_id, funil_id, etapa_id, evento, event_id, event_time,
                                              lead_id, enviar_valor, situacao)
  values (new.tenant_id, v_con.id, new.negociacao_id, v_map.funil_id, v_map.etapa_id, v_map.evento,
          'avante-' || new.negociacao_id::text || '-' || v_map.etapa_id::text, new.created_at, v_lead, v_map.enviar_valor, v_sit)
  on conflict (tenant_id, event_id) do nothing;
  return null;
exception when others then
  -- Nunca atrapalha a movimentação do funil.
  return null;
end;
$$;

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
   where e.situacao = 'pendente' and e.event_time < now() - interval '7 days';
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
         case when m.enviar_valor then (select f.valor_vendido from public.fechamentos f
                                         where f.negociacao_id = m.negociacao_id and f.anulado_em is null
                                         order by f.fechado_em desc limit 1) end,
         case when m.enviar_valor then 'BRL' end,
         case when c.enviar_contato_hash then cl.email end,
         case when c.enviar_contato_hash then cl.telefone end
    from marcados m
    join public.meta_conversoes_conexoes c on c.id = m.conexao_id
    left join public.negociacoes n on n.id = m.negociacao_id
    left join public.clientes cl on cl.id = n.cliente_id;
end;
$$;

create or replace function public.capi_obter_token(p_conexao uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret::text
    from public.meta_conversoes_conexoes c join vault.decrypted_secrets s on s.id = c.vault_secret_id
   where c.id = p_conexao and c.situacao = 'ativa'
     and not exists (select 1 from public.meta_conversoes_travas tv where tv.tenant_id = c.tenant_id);
$$;

-- ---------------------------------------------------------------------------
-- 4. Procedimento do Super Admin (auditado)
-- ---------------------------------------------------------------------------
-- Travar: sempre seguro. Pausa a conexão se ela estiver ativa.
create function public.admin_capi_travar(p_tenant uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pausou integer;
begin
  perform public.exigir_super_admin();
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) not between 10 and 300 then
    raise exception 'Descreva o motivo da trava (de 10 a 300 caracteres).' using errcode = '22023';
  end if;
  insert into public.meta_conversoes_travas (tenant_id, motivo, travada_por)
  values (p_tenant, btrim(p_motivo), (select auth.uid()))
  on conflict (tenant_id) do nothing;
  if not found then raise exception 'A CAPI desta empresa já está travada.' using errcode = '23505'; end if;
  update public.meta_conversoes_conexoes set situacao = 'pausada' where tenant_id = p_tenant and situacao = 'ativa';
  get diagnostics v_pausou = row_count;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_trava_aplicada', p_tenant, jsonb_build_object('motivo', btrim(p_motivo), 'pausou_conexao', v_pausou > 0));
end;
$$;

-- Retirar: explícito (confirmação com o slug da empresa) e auditado. Não reativa nada.
create function public.admin_capi_retirar_trava(p_tenant uuid, p_motivo text, p_confirmacao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug  text;
  v_trava public.meta_conversoes_travas;
begin
  perform public.exigir_super_admin();
  select t.slug into v_slug from public.tenants t where t.id = p_tenant;
  if v_slug is null then raise exception 'Empresa não encontrada.' using errcode = 'P0002'; end if;
  if p_confirmacao is distinct from 'RETIRAR TRAVA ' || v_slug then
    raise exception 'Para retirar a trava, confirme com o texto exato: RETIRAR TRAVA %', v_slug using errcode = '22023';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) not between 10 and 300 then
    raise exception 'Descreva o motivo da retirada (de 10 a 300 caracteres).' using errcode = '22023';
  end if;
  select * into v_trava from public.meta_conversoes_travas where tenant_id = p_tenant for update;
  if v_trava.tenant_id is null then raise exception 'A CAPI desta empresa não está travada.' using errcode = 'P0002'; end if;
  perform set_config('rx7.capi_trava_procedimento', 'super_admin', true);
  delete from public.meta_conversoes_travas where tenant_id = p_tenant;
  perform set_config('rx7.capi_trava_procedimento', '', true);
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_trava_retirada', p_tenant,
          jsonb_build_object('motivo', btrim(p_motivo), 'motivo_da_trava', v_trava.motivo, 'travada_em', v_trava.travada_em,
                             'travada_por', v_trava.travada_por));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Permissões (create or replace mantém as anteriores; reafirmadas aqui)
-- ---------------------------------------------------------------------------
revoke all on function public.capi_travada(uuid) from public, anon, authenticated;
grant execute on function public.capi_travada(uuid) to service_role;
revoke all on function public.meta_conversoes_enfileirar() from public, anon, authenticated;
revoke all on function public.capi_reservar(integer) from public, anon, authenticated;
grant execute on function public.capi_reservar(integer) to service_role;
revoke all on function public.capi_obter_token(uuid) from public, anon, authenticated;
grant execute on function public.capi_obter_token(uuid) to service_role;
revoke all on function public.capi_acao(text, text) from public, anon;
grant execute on function public.capi_acao(text, text) to authenticated;
revoke all on function public.admin_capi_travar(uuid, text) from public, anon;
grant execute on function public.admin_capi_travar(uuid, text) to authenticated;
revoke all on function public.admin_capi_retirar_trava(uuid, text, text) from public, anon;
grant execute on function public.admin_capi_retirar_trava(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Dados: trava a Rio X7 (empresa interna, id fixo da produção)
-- ---------------------------------------------------------------------------
do $$
declare
  v_rio    uuid;
  v_pausou integer := 0;
begin
  select t.id into v_rio from public.tenants t where t.id = 'a0000000-0000-4000-8000-000000000002' and t.slug = 'rio-x7';
  if v_rio is null then return; end if;
  insert into public.meta_conversoes_travas (tenant_id, motivo)
  values (v_rio, 'Homologação da CAPI e política de privacidade pendentes (trava aplicada pela migration 20261112090000).')
  on conflict (tenant_id) do nothing;
  if not found then return; end if;
  update public.meta_conversoes_conexoes set situacao = 'pausada' where tenant_id = v_rio and situacao = 'ativa';
  get diagnostics v_pausou = row_count;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (null, 'capi_trava_aplicada', v_rio,
          jsonb_build_object('motivo', 'Homologação da CAPI e política de privacidade pendentes.', 'origem', 'migration 20261112090000',
                             'pausou_conexao', v_pausou > 0));
end;
$$;
