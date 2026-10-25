-- =====================================================================
-- AVANTE — agenda nativa: reunião sem cliente/negociação.     (PROPOSTA)
--
-- O cadastro de reunião deixa de pedir Cliente e Negociação. Eventos e séries
-- já existentes NÃO mudam (continuam com o cliente que têm); só passa a ser
-- possível criar um compromisso sem cliente.
--
-- O que muda:
--  1. eventos.cliente_id e eventos_series.cliente_id passam a aceitar NULL.
--  2. Sem cliente não há de onde derivar a empresa: um trigger antes da
--     derivação usa a empresa da requisição (tenant_atual(), que só existe com
--     vínculo ativo). Sem empresa → tenant_id NULL → a gravação é recusada.
--  3. agenda_valida_responsavel: a regra "responsável precisa enxergar o
--     cliente" só vale quando há cliente.
--  4. RLS das séries: a checagem de dono do cliente só vale quando há cliente
--     (eventos já aceitavam cliente_id NULL).
--  5. alterar_status_evento: sem cliente, não há timeline de cliente onde
--     registrar "Realizado"/"Não compareceu".
--
-- Isolamento: nada é afrouxado. tenant_validar_gravacao, as policies
-- RESTRICTIVE por empresa e a regra de que o closer/SDR só agenda para si
-- continuam valendo. NÃO aplicar em produção sem autorização.
-- =====================================================================

-- 0. Pré-requisitos (isolamento por empresa) e proteção contra reaplicação.
do $$
begin
  if to_regprocedure('public.tenant_atual()') is null
     or to_regprocedure('public.papel_comercial(uuid, uuid)') is null then
    raise exception 'agenda_sem_cliente exige o isolamento por empresa (tenant_atual/papel_comercial).';
  end if;
  if exists (select 1 from pg_trigger
              where tgname = '_tenant_05_padrao' and tgrelid = 'public.eventos'::regclass) then
    raise exception 'agenda_sem_cliente já aplicada.';
  end if;
end $$;

-- 1. Cliente opcional.
alter table public.eventos        alter column cliente_id drop not null;
alter table public.eventos_series alter column cliente_id drop not null;

-- 2. Empresa de um compromisso sem cliente = empresa da requisição.
create or replace function public.agenda_tenant_padrao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tenant_id is null and new.cliente_id is null then
    new.tenant_id := public.tenant_atual();  -- NULL sem vínculo ativo: NOT NULL recusa
  end if;
  return new;
end;
$$;
revoke all on function public.agenda_tenant_padrao() from public, anon, authenticated;

-- Nome com "_05" para rodar antes de _tenant_10_derivar / _tenant_20_validar.
create trigger _tenant_05_padrao
  before insert on public.eventos
  for each row execute function public.agenda_tenant_padrao();
create trigger _tenant_05_padrao
  before insert on public.eventos_series
  for each row execute function public.agenda_tenant_padrao();

-- 3. Responsável: ativo nesta empresa; a regra do cliente só quando há cliente.
create or replace function public.agenda_valida_responsavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.papel_comercial(new.usuario_id, new.tenant_id);
begin
  if v_role is null then
    raise exception 'O responsável precisa ser um usuário ativo desta empresa.' using errcode = '23514';
  end if;
  if new.cliente_id is not null
     and v_role <> 'gerente'
     and (select c.owner_id from public.clientes c
           where c.id = new.cliente_id and c.tenant_id = new.tenant_id) is distinct from new.usuario_id
  then
    raise exception 'O responsável precisa ter acesso ao cliente (dono da carteira ou gerente).' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 4. RLS das séries: mesma regra de eventos (cliente opcional).
drop policy eventos_series_insert on public.eventos_series;
create policy eventos_series_insert on public.eventos_series
  for insert
  to authenticated
  with check (
    (usuario_id = (select auth.uid()) or public.is_gerente())
    and (cliente_id is null
         or public.cliente_owner(cliente_id) = (select auth.uid())
         or public.is_gerente())
    and (negociacao_id is null
         or public.negociacao_owner(negociacao_id) = (select auth.uid())
         or public.is_gerente())
  );

drop policy eventos_series_update on public.eventos_series;
create policy eventos_series_update on public.eventos_series
  for update
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    (usuario_id = (select auth.uid()) or public.is_gerente())
    and (cliente_id is null
         or public.cliente_owner(cliente_id) = (select auth.uid())
         or public.is_gerente())
    and (negociacao_id is null
         or public.negociacao_owner(negociacao_id) = (select auth.uid())
         or public.is_gerente())
  );

-- 5. Status: timeline do cliente só quando há cliente.
create or replace function public.alterar_status_evento(p_evento_id uuid, p_status public.status_evento)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_evento  public.eventos%rowtype;
  v_tipo    public.tipo_atividade;
begin
  select * into v_evento
  from public.eventos
  where id = p_evento_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if v_evento.status = p_status then
    return;
  end if;

  update public.eventos
     set status = p_status
   where id = p_evento_id;

  if p_status in ('realizado', 'nao_compareceu') and v_evento.cliente_id is not null then
    v_tipo := case v_evento.tipo::text
      when 'ligacao' then 'ligacao'
      when 'reuniao' then 'reuniao'
      when 'apresentacao' then 'reuniao'
      else 'nota'
    end::public.tipo_atividade;

    begin
      insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, data)
      values (
        v_evento.cliente_id,
        v_evento.negociacao_id,
        v_tipo,
        case p_status
          when 'realizado' then 'Realizado: '
          else 'Não compareceu: '
        end
          || v_evento.titulo
          || coalesce(E'\n' || nullif(btrim(v_evento.descricao), ''), ''),
        least(v_evento.inicio, now())
      );
    exception
      when insufficient_privilege then
        null;
    end;
  end if;
end;
$$;
