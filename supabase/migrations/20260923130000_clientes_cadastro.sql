-- ===========================================================================
-- Fase 3 — cadastro de clientes.
--
-- `clientes` guarda apenas dados cadastrais. Valor de proposta, etapa do
-- funil, follow-ups, objeções e reuniões pertencem à negociação (ou à agenda)
-- e não entram aqui.
--
-- As colunas `documento` e `origem` da migration original deixam de ser
-- usadas pela aplicação: `documento` foi substituída por `cpf` / `cnpj`.
-- Ficam no schema até uma migration de limpeza para não apagar dado.
-- ===========================================================================

create type public.tipo_cliente as enum (
  'pessoa_fisica',
  'empresa'
);

alter table public.clientes
  add column tipo_cliente public.tipo_cliente not null default 'pessoa_fisica',
  add column cpf          text,
  add column cnpj         text,
  add column whatsapp     text,
  add column responsavel  text,
  add column cargo        text;

comment on column public.clientes.documento is
  'OBSOLETA — substituída por cpf / cnpj. Não use.';
comment on column public.clientes.origem is
  'OBSOLETA — não faz parte do cadastro. Não use.';

-- Documentos e telefones são gravados só com dígitos; a formatação é da tela.
alter table public.clientes
  add constraint clientes_cpf_formato
    check (cpf is null or cpf ~ '^[0-9]{11}$'),
  add constraint clientes_cnpj_formato
    check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  add constraint clientes_telefone_formato
    check (telefone is null or telefone ~ '^[0-9]{10,13}$') not valid,
  add constraint clientes_whatsapp_formato
    check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  -- CPF só em pessoa física, CNPJ só em empresa; empresa exige razão social.
  add constraint clientes_documento_por_tipo
    check (
      (tipo_cliente = 'pessoa_fisica' and cnpj is null)
      or (tipo_cliente = 'empresa' and cpf is null
          and empresa is not null and length(btrim(empresa)) > 0)
    ) not valid;

-- Um mesmo CPF/CNPJ não pode estar em duas carteiras ao mesmo tempo.
-- Clientes excluídos (soft delete) não contam.
create unique index clientes_cpf_unico
  on public.clientes (cpf)
  where cpf is not null and deleted_at is null;

create unique index clientes_cnpj_unico
  on public.clientes (cnpj)
  where cnpj is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Criação de cliente + negociação inicial, atômica.
--
-- Um cliente novo sempre nasce com uma negociação em `reuniao_agendada`. As
-- duas escritas ficam na mesma transação: se a negociação falhar, o cliente
-- não é criado pela metade.
--
-- SECURITY INVOKER (padrão) de propósito: as duas escritas passam pela RLS
-- como o usuário logado. Um closer que tente `p_owner_id` de outra pessoa é
-- barrado pelo WITH CHECK de clientes. O owner da negociação é derivado do
-- cliente pelo trigger `negociacoes_owner_do_cliente`.
--
-- Não é trigger em clientes porque nem toda inserção deve abrir negociação
-- (import de base, restauração), e porque a regra é do fluxo "Novo cliente".
-- ---------------------------------------------------------------------------
create or replace function public.criar_cliente(
  p_tipo_cliente public.tipo_cliente,
  p_nome         text,
  p_empresa      text default null,
  p_cpf          text default null,
  p_cnpj         text default null,
  p_telefone     text default null,
  p_whatsapp     text default null,
  p_email        text default null,
  p_responsavel  text default null,
  p_cargo        text default null,
  p_observacoes  text default null,
  p_owner_id     uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_cliente_id uuid;
begin
  insert into public.clientes (
    tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
    responsavel, cargo, observacoes, owner_id
  )
  values (
    p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone, p_whatsapp,
    p_email, p_responsavel, p_cargo, p_observacoes,
    coalesce(p_owner_id, (select auth.uid()))
  )
  returning id into v_cliente_id;

  insert into public.negociacoes (cliente_id, owner_id, etapa)
  values (v_cliente_id, coalesce(p_owner_id, (select auth.uid())), 'reuniao_agendada');

  return v_cliente_id;
end;
$$;

comment on function public.criar_cliente is
  'Cria o cliente e a negociação inicial (reuniao_agendada) na mesma transação.';

revoke all on function public.criar_cliente from public, anon;
grant execute on function public.criar_cliente to authenticated;
