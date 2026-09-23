-- ===========================================================================
-- Fase 5B — Agenda.
--
-- A tabela `eventos` existe desde a Fase 1; aqui ela é alinhada ao módulo:
-- 1. Tipos e status com os nomes usados pelo time.
-- 2. `usuario_id` (antes owner_id) e `descricao` (antes notas), no mesmo
--    padrão de `atividades`.
-- 3. Cliente obrigatório e negociação coerente com o cliente.
-- 4. Colunas para a futura sincronização com o Google Calendar.
-- 5. `alterar_status_evento`: muda o status e registra a atividade na
--    timeline do cliente, na mesma transação.
--
-- A visibilidade continua por usuário (o closer vê os próprios eventos; o
-- gerente vê todos) — as policies da Fase 1 já fazem isso.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums. RENAME VALUE preserva as linhas existentes.
-- ---------------------------------------------------------------------------
alter type public.tipo_evento rename value 'call' to 'ligacao';
alter type public.tipo_evento add value if not exists 'apresentacao';

alter type public.status_evento rename value 'no_show' to 'nao_compareceu';

-- ---------------------------------------------------------------------------
-- 2. Colunas renomeadas. Policies e índices acompanham o RENAME.
-- ---------------------------------------------------------------------------
alter table public.eventos rename column owner_id to usuario_id;
alter table public.eventos rename column notas to descricao;
alter index public.eventos_owner_inicio_idx rename to eventos_usuario_inicio_idx;

comment on column public.eventos.usuario_id is
  'Dono do compromisso. Define quem vê o evento (além do gerente).';

-- ---------------------------------------------------------------------------
-- 3. Cliente obrigatório.
--
-- Todo compromisso da agenda comercial é com um cliente. A FK passa de
-- SET NULL para CASCADE: um evento órfão não teria mais o que mostrar.
-- ---------------------------------------------------------------------------
alter table public.eventos drop constraint eventos_cliente_id_fkey;
alter table public.eventos alter column cliente_id set not null;
alter table public.eventos
  add constraint eventos_cliente_id_fkey
  foreign key (cliente_id) references public.clientes (id) on delete cascade;

create trigger eventos_negociacao_do_cliente
  before insert or update of cliente_id, negociacao_id on public.eventos
  for each row
  execute function public.valida_negociacao_do_cliente();

-- Agenda do dia / próximos eventos de todos (visão do gerente).
create index eventos_inicio_idx on public.eventos (inicio);

-- ---------------------------------------------------------------------------
-- 4. Google Calendar (ainda sem integração).
--
-- `google_event_id` liga o evento ao do Google. `sincronizado_em` guarda a
-- última sincronização: um evento está pendente de envio quando
-- `sincronizado_em is null or updated_at > sincronizado_em`.
-- ---------------------------------------------------------------------------
alter table public.eventos
  add column google_event_id text,
  add column sincronizado_em timestamptz;

create unique index eventos_google_event_id_key
  on public.eventos (google_event_id)
  where google_event_id is not null;

comment on column public.eventos.google_event_id is
  'Id do evento no Google Calendar. Nulo enquanto não sincronizado.';
comment on column public.eventos.sincronizado_em is
  'Última sincronização com o Google. Pendente se nulo ou < updated_at.';

-- ---------------------------------------------------------------------------
-- 5. Alterar status.
--
-- Realizado e não compareceu viram atividade na timeline do cliente, com a
-- data do evento (nunca no futuro). Voltar para "agendado" não apaga a
-- atividade: a timeline é histórico.
--
-- SECURITY INVOKER: a RLS de eventos decide quem pode alterar. Se o usuário
-- puder mudar o evento mas não registrar no cliente (carteira transferida
-- depois do agendamento), o status muda e a atividade é pulada, em vez de
-- travar a agenda.
-- ---------------------------------------------------------------------------
create or replace function public.alterar_status_evento(
  p_evento_id  uuid,
  p_status     public.status_evento
)
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

  if p_status in ('realizado', 'nao_compareceu') then
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

comment on function public.alterar_status_evento is
  'Muda o status do evento e registra realizado / não compareceu na timeline.';

revoke all on function public.alterar_status_evento from public, anon;
grant execute on function public.alterar_status_evento to authenticated;
