-- ===========================================================================
-- Negociação encerrada é somente leitura (ajuste da Fase 11C).
--
-- Etapa aberta: dados comerciais editáveis. Etapa ganha/perdida: não.
-- Dados comerciais = qualificação, proposta e serviços.
--
-- A regra fica na TABELA (triggers), não só em `salvar_negociacao`: a RLS
-- deixa o dono fazer UPDATE direto em negociacoes e INSERT/DELETE em
-- negociacao_servicos, então só a função não bastaria.
--
-- Continua funcionando: fechar, marcar perdida e reabrir pelo Kanban — esses
-- caminhos mudam etapa, posição e motivo, nunca os campos comerciais.
-- Reabrir (voltar a uma etapa aberta) torna a negociação editável de novo.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Campos comerciais de negociacoes.
--
-- Olha a etapa FINAL da linha (new.etapa_id): se ela é ganha/perdida, nenhum
-- campo comercial pode mudar — nem junto com a mudança de etapa.
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_encerrada_somente_leitura()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.etapa_tipo(new.etapa_id) <> 'aberta'
     and (
       new.valor_estimado, new.temperatura, new.data_primeira_reuniao,
       new.data_proposta, new.objecao_principal, new.valor_proposta,
       new.forma_pagamento
     ) is distinct from (
       old.valor_estimado, old.temperatura, old.data_primeira_reuniao,
       old.data_proposta, old.objecao_principal, old.valor_proposta,
       old.forma_pagamento
     )
  then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger negociacoes_encerrada_somente_leitura
  before update of valor_estimado, temperatura, data_primeira_reuniao, data_proposta,
                   objecao_principal, valor_proposta, forma_pagamento
  on public.negociacoes
  for each row
  execute function public.negociacoes_encerrada_somente_leitura();

-- ---------------------------------------------------------------------------
-- 2. Serviços de negociação encerrada.
--
-- Se a negociação não existe mais (DELETE em cascata ao excluí-la), não há o
-- que proteger: a consulta não a encontra e o vínculo sai junto.
-- ---------------------------------------------------------------------------
create or replace function public.negociacao_servicos_encerrada_somente_leitura()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_negociacao_id uuid := case when tg_op = 'DELETE' then old.negociacao_id else new.negociacao_id end;
begin
  if exists (
    select 1
    from public.negociacoes n
    where n.id = v_negociacao_id
      and public.etapa_tipo(n.etapa_id) <> 'aberta'
  ) then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger negociacao_servicos_encerrada_somente_leitura
  before insert or delete on public.negociacao_servicos
  for each row
  execute function public.negociacao_servicos_encerrada_somente_leitura();

-- ---------------------------------------------------------------------------
-- 3. salvar_negociacao: recusa encerrada logo no início, com a mensagem da
-- regra — mesmo quando nada mudaria (os triggers só disparam se algo muda).
-- FOR UPDATE trava a linha: ninguém fecha a negociação no meio do salvamento.
-- Assinatura inalterada.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_negociacao(
  p_negociacao_id          uuid,
  p_valor_estimado         numeric,
  p_temperatura            public.temperatura_negociacao,
  p_data_primeira_reuniao  date,
  p_data_proposta          date,
  p_objecao_principal      text,
  p_valor_proposta         numeric,
  p_forma_pagamento        public.forma_pagamento,
  p_servico_ids            uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tipo public.tipo_etapa;
begin
  select public.etapa_tipo(n.etapa_id) into v_tipo
    from public.negociacoes n
   where n.id = p_negociacao_id
     for update;

  if not found then
    raise exception 'Negociação não encontrada.'
      using errcode = 'P0002';
  end if;

  if v_tipo <> 'aberta' then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  update public.negociacoes
     set valor_estimado         = p_valor_estimado,
         temperatura            = p_temperatura,
         data_primeira_reuniao  = p_data_primeira_reuniao,
         data_proposta          = p_data_proposta,
         objecao_principal      = p_objecao_principal,
         valor_proposta         = p_valor_proposta,
         forma_pagamento        = p_forma_pagamento
   where id = p_negociacao_id;

  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id
        from public.negociacao_servicos ns
       where ns.negociacao_id = p_negociacao_id
    ) novo;
end;
$$;

comment on function public.salvar_negociacao is
  'Grava qualificação, proposta e serviços de uma negociação ABERTA numa transação. '
  'Encerrada (ganha/perdida) é recusada. SECURITY INVOKER.';
