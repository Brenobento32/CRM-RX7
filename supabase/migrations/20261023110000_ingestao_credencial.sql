-- ===========================================================================
-- T10 — Ingestão de leads por credencial da empresa (depende da T9).
--
-- Credencial: `rx7_<id 32 hex>_<segredo 64 hex>`, gerada pelo admin_empresa
-- e mostrada UMA vez. O banco guarda só sha256(segredo). A Edge Function
-- `ingestao-lead-empresa` repassa o token recebido no header e o banco decide
-- a empresa a partir da credencial — nunca de um tenant_id enviado por fora.
--
-- `ingerir_lead_tenant` (interna) faz o trabalho para uma empresa já
-- autenticada: recusa empresa suspensa/cancelada/arquivo, serializa reenvios
-- do mesmo external_id e a dedup por contato (advisory lock por empresa),
-- deduplica cliente só dentro da empresa e usa o destino de
-- `tenant_configuracoes`.
--
-- `ingerir_lead_formulario` (caminho atual, segredo global da Edge Function
-- `ingestao-lead`, inalterada) passa a valer só para a Rio X7.
-- ===========================================================================

do $$
begin
  if to_regclass('public.tenant_configuracoes') is null then
    raise exception 'T10 exige a T9.';
  end if;
  if to_regclass('public.ingestao_credenciais') is not null then
    raise exception 'T10 já aplicada.';
  end if;
end $$;

create table public.ingestao_credenciais (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  nome          text not null check (btrim(nome) <> ''),
  prefixo       text not null,
  segredo_hash  bytea not null,
  ativo         boolean not null default true,
  criado_por    uuid references public.profiles (id) on delete set null,
  criado_em     timestamptz not null default now(),
  revogado_em   timestamptz,
  ultimo_uso_em timestamptz
);
create index ingestao_credenciais_tenant_idx on public.ingestao_credenciais (tenant_id);

comment on table public.ingestao_credenciais is
  'Credenciais de webhook por empresa. Só o hash do segredo é guardado; o token aparece uma vez, na geração.';

alter table public.ingestao_credenciais enable row level security;
revoke all on public.ingestao_credenciais from anon, authenticated;
-- Nunca a coluna do hash.
grant select (id, tenant_id, nome, prefixo, ativo, criado_por, criado_em, revogado_em, ultimo_uso_em)
  on public.ingestao_credenciais to authenticated;
create policy ingestao_credenciais_select on public.ingestao_credenciais for select to authenticated
  using (tenant_id = (select public.tenant_atual()) and public.is_gerente());

-- ---------------------------------------------------------------------------
-- Gerar / revogar (admin_empresa da empresa da requisição)
-- ---------------------------------------------------------------------------
create function public.gerar_credencial_ingestao(p_nome text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := public.tenant_exigir();
  v_id      uuid := gen_random_uuid();
  v_segredo text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token   text;
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa']::public.tenant_papel[])
     or not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Somente o administrador da empresa gera credenciais.' using errcode = '42501';
  end if;
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Informe um nome para a credencial.' using errcode = '22023';
  end if;

  v_token := 'rx7_' || replace(v_id::text, '-', '') || '_' || v_segredo;

  insert into public.ingestao_credenciais (id, tenant_id, nome, prefixo, segredo_hash, criado_por)
  values (v_id, v_tenant, btrim(p_nome), left(v_token, 12), sha256(convert_to(v_segredo, 'UTF8')), (select auth.uid()));

  return v_token;
end;
$$;

create function public.revogar_credencial_ingestao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa']::public.tenant_papel[]) then
    raise exception 'Somente o administrador da empresa revoga credenciais.' using errcode = '42501';
  end if;
  update public.ingestao_credenciais
     set ativo = false, revogado_em = coalesce(revogado_em, now())
   where id = p_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Credencial não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.gerar_credencial_ingestao(text) from public, anon;
revoke all on function public.revogar_credencial_ingestao(uuid) from public, anon;
grant execute on function public.gerar_credencial_ingestao(text) to authenticated;
grant execute on function public.revogar_credencial_ingestao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Núcleo (interno): empresa já autenticada pela credencial
-- ---------------------------------------------------------------------------
create function public.ingerir_lead_tenant(
  p_tenant uuid, p_external_id text, p_formulario_slug text, p_nicho_slug text, p_nome text,
  p_telefone text, p_email text, p_empresa text, p_instagram text, p_respostas jsonb, p_atribuicao jsonb)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg            public.tenant_configuracoes%rowtype;
  v_formulario_id  uuid;
  v_nicho_id       uuid;
  v_funil_id       uuid;
  v_responsavel_id uuid;
  v_etapa_id       uuid;
  v_cliente_id     uuid;
  v_negociacao_id  uuid;
  v_criado         boolean := false;
  v_item           jsonb;
  v_pergunta_id    uuid;
  v_resposta       text;
begin
  if not exists (select 1 from public.tenants t
                  where t.id = p_tenant and t.tipo <> 'arquivo' and t.status in ('ativo', 'teste')) then
    raise exception 'Empresa indisponível para receber leads.' using errcode = '42501';
  end if;
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id é obrigatório.' using errcode = '22023';
  end if;
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Nome é obrigatório.' using errcode = '22023';
  end if;
  if p_telefone is null and p_email is null then
    raise exception 'Informe ao menos telefone ou e-mail.' using errcode = '22023';
  end if;
  if p_atribuicao is not null and jsonb_typeof(p_atribuicao) <> 'object' then
    raise exception 'atribuicao precisa ser um objeto JSON.' using errcode = '22023';
  end if;

  -- Reenvio/concorrência do mesmo lead na mesma empresa: um por vez.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':lead:' || btrim(p_external_id), 0));

  select * into v_cfg from public.tenant_configuracoes c where c.tenant_id = p_tenant;

  if p_formulario_slug is not null then
    select f.id into v_formulario_id from public.formularios f
     where f.tenant_id = p_tenant and f.slug = p_formulario_slug and f.ativo;
    if v_formulario_id is null then
      raise exception 'Formulário "%" não encontrado ou desativado.', p_formulario_slug using errcode = 'P0002';
    end if;
  else
    select f.id into v_formulario_id from public.formularios f
     where f.tenant_id = p_tenant and f.id = v_cfg.lead_formulario_id and f.ativo;
  end if;

  if p_nicho_slug is not null then
    select n.id into v_nicho_id from public.nichos n
     where n.tenant_id = p_tenant and n.slug = p_nicho_slug and n.ativo;
    if v_nicho_id is null then
      raise exception 'Nicho "%" não encontrado ou desativado.', p_nicho_slug using errcode = 'P0002';
    end if;
  else
    select n.id into v_nicho_id from public.nichos n
     where n.tenant_id = p_tenant and n.id = v_cfg.lead_nicho_id and n.ativo;
  end if;

  select n.cliente_id, n.id into v_cliente_id, v_negociacao_id
    from public.negociacoes n
   where n.tenant_id = p_tenant and n.origem = 'formulario' and n.external_id = btrim(p_external_id)
     for update;

  if v_negociacao_id is not null then
    update public.clientes
       set nome = p_nome, empresa = coalesce(p_empresa, empresa), telefone = coalesce(p_telefone, telefone),
           email = coalesce(p_email, email), instagram = coalesce(p_instagram, instagram)
     where id = v_cliente_id and tenant_id = p_tenant and deleted_at is null;
    update public.negociacoes
       set atribuicao = coalesce(p_atribuicao, atribuicao)
     where id = v_negociacao_id and tenant_id = p_tenant;
  else
    -- Dois leads diferentes do mesmo contato ao mesmo tempo: um cliente só.
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':contato:' ||
      lower(coalesce(p_telefone, '') || '|' || coalesce(p_email, '')), 0));

    select c.id into v_cliente_id
      from public.clientes c
     where c.tenant_id = p_tenant
       and c.deleted_at is null
       and ((p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
            or (p_email is not null and lower(c.email) = lower(p_email)))
     order by c.created_at
     limit 1
     for update;

    v_funil_id := v_cfg.lead_funil_id;
    v_responsavel_id := v_cfg.lead_responsavel_id;
    if v_funil_id is null or v_responsavel_id is null then
      -- Compatibilidade: configuração antiga do WhatsApp, na mesma empresa.
      select coalesce(v_funil_id, w.funil_id), coalesce(v_responsavel_id, w.responsavel_padrao_id)
        into v_funil_id, v_responsavel_id
        from public.whatsapp_conexoes w
       where w.tenant_id = p_tenant
       order by w.created_at
       limit 1;
    end if;

    if v_cliente_id is null then
      if v_funil_id is null or v_responsavel_id is null then
        raise exception 'Configuração de responsável/funil padrão para leads automáticos não encontrada.'
          using errcode = 'P0002';
      end if;
      insert into public.clientes (tenant_id, tipo_cliente, nome, empresa, telefone, email, instagram, owner_id)
      values (p_tenant, 'pessoa_fisica', p_nome, p_empresa, p_telefone, p_email, p_instagram, v_responsavel_id)
      returning id into v_cliente_id;
    else
      select coalesce((select n.funil_id from public.negociacoes n
                        where n.cliente_id = v_cliente_id and n.tenant_id = p_tenant
                        order by n.created_at limit 1), v_funil_id)
        into v_funil_id;
    end if;

    select e.id into v_etapa_id
      from public.etapas_funil e
     where e.funil_id = v_funil_id and e.tenant_id = p_tenant and e.etapa_inicial and e.ativo
     limit 1;
    if v_etapa_id is null then
      raise exception 'O funil não tem etapa inicial configurada (ou ela está desativada).' using errcode = 'P0002';
    end if;

    insert into public.negociacoes (tenant_id, cliente_id, owner_id, etapa_id, origem, nicho_id, formulario_id, external_id, atribuicao)
    values (p_tenant, v_cliente_id, null, v_etapa_id, 'formulario', v_nicho_id, v_formulario_id,
            btrim(p_external_id), p_atribuicao)
    returning id into v_negociacao_id;
    v_criado := true;
  end if;

  if v_formulario_id is not null then
    for v_item in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb)) loop
      select p.id into v_pergunta_id
        from public.perguntas p
       where p.formulario_id = v_formulario_id and p.tenant_id = p_tenant and p.ativo
         and btrim(p.texto) = btrim(v_item ->> 'pergunta_externa');
      continue when v_pergunta_id is null;
      v_resposta := v_item ->> 'resposta';
      continue when v_resposta is null or btrim(v_resposta) = '';

      insert into public.respostas_lead (negociacao_id, pergunta_id, resposta_texto, resposta_opcao)
      select v_negociacao_id, v_pergunta_id,
             case when p.tipo = 'texto_livre' then v_resposta end,
             case when p.tipo <> 'texto_livre' then v_resposta end
        from public.perguntas p
       where p.id = v_pergunta_id
      on conflict (negociacao_id, pergunta_id) do update
        set resposta_texto = excluded.resposta_texto, resposta_opcao = excluded.resposta_opcao;
    end loop;
  end if;

  return query select v_cliente_id, v_negociacao_id, v_criado;
end;
$$;

revoke all on function public.ingerir_lead_tenant(uuid, text, text, text, text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Entrada por credencial (service_role: Edge Function ingestao-lead-empresa)
-- ---------------------------------------------------------------------------
create function public.ingerir_lead_por_credencial(
  p_credencial text, p_external_id text, p_nome text,
  p_formulario_slug text default null, p_nicho_slug text default null,
  p_telefone text default null, p_email text default null, p_empresa text default null,
  p_instagram text default null, p_respostas jsonb default '[]'::jsonb, p_atribuicao jsonb default null)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partes text[];
  v_cred   public.ingestao_credenciais%rowtype;
begin
  v_partes := regexp_match(coalesce(p_credencial, ''), '^rx7_([0-9a-f]{32})_([0-9a-f]{64})$');
  if v_partes is null then
    raise exception 'Credencial inválida.' using errcode = '28P01';
  end if;

  select * into v_cred from public.ingestao_credenciais c
   where c.id = v_partes[1]::uuid and c.ativo and c.revogado_em is null;
  if v_cred.id is null or v_cred.segredo_hash <> sha256(convert_to(v_partes[2], 'UTF8')) then
    raise exception 'Credencial inválida.' using errcode = '28P01';
  end if;

  update public.ingestao_credenciais set ultimo_uso_em = now() where id = v_cred.id;

  return query
    select * from public.ingerir_lead_tenant(
      v_cred.tenant_id, p_external_id, p_formulario_slug, p_nicho_slug, p_nome,
      p_telefone, p_email, p_empresa, p_instagram, p_respostas, p_atribuicao);
end;
$$;

revoke all on function public.ingerir_lead_por_credencial(text, text, text, text, text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingerir_lead_por_credencial(text, text, text, text, text, text, text, text, text, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Caminho atual (segredo global do projeto RX7): só a Rio X7
-- ---------------------------------------------------------------------------
create or replace function public.ingerir_lead_formulario(
  p_external_id text, p_formulario_slug text, p_nicho_slug text, p_nome text,
  p_telefone text default null, p_email text default null, p_empresa text default null,
  p_instagram text default null, p_respostas jsonb default '[]'::jsonb, p_atribuicao jsonb default null)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_formulario_slug is null or p_nicho_slug is null then
    raise exception 'formulario_slug e nicho_slug são obrigatórios.' using errcode = '22023';
  end if;
  return query
    select * from public.ingerir_lead_tenant(
      public.tenant_rio_x7_id(), p_external_id, p_formulario_slug, p_nicho_slug, p_nome,
      p_telefone, p_email, p_empresa, p_instagram, p_respostas, p_atribuicao);
end;
$$;
