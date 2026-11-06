set client_encoding = 'UTF8';
-- ===========================================================================
-- PROPOSTA, NÃO APLICADA: recuperação controlada dos eventos da CAPI que não
-- foram gerados enquanto a conexão estava pausada ou travada.
-- Depende de 20261115090100 (entrada, oposição e corte da ativação).
--
-- Por que existe: o gatilho `meta_conversoes_enfileirar` só cria evento com a
-- conexão ATIVA e sem trava (por desenho, nada se acumula). As mudanças de etapa
-- feitas durante a pausa nunca chegam à Meta, e a otimização da campanha perde
-- justamente as qualificações e as vendas.
--
-- O que faz (somente o Super Admin, com confirmação por texto e motivo, auditado):
--  1. exige empresa SEM trava e conexão ATIVA, liberada no plano;
--  2. lê `historico_etapas` desde `p_desde`, só etapas mapeadas de funis monitorados;
--  3. usa a PRIMEIRA entrada de cada negociação em cada etapa, com o mesmo
--     `event_id` do gatilho (`avante-<negociação>-<etapa>`): nada duplica, nem
--     com evento já existente nem chamando duas vezes;
--  4. `event_time` = horário real da mudança de etapa (nunca alterado);
--  5. respeita o prazo da Meta: entradas com mais de 7 dias (menos 2 h de folga
--     operacional para o envio) não entram na fila;
--  6. NUNCA recupera evento de ENTRADA (etapa em que a negociação nasceu, ex.:
--     "Lead Novo"): lead importado ou sincronizado não vira "lead novo" depois;
--  7. NUNCA cria evento de titular que se opôs à medição;
--  8. sem ID do lead da Meta, o evento fica `sem_correspondencia` e nunca sai;
--  9. NUNCA recupera nada anterior ao corte da ativação da empresa
--     (meta_conversoes_corte_empresa): na Rio X7, Opção A aprovada em 06/11/2026,
--     nenhum histórico anterior à primeira ativação;
-- 10. não muda nada no envio: valor, hash, entrada, oposição, corte e venda anulada
--     continuam decididos em `capi_reservar`, com a trava.
-- A data inicial (`p_desde`) é escolhida por quem autoriza: entradas que foram só
-- atualização em lote do funil (não ocorrências reais) ficam fora por ela.
-- Rio X7: por decisão do proprietário (Opção A), esta função NÃO é executada.
-- ===========================================================================

create function public.admin_capi_recuperar_eventos(p_tenant uuid, p_desde timestamptz, p_motivo text, p_confirmacao text)
returns table (evento text, entradas integer, enfileirados integer, sem_correspondencia integer, ja_existiam integer, fora_do_prazo integer,
               com_oposicao integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug     text;
  v_con      public.meta_conversoes_conexoes;
  v_limite   timestamptz := now() - interval '7 days' + interval '2 hours';
  v_novos    integer;
  v_entradas integer;
begin
  perform public.exigir_super_admin();
  select t.slug into v_slug from public.tenants t where t.id = p_tenant;
  if v_slug is null then raise exception 'Empresa não encontrada.' using errcode = 'P0002'; end if;
  if p_confirmacao is distinct from 'RECUPERAR EVENTOS ' || v_slug then
    raise exception 'Para recuperar os eventos, confirme com o texto exato: RECUPERAR EVENTOS %', v_slug using errcode = '22023';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) not between 10 and 300 then
    raise exception 'Descreva o motivo da recuperação (de 10 a 300 caracteres).' using errcode = '22023';
  end if;
  if p_desde is null or p_desde > now() then
    raise exception 'Informe a data inicial da recuperação (no passado).' using errcode = '22023';
  end if;
  if public.capi_travada(p_tenant) then
    raise exception 'A CAPI desta empresa está travada. A trava só sai pelo procedimento próprio, antes da recuperação.' using errcode = '42501';
  end if;
  select * into v_con from public.meta_conversoes_conexoes c where c.tenant_id = p_tenant and c.situacao = 'ativa';
  if v_con.id is null then
    raise exception 'A conexão de conversões precisa estar ativa (Retomar) antes da recuperação.' using errcode = '55000';
  end if;
  if not public.integracao_habilitada('meta_conversoes', p_tenant) or not public.meta_conversoes_elegivel(p_tenant) then
    raise exception 'A integração de conversões não está liberada para esta empresa.' using errcode = '42501';
  end if;

  drop table if exists pg_temp._capi_recuperacao;
  create temp table _capi_recuperacao on commit drop as
  select x.negociacao_id, x.etapa_id, x.funil_id, x.evento, x.enviar_valor, x.momento, x.ordem,
         'avante-' || x.negociacao_id::text || '-' || x.etapa_id::text as event_id,
         public.meta_lead_id_da_negociacao(n.atribuicao) as lead_id,
         public.capi_lead_criado_em(n.id) as lead_criado,
         exists (select 1 from public.meta_conversoes_eventos ev
                  where ev.tenant_id = p_tenant and ev.event_id = 'avante-' || x.negociacao_id::text || '-' || x.etapa_id::text) as ja_existe,
         x.momento < v_limite as fora_prazo,
         public.capi_oposicao_da_negociacao(n.id) as oposicao
    from (select distinct on (h.negociacao_id, h.etapa_nova_id)
                 h.negociacao_id, h.etapa_nova_id as etapa_id, m.funil_id, m.evento, m.enviar_valor, h.created_at as momento, e.ordem
            from public.historico_etapas h
            join public.meta_conversoes_mapeamento m on m.tenant_id = h.tenant_id and m.etapa_id = h.etapa_nova_id
            join public.meta_conversoes_funis f on f.tenant_id = m.tenant_id and f.funil_id = m.funil_id
            join public.etapas_funil e on e.id = h.etapa_nova_id
           where h.tenant_id = p_tenant and h.created_at >= p_desde and h.created_at <= now()
             -- nada anterior ao corte da ativação (sem corte na empresa: -infinity)
             and h.created_at >= public.capi_corte_da_empresa(p_tenant)
             -- evento de entrada (a negociação nasceu nesta etapa) nunca é recuperado
             and not exists (select 1 from public.historico_etapas h0
                              where h0.negociacao_id = h.negociacao_id and h0.etapa_nova_id = h.etapa_nova_id and h0.etapa_anterior_id is null)
           order by h.negociacao_id, h.etapa_nova_id, h.created_at) x
    join public.negociacoes n on n.id = x.negociacao_id and n.tenant_id = p_tenant;

  select count(distinct h.negociacao_id) into v_entradas
    from public.historico_etapas h
    join public.meta_conversoes_mapeamento m on m.tenant_id = h.tenant_id and m.etapa_id = h.etapa_nova_id
   where h.tenant_id = p_tenant and h.created_at >= p_desde and h.created_at <= now() and h.etapa_anterior_id is null;

  insert into public.meta_conversoes_eventos (tenant_id, conexao_id, negociacao_id, funil_id, etapa_id, evento, event_id, event_time,
                                              lead_id, enviar_valor, situacao)
  select p_tenant, v_con.id, r.negociacao_id, r.funil_id, r.etapa_id, r.evento, r.event_id, r.momento, r.lead_id, r.enviar_valor,
         case when r.lead_id is null then 'sem_correspondencia'
              when r.lead_criado is not null and r.momento < r.lead_criado then 'expirado'
              else 'pendente' end
    from _capi_recuperacao r
   where not r.ja_existe and not r.fora_prazo and not r.oposicao
  on conflict (tenant_id, event_id) do nothing;
  get diagnostics v_novos = row_count;

  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_eventos_recuperados', p_tenant,
          jsonb_build_object('motivo', btrim(p_motivo), 'desde', p_desde, 'limite_meta', v_limite, 'novos', v_novos,
                             'pendentes', (select count(*) from _capi_recuperacao r where not r.ja_existe and not r.fora_prazo and not r.oposicao and r.lead_id is not null),
                             'sem_correspondencia', (select count(*) from _capi_recuperacao r where not r.ja_existe and not r.fora_prazo and not r.oposicao and r.lead_id is null),
                             'ja_existiam', (select count(*) from _capi_recuperacao r where r.ja_existe),
                             'fora_do_prazo', (select count(*) from _capi_recuperacao r where not r.ja_existe and r.fora_prazo),
                             'com_oposicao', (select count(*) from _capi_recuperacao r where not r.ja_existe and r.oposicao),
                             'entradas_ignoradas', v_entradas,
                             'corte_da_ativacao', public.capi_corte_da_empresa(p_tenant)));

  return query
  select r.evento,
         count(*)::integer,
         count(*) filter (where not r.ja_existe and not r.fora_prazo and not r.oposicao and r.lead_id is not null)::integer,
         count(*) filter (where not r.ja_existe and not r.fora_prazo and not r.oposicao and r.lead_id is null)::integer,
         count(*) filter (where r.ja_existe)::integer,
         count(*) filter (where not r.ja_existe and r.fora_prazo)::integer,
         count(*) filter (where not r.ja_existe and r.oposicao)::integer
    from _capi_recuperacao r
   group by r.evento
   order by min(r.ordem);
end;
$$;

revoke all on function public.admin_capi_recuperar_eventos(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.admin_capi_recuperar_eventos(uuid, timestamptz, text, text) to authenticated;
comment on function public.admin_capi_recuperar_eventos(uuid, timestamptz, text, text) is
  'Super Admin: recupera, uma vez e sem duplicar, os eventos da CAPI das mudanças de etapa feitas com a conexão pausada ou travada, dentro do prazo de 7 dias da Meta. Nunca recupera evento de entrada nem de titular com oposição. Exige empresa sem trava e conexão ativa. Auditado.';
