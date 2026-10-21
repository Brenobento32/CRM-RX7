-- ===========================================================================
-- Remove as etapas padrão "Proposta enviada" (chave `proposta_enviada`) e
-- "Negociação" (chave `negociacao`) de todos os funis.
--
-- O trigger `etapas_funil_regras` proíbe excluir etapa de sistema, então ele
-- é desligado SÓ durante este DELETE e religado no fim, na mesma transação da
-- migration: se qualquer passo falhar, nada fica pela metade, inclusive o
-- desligamento do trigger.
--
-- No banco CRM-RX7, o histórico que citava essas etapas (102 linhas copiadas do
-- banco antigo) foi limpo à mão no SQL Editor antes desta migration: apagados
-- os movimentos PARA essas etapas e esvaziado `etapa_anterior_id` nos que só
-- saíram delas. Num banco novo, criado só pelas migrations, não há histórico.
--
-- Idempotente: se as etapas já foram removidas (por exemplo, à mão num banco
-- já em uso), o DELETE não encontra nada e a migration só confirma o trigger.
-- Não apaga dado de negócio: aborta se alguma negociação ou linha de histórico
-- ainda aponta para essas etapas, para não destruir histórico nem deixar FK
-- quebrada.
-- ===========================================================================

do $$
declare
  v_uso bigint;
begin
  select count(*) into v_uso
  from public.negociacoes n
  join public.etapas_funil e on e.id = n.etapa_id
  where e.chave in ('proposta_enviada', 'negociacao');
  if v_uso > 0 then
    raise exception 'Ainda há % negociação(ões) nessas etapas; migration abortada.', v_uso;
  end if;

  select count(*) into v_uso
  from public.historico_etapas h
  join public.etapas_funil e on e.id in (h.etapa_nova_id, h.etapa_anterior_id)
  where e.chave in ('proposta_enviada', 'negociacao');
  if v_uso > 0 then
    raise exception 'O histórico ainda cita essas etapas em % linha(s); migration abortada.', v_uso;
  end if;
end $$;

alter table public.etapas_funil disable trigger etapas_funil_regras;

delete from public.etapas_funil
where chave in ('proposta_enviada', 'negociacao');

alter table public.etapas_funil enable trigger etapas_funil_regras;

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.etapas_funil'::regclass
      and tgname = 'etapas_funil_regras'
      and tgenabled <> 'O'
  ) then
    raise exception 'Trigger etapas_funil_regras ficou desligado; migration abortada.';
  end if;
end $$;
