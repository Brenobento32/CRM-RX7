set client_encoding = 'UTF8';
-- ===========================================================================
-- PROPOSTA, NÃO APLICADA. DADOS, SÓ A RIO X7 (a0000000-0000-4000-8000-000000000002).
-- Depende de 20261115090000 e 20261115090100. Substitui o script capi_rio_x7_regras.sql.
-- Arma o corte da ativação (Opção A): nenhum histórico; a transmissão começa na primeira ativação.
--
-- Mapeamento aprovado pelo proprietário (06/11/2026), no Funil Principal:
--   "Lead Novo"          etapa inicial. Evento de ENTRADA, não é qualificação: só sai
--                        para lead de formulário Meta cadastrado até 24 h antes de entrar
--                        no CRM (regra de 20261115090100); nunca é recuperado. Mesmo nome
--                        do evento que o conjunto "[ESTÁTICO NOVOS]" já usa na Meta.
--   "Reunião realizada"  chave reuniao_realizada. Qualificação (lead qualificado). Sem valor.
--   "Fechado"            etapa ganha. Valor REAL: fechamentos.valor_vendido, BRL, com a
--                        modalidade (tcv = total do contrato; mrr = uma mensalidade).
--                        Sem valor válido: "valor_pendente" para correção; nunca sai sem valor.
-- Primeiro Contato, MQL, Reunião agendada e Recuperação deixam de gerar evento.
--
-- NÃO mexe na trava, na situação da conexão (continua pausada), no hash (continua
-- desligado), no código de teste, na plataforma nem em outra empresa. Aplicada com a
-- empresa travada, nada sai. Em banco sem a Rio X7 (cópia local nova), não faz nada.
-- ===========================================================================

do $$
declare
  t      constant uuid := 'a0000000-0000-4000-8000-000000000002';
  v_f    uuid;
  v_novo uuid;
  v_reu  uuid;
  v_fech uuid;
begin
  if (select slug from public.tenants where id = t) is distinct from 'rio-x7' then
    raise notice 'Rio X7 não existe neste banco: nenhum mapeamento alterado.';
    return;
  end if;
  select id into v_f from public.funis where tenant_id = t and nome = 'Funil Principal';
  select id into v_novo from public.etapas_funil where funil_id = v_f and etapa_inicial;
  select id into v_reu from public.etapas_funil where funil_id = v_f and chave = 'reuniao_realizada';
  select id into v_fech from public.etapas_funil where funil_id = v_f and tipo = 'ganha';
  if v_f is null or v_novo is null or v_reu is null or v_fech is null then
    raise exception 'Rio X7: Funil Principal, etapa inicial, Reunião realizada (reuniao_realizada) ou etapa ganha não encontrados.';
  end if;

  delete from public.meta_conversoes_mapeamento where tenant_id = t;
  insert into public.meta_conversoes_mapeamento (tenant_id, funil_id, etapa_id, evento, enviar_valor)
  values (t, v_f, v_novo, 'Lead Novo', false),
         (t, v_f, v_reu, 'Reunião realizada', false),
         (t, v_f, v_fech, 'Fechado', true);
  delete from public.meta_conversoes_funis where tenant_id = t and funil_id <> v_f;
  insert into public.meta_conversoes_funis (tenant_id, funil_id) values (t, v_f) on conflict do nothing;

  -- Valor real só nas modalidades que a Rio X7 usa (TCV e MRR). Venda comum não é aceita
  -- na empresa; se um dia for, o "Fechado" fica retido até a aprovação incluí-la.
  insert into public.meta_conversoes_valor_empresa (tenant_id, modalidades, exige_valor, motivo)
  values (t, array['tcv', 'mrr']::public.tipo_venda[], true,
          'Rio X7: valor real do fechamento aprovado pelo proprietário em 06/11/2026 (TCV = total do contrato; MRR = uma mensalidade).')
  on conflict (tenant_id) do update set modalidades = excluded.modalidades, exige_valor = excluded.exige_valor,
                                        motivo = excluded.motivo, aprovado_em = now();

  -- "Lead Novo" só para lead de formulário Meta cadastrado até 24 h antes de entrar no CRM.
  insert into public.meta_conversoes_entrada_empresa (tenant_id, motivo)
  values (t, 'Rio X7: Lead Novo só para lead novo de formulário Meta, nunca para lead importado ou sincronizado depois (06/11/2026).')
  on conflict (tenant_id) do update set motivo = excluded.motivo, aprovado_em = now();

  -- Opção A (06/11/2026): sem históricos. Corte armado: a transmissão começa na primeira
  -- ativação depois desta migration; nada com ocorrência anterior sai, nem o que estiver na fila.
  insert into public.meta_conversoes_corte_empresa (tenant_id, motivo)
  values (t, 'Rio X7, Opção A aprovada pelo proprietário em 06/11/2026: só eventos futuros, a partir da primeira ativação; sem históricos.')
  on conflict (tenant_id) do nothing;
end;
$$;
