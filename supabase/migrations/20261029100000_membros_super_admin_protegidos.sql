-- =============================================================================
-- Vínculos de Super Admin protegidos + auditoria de vínculos (tenant_memberships)
-- =============================================================================
-- Causa (26/10, 22:49, Rio X7): definir_membro_tenant() só confere se QUEM
-- chama é admin_empresa da empresa — não se o usuário AFETADO é Super Admin.
-- Um Administrador de empresa conseguiu reclassificar (admin_empresa → closer)
-- o vínculo histórico de um Super Admin, e mudanças de vínculo não eram
-- auditadas.
--
-- 1. Guarda no banco (vale para qualquer caminho: RPC, API, função futura):
--    um usuário logado que NÃO é Super Admin não cria, altera, desativa nem
--    remove vínculo de uma conta que está em super_admins. O Super Admin da
--    plataforma (e processos do sistema sem usuário) continuam podendo fazer
--    manutenção — auditada pelo item 2.
-- 2. Auditoria: toda criação, mudança de cargo/estado ou remoção de vínculo
--    vai para admin_auditoria (quem fez, usuário afetado, empresa, antes e
--    depois). Sem senha, token ou dado sigiloso.
--
-- Nada é alterado nos vínculos existentes (inclusive o da Rio X7, que fica
-- como está até decisão do dono). Conceder privilégio global continua
-- impossível para usuários: super_admins não tem GRANT de escrita.
-- =============================================================================

create function public.tenant_memberships_protege_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alvo uuid := coalesce(new.user_id, old.user_id);
begin
  if (select auth.uid()) is not null
     and not public.is_super_admin()
     and public.eh_super_admin(v_alvo) then
    raise exception 'O vínculo de um Super Admin só pode ser alterado pelo Super Admin da plataforma.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.tenant_memberships_protege_super_admin() from public, anon, authenticated;

create trigger tenant_memberships_protege_super_admin
  before insert or update or delete on public.tenant_memberships
  for each row execute function public.tenant_memberships_protege_super_admin();

create function public.tenant_memberships_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acao text;
  v_alvo uuid := coalesce(new.user_id, old.user_id);
begin
  if tg_op = 'UPDATE' and new.papel is not distinct from old.papel and new.ativo is not distinct from old.ativo then
    return null;  -- nada de cargo/estado mudou (ex.: só updated_at)
  end if;
  v_acao := case tg_op when 'INSERT' then 'membro_criado' when 'UPDATE' then 'membro_alterado' else 'membro_removido' end;

  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (
    (select auth.uid()),
    v_acao,
    coalesce(new.tenant_id, old.tenant_id),
    jsonb_build_object(
      'usuario', v_alvo,
      'papel_antes', case when tg_op = 'INSERT' then null else old.papel end,
      'papel_depois', case when tg_op = 'DELETE' then null else new.papel end,
      'ativo_antes', case when tg_op = 'INSERT' then null else old.ativo end,
      'ativo_depois', case when tg_op = 'DELETE' then null else new.ativo end,
      'super_admin_afetado', public.eh_super_admin(v_alvo),
      'origem', case when (select auth.uid()) is null then 'sistema' else 'usuario' end
    ));
  return null;
end;
$$;

revoke all on function public.tenant_memberships_auditar() from public, anon, authenticated;

create trigger zz_tenant_memberships_auditar
  after insert or update or delete on public.tenant_memberships
  for each row execute function public.tenant_memberships_auditar();
