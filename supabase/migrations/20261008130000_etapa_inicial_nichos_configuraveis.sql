-- ===========================================================================
-- Fase 1 do CRM configurável — etapa inicial do funil deixa de depender do
-- nome literal "Lead Novo", e a regra de exclusão de nichos é corrigida para
-- nunca permitir exclusão física pela aplicação.
--
-- NADA aqui toca whatsapp-service, auth_info_baileys, delivery/ACK/retry,
-- Storage de WhatsApp, mensagens ou conversas. NADA aqui introduz
-- organization_id/multiempresa — isso é uma fase futura, fora deste arquivo.
--
-- Ordem do arquivo:
--   1. etapas_funil.etapa_inicial — coluna, constraint, índice único por
--      funil, backfill da etapa "Lead Novo" já existente.
--   2. ingerir_lead_formulario — passa a resolver a etapa de entrada pela
--      flag `etapa_inicial`, nunca mais pelo nome "Lead Novo" (assinatura
--      idêntica — create or replace não perde grants nem comment).
--   3. definir_etapa_inicial — RPC que a tela de configuração de etapas usa
--      para marcar uma etapa como inicial, desmarcando a anterior do MESMO
--      funil na mesma transação (o índice único exige isso em sequência).
--   4. nichos — remove a possibilidade de DELETE físico pela aplicação
--      (policy + grant); o trigger `nichos_regras` (bloqueia excluir nicho em
--      uso) continua de pé como proteção adicional contra acesso direto ao
--      banco, mesmo sem a policy.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. etapas_funil.etapa_inicial
-- ---------------------------------------------------------------------------
alter table public.etapas_funil
  add column etapa_inicial boolean not null default false;

comment on column public.etapas_funil.etapa_inicial is
  'Etapa em que leads automáticos (formulário) e reativação de lead arquivado '
  'entram. No máximo uma por funil (índice único abaixo) — nunca mais '
  'resolvida pelo nome "Lead Novo". Configurável por funil: cada funil '
  'escolhe a sua, com o nome que quiser.';

alter table public.etapas_funil
  add constraint etapas_funil_inicial_aberta
    check (not etapa_inicial or tipo = 'aberta');

create unique index etapas_funil_inicial_unico
  on public.etapas_funil (funil_id)
  where etapa_inicial;

-- Backfill: a etapa "Lead Novo" real já existe no Funil Principal (criada em
-- 20261008100000_leads_multinicho.sql) — só ganha a flag. Nenhuma outra
-- etapa é alterada; nenhuma etapa nova é criada.
update public.etapas_funil e
   set etapa_inicial = true
  from public.funis f
 where f.padrao
   and e.funil_id = f.id
   and lower(btrim(e.nome)) = 'lead novo';

do $$
declare
  v_qtd integer;
begin
  select count(*) into v_qtd from public.etapas_funil where etapa_inicial;
  if v_qtd <> 1 then
    raise exception 'Migração abortada: esperava exatamente 1 etapa inicial (Lead Novo), encontrou %.', v_qtd;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. ingerir_lead_formulario — mesma assinatura JÁ aplicada em
-- 20261008120000_negociacoes_atribuicao.sql (10 parâmetros, com
-- p_atribuicao). Só o trecho que resolve a etapa de entrada muda: de
-- `lower(btrim(nome)) = 'lead novo'` para `etapa_inicial`. create or replace
-- com a assinatura EXATA (mesmos tipos/ordem) preserva comment/revoke/grant
-- já aplicados — não precisa repeti-los, nem fazer DROP.
-- ---------------------------------------------------------------------------
create or replace function public.ingerir_lead_formulario(
  p_external_id      text,
  p_formulario_slug  text,
  p_nicho_slug       text,
  p_nome             text,
  p_telefone         text default null,
  p_email            text default null,
  p_empresa          text default null,
  p_instagram        text default null,
  p_respostas        jsonb default '[]'::jsonb,
  p_atribuicao       jsonb default null
)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_formulario_id   uuid;
  v_nicho_id        uuid;
  v_funil_id        uuid;
  v_responsavel_id  uuid;
  v_etapa_id        uuid;
  v_cliente_id      uuid;
  v_negociacao_id   uuid;
  v_criado          boolean := false;
  v_item            jsonb;
  v_pergunta_id     uuid;
  v_resposta        text;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id é obrigatório.' using errcode = '22023';
  end if;
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Nome é obrigatório.' using errcode = '22023';
  end if;
  if p_telefone is null and p_email is null then
    raise exception 'Informe ao menos telefone ou e-mail.' using errcode = '22023';
  end if;
  if p_atribuicao is not null and jsonb_typeof(p_atribuicao) <> 'object' then
    raise exception 'atribuicao precisa ser um objeto JSON.' using errcode = '22023';
  end if;

  select f.id into v_formulario_id from public.formularios f
   where f.slug = p_formulario_slug and f.ativo;
  if v_formulario_id is null then
    raise exception 'Formulário "%" não encontrado ou desativado.', p_formulario_slug
      using errcode = 'P0002';
  end if;

  select n.id into v_nicho_id from public.nichos n
   where n.slug = p_nicho_slug and n.ativo;
  if v_nicho_id is null then
    raise exception 'Nicho "%" não encontrado ou desativado.', p_nicho_slug using errcode = 'P0002';
  end if;

  -- Idempotência primária: `for update` serializa reenvios concorrentes do
  -- mesmo external_id, mesmo padrão (sem advisory lock) de criar_cliente_whatsapp.
  select n.cliente_id, n.id into v_cliente_id, v_negociacao_id
    from public.negociacoes n
   where n.origem = 'formulario' and n.external_id = p_external_id
   for update;

  if v_negociacao_id is not null then
    -- Reenvio/correção da mesma linha: atualiza os dados cadastrais, a
    -- atribuição e as respostas, mas NUNCA cria uma segunda negociação nem
    -- reabre uma que já foi arquivada/excluída manualmente.
    update public.clientes
       set nome      = p_nome,
           empresa   = coalesce(p_empresa, empresa),
           telefone  = coalesce(p_telefone, telefone),
           email     = coalesce(p_email, email),
           instagram = coalesce(p_instagram, instagram)
     where id = v_cliente_id and deleted_at is null;

    update public.negociacoes
       set atribuicao = coalesce(p_atribuicao, atribuicao)
     where id = v_negociacao_id;
  else
    -- Dedup secundária: telefone/e-mail já pertence a um cliente ativo?
    -- Reaproveita o cliente (nunca duplica) — a negociação nova entra na
    -- carteira de quem já é o dono dele, nunca no responsável padrão.
    select c.id into v_cliente_id
      from public.clientes c
     where c.deleted_at is null
       and (
         (p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
         or (p_email is not null and lower(c.email) = lower(p_email))
       )
     order by c.created_at
     limit 1
     for update;

    if v_cliente_id is null then
      -- Responsável/funil padrão de leads automáticos — mesma config já
      -- usada pelo WhatsApp (ver cabeçalho do arquivo original).
      select c.funil_id, c.responsavel_padrao_id
        into v_funil_id, v_responsavel_id
        from public.whatsapp_conexoes c
       where c.id = '00000000-0000-0000-0000-000000000001';

      if v_funil_id is null or v_responsavel_id is null then
        raise exception 'Configuração de responsável/funil padrão para leads automáticos não encontrada.'
          using errcode = 'P0002';
      end if;

      insert into public.clientes (tipo_cliente, nome, empresa, telefone, email, instagram, owner_id)
      values ('pessoa_fisica', p_nome, p_empresa, p_telefone, p_email, p_instagram, v_responsavel_id)
      returning id into v_cliente_id;
    else
      select n.funil_id into v_funil_id
        from public.negociacoes n
       where n.cliente_id = v_cliente_id
       order by n.created_at
       limit 1;

      if v_funil_id is null then
        select c.funil_id into v_funil_id
          from public.whatsapp_conexoes c
         where c.id = '00000000-0000-0000-0000-000000000001';
      end if;
    end if;

    -- Lead de formulário SEMPRE entra na etapa inicial configurada do funil
    -- — nunca "a primeira etapa aberta" genérica, nem o nome "Lead Novo"
    -- (produto configurável: cada funil escolhe sua própria etapa inicial,
    -- com o nome que quiser). Sem fallback: se o funil resolvido não tiver
    -- etapa inicial ativa, falha alto (P0002) em vez de entrar
    -- silenciosamente em outra coluna do Kanban.
    select e.id into v_etapa_id
      from public.etapas_funil e
     where e.funil_id = v_funil_id
       and e.etapa_inicial
       and e.ativo
     limit 1;

    if v_etapa_id is null then
      raise exception 'O funil % não tem etapa inicial configurada (ou ela está desativada).', v_funil_id
        using errcode = 'P0002';
    end if;

    -- INSERT direto (não via criar_negociacao, que escolheria "a primeira
    -- etapa aberta" por ordem): os triggers de negociacoes (owner a partir
    -- do cliente, funil_id a partir da etapa, histórico de etapa) disparam
    -- igual, independente do caminho de inserção.
    insert into public.negociacoes (
      cliente_id, owner_id, etapa_id, origem, nicho_id, formulario_id, external_id, atribuicao
    )
    values (
      v_cliente_id, (select auth.uid()), v_etapa_id, 'formulario', v_nicho_id, v_formulario_id,
      p_external_id, p_atribuicao
    )
    returning id into v_negociacao_id;

    v_criado := true;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb))
  loop
    select p.id into v_pergunta_id
      from public.perguntas p
     where p.formulario_id = v_formulario_id
       and p.ativo
       and btrim(p.texto) = btrim(v_item ->> 'pergunta_externa');

    -- Pergunta desconhecida/desativada ou resposta vazia: ignora essa
    -- resposta, não interrompe a ingestão do lead (a Edge Function loga).
    continue when v_pergunta_id is null;

    v_resposta := v_item ->> 'resposta';
    continue when v_resposta is null or btrim(v_resposta) = '';

    insert into public.respostas_lead (negociacao_id, pergunta_id, resposta_texto, resposta_opcao)
    select
      v_negociacao_id,
      v_pergunta_id,
      case when p.tipo = 'texto_livre' then v_resposta end,
      case when p.tipo <> 'texto_livre' then v_resposta end
    from public.perguntas p
    where p.id = v_pergunta_id
    on conflict (negociacao_id, pergunta_id) do update
      set resposta_texto = excluded.resposta_texto,
          resposta_opcao = excluded.resposta_opcao;
  end loop;

  return query select v_cliente_id, v_negociacao_id, v_criado;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. definir_etapa_inicial — marca uma etapa como inicial, desmarcando a
-- anterior do MESMO funil antes de marcar a nova (nessa ordem, na mesma
-- transação: o índice único em (funil_id) where etapa_inicial nunca vê duas
-- linhas true ao mesmo tempo). SECURITY INVOKER: a RLS de etapas_funil
-- (is_gerente() no UPDATE) já decide quem pode chamar — nenhuma permissão
-- nova para closer.
-- ---------------------------------------------------------------------------
create or replace function public.definir_etapa_inicial(p_etapa_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
begin
  select funil_id into v_funil_id from public.etapas_funil where id = p_etapa_id;
  if v_funil_id is null then
    raise exception 'Etapa não encontrada.' using errcode = 'P0002';
  end if;

  update public.etapas_funil
     set etapa_inicial = false
   where funil_id = v_funil_id
     and etapa_inicial
     and id <> p_etapa_id;

  update public.etapas_funil
     set etapa_inicial = true
   where id = p_etapa_id;
end;
$$;

comment on function public.definir_etapa_inicial is
  'Marca uma etapa como a inicial do funil (onde leads automáticos e '
  'reativação de lead arquivado entram), desmarcando a anterior do mesmo '
  'funil na mesma transação. SECURITY INVOKER — RLS de etapas_funil decide '
  'quem pode chamar (gerente).';

revoke all on function public.definir_etapa_inicial(uuid) from public, anon;
grant execute on function public.definir_etapa_inicial(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. nichos — nunca mais DELETE físico pela aplicação. O trigger
-- `nichos_regras` (bloqueia excluir nicho em uso) continua existindo como
-- proteção adicional contra um DELETE feito direto no banco (fora da
-- aplicação) — só a policy e o grant do papel `authenticated` saem.
-- ---------------------------------------------------------------------------
drop policy if exists nichos_delete on public.nichos;
revoke delete on table public.nichos from authenticated;
