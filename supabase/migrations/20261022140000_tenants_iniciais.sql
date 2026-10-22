-- ===========================================================================
-- T2 — Empresas iniciais do CRM - RX7 (depende da T1).
--
-- Cria, com ids FIXOS e documentados (docs/SAAS-MULTIEMPRESA.md):
--   a0000000-0000-4000-8000-000000000001  Arquivo legado   (tipo arquivo, somente leitura)
--   a0000000-0000-4000-8000-000000000002  Rio X7 Agência Digital (tipo interno, ativa)
--
-- Idempotente: reexecutar não duplica nada; se já existir uma empresa com
-- esses ids, ela tem de ter o mesmo tipo e status, senão a migration aborta.
-- Não cria usuários, não concede vínculo a ninguém e não toca dados comerciais.
--
-- O vínculo do proprietário NÃO é criado aqui (o UUID dele não é presumido):
-- `vincular_proprietario_rx7(email)` é executado depois, uma vez, pelo dono do
-- banco, e só vincula um usuário que já exista, com e-mail confirmado e perfil
-- no CRM. Nenhum papel de usuário (anon, authenticated, service_role) pode
-- executá-la.
-- ===========================================================================

do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'T2 exige a T1 (tabela public.tenants ausente).';
  end if;
end $$;

-- Ids estáveis, consultáveis pelo app e pelas próximas migrations.
create or replace function public.tenant_arquivo_id()
returns uuid
language sql
immutable
set search_path = ''
as $$ select 'a0000000-0000-4000-8000-000000000001'::uuid $$;

create or replace function public.tenant_rio_x7_id()
returns uuid
language sql
immutable
set search_path = ''
as $$ select 'a0000000-0000-4000-8000-000000000002'::uuid $$;

revoke all on function public.tenant_arquivo_id() from public, anon;
revoke all on function public.tenant_rio_x7_id() from public, anon;
grant execute on function public.tenant_arquivo_id() to authenticated, service_role;
grant execute on function public.tenant_rio_x7_id() to authenticated, service_role;

insert into public.tenants (id, nome, slug, tipo, status)
values
  (public.tenant_arquivo_id(), 'Arquivo legado', 'arquivo-legado', 'arquivo', 'arquivo'),
  (public.tenant_rio_x7_id(), 'Rio X7 Agência Digital', 'rio-x7', 'interno', 'ativo')
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from public.tenants
                  where id = public.tenant_arquivo_id() and tipo = 'arquivo' and status = 'arquivo') then
    raise exception 'T2 abortada: a empresa de arquivo existe com tipo/status inesperados.';
  end if;
  if not exists (select 1 from public.tenants
                  where id = public.tenant_rio_x7_id() and tipo = 'interno') then
    raise exception 'T2 abortada: a empresa Rio X7 existe com tipo inesperado.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Vínculo do proprietário (executado à parte, pelo dono do banco)
--   select public.vincular_proprietario_rx7('<e-mail do proprietário>');
-- Rio X7: admin_empresa. Arquivo legado: gerente (que, no arquivo, só lê).
-- ---------------------------------------------------------------------------
create or replace function public.vincular_proprietario_rx7(p_email text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids   uuid[];
  v_user  uuid;
  v_novos int := 0;
  v_n     int;
begin
  select array_agg(u.id) into v_ids
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and u.email_confirmed_at is not null;

  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    raise exception 'Nenhum (ou mais de um) usuário com esse e-mail confirmado.' using errcode = 'P0002';
  end if;
  v_user := v_ids[1];

  if not exists (select 1 from public.profiles p where p.id = v_user and p.ativo) then
    raise exception 'O usuário não tem perfil ativo no CRM.' using errcode = 'P0002';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, papel)
  values (public.tenant_rio_x7_id(), v_user, 'admin_empresa')
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_n = row_count; v_novos := v_novos + v_n;

  insert into public.tenant_memberships (tenant_id, user_id, papel)
  values (public.tenant_arquivo_id(), v_user, 'gerente')
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_n = row_count; v_novos := v_novos + v_n;

  return format('vínculos criados: %s (0 = já existiam)', v_novos);
end;
$$;

revoke all on function public.vincular_proprietario_rx7(text) from public, anon, authenticated, service_role;
