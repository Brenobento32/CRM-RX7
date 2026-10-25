-- ===========================================================================
-- PROPOSTA (NÃO APLICADA) — leitura do bucket `empresa-logos` para quem já
-- pode gravar nele.
--
-- Causa (log do Storage em produção, 25/10/2026 20:34): o upload do logo faz
--   INSERT INTO storage.objects ... ON CONFLICT DO UPDATE ... RETURNING *
-- e o Postgres só devolve a linha gravada se houver policy de SELECT que a
-- enxergue. O bucket tinha só INSERT/UPDATE/DELETE (20261027100100), então
-- falhava com 42501 "new row violates row-level security policy for table
-- objects" — mesmo para quem tinha permissão de gravar.
--
-- Correção mínima: SELECT com EXATAMENTE a mesma regra da gravação — Super
-- Admin, ou admin/gerente da empresa dona da pasta `<tenant_id>/`. Nenhum
-- outro cargo nem outra empresa passa a ler pela API. A exibição do logo
-- continua pela URL pública do bucket (público desde 100100, por decisão:
-- logo não é segredo), sem relação com esta policy.
-- ===========================================================================

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sem schema storage (banco local): nada a fazer.';
    return;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'empresa_logos_gravar') then
    raise exception 'Aplique antes 20261027100100 (bucket empresa-logos).';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname = 'empresa_logos_ler') then
    raise exception 'Proposta já aplicada.';
  end if;

  execute $p$
    create policy empresa_logos_ler on storage.objects for select to authenticated
    using (
      bucket_id = 'empresa-logos'
      and (public.is_super_admin()
           or public.tem_papel_no_tenant(public.uuid_ou_nulo((storage.foldername(name))[1]), array['admin_empresa', 'gerente']::public.tenant_papel[]))
    )$p$;
end $$;
