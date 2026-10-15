-- ===========================================================================
-- Deduplicação global e segura do cadastro manual.
--
-- RISCO ENCONTRADO (investigação da rodada anterior, sem código ainda):
-- `buscarCandidatosDuplicados()` (TypeScript) rodava com a sessão normal do
-- SDR, sujeita a `clientes_select` — se o cliente existente não tivesse
-- nenhuma negociação visível pra esse SDR (`pode_ver_etapa`), a busca
-- devolvia ZERO linhas, e o fluxo seguia pra criar um cliente duplicado.
--
-- CORREÇÃO: uma única função SECURITY DEFINER,
-- `criar_ou_reaproveitar_cliente()`, que faz a busca de duplicidade SEM
-- filtro de RLS (de propósito — é exatamente o ponto: enxergar clientes que
-- o chamador normalmente não veria, só pra decidir "existe ou não"), e, na
-- MESMA transação, cria o cliente novo OU reaproveita o existente, e cria a
-- negociação — tudo atômico, sem round-trip de volta pro TypeScript entre
-- "verificar" e "criar" (o pedido foi explícito nisso, pra fechar a janela
-- de corrida).
--
-- NUNCA retorna nome, telefone, whatsapp, e-mail ou empresa do cliente
-- encontrado — só `cliente_id`/`negociacao_id`/`reaproveitado` (boolean).
-- Nenhuma PII de um cliente que o chamador não poderia ver chega ao
-- TypeScript nem ao navegador.
--
-- AUTORIZAÇÃO: delega inteiramente pra `criar_negociacao()` (corrigida na
-- migration anterior, 20261015140000, ainda não aplicada) — que usa
-- `auth.uid()` (a sessão JWT real de quem chamou, não afetada por
-- SECURITY DEFINER) e `pode_mover_etapa(funil_id, etapa_inicial)` OU
-- `is_gerente()`. `owner_id` nunca decide nada aqui, nem o dono do cliente
-- reaproveitado, nem `current_user`/dono da função.
--
-- RELAÇÃO COM 20261015140000 (`criar_negociacao`): esta migration NÃO a
-- torna redundante — pelo contrário, PASSA A DEPENDER dela. Em vez de
-- duplicar "resolver funil ativo + etapa inicial + checar permissão +
-- inserir negociação", `criar_ou_reaproveitar_cliente()` simplesmente
-- CHAMA `public.criar_negociacao(cliente_id, funil_id, null, null,
-- 'manual')` nos dois ramos (cliente novo E cliente reaproveitado). As duas
-- migrations precisam ser aplicadas juntas, nesta ordem (140000 antes de
-- 150000) — nenhuma risca ou substitui a outra.
--
-- CONCORRÊNCIA: duas chamadas simultâneas com o MESMO telefone/whatsapp/
-- e-mail são serializadas por `pg_advisory_xact_lock` (chave = contato
-- normalizado) — a segunda espera a primeira commitar/abortar antes de
-- repetir a busca de duplicidade, então não cria dois clientes pro mesmo
-- contato só por correrem ao mesmo tempo. Chamadas com contatos DIFERENTES
-- não se bloqueiam entre si (chaves de lock diferentes).
--
-- LIMITAÇÃO DOCUMENTADA, NÃO RESOLVIDA AGORA: isto não é um índice único no
-- banco — só serializa chamadas que passam por ESTA função (é o único
-- caminho que o app usa pra criação manual, então suficiente na prática).
-- Um índice único normalizado (telefone/whatsapp/e-mail) seria a garantia
-- estrutural de verdade, mas JÁ EXISTE uma duplicata real em produção
-- ("Elisa"/"Eliz", telefone 21987536315) que impediria criar esse índice
-- hoje sem antes decidir o que fazer com ela — decisão deliberadamente NÃO
-- tomada aqui (nada foi alterado/mesclado/excluído desse par).
--
-- NÃO toca `criar_cliente()` (20261015110000) — continua existindo,
-- inalterada, só deixa de ser chamada pelo cadastro manual (a aplicação
-- passa a chamar esta função nova). NÃO toca `clientes_select`,
-- `negociacoes_select`, `permissoes_colaborador`, `pode_ver_etapa`,
-- `pode_mover_etapa`, `negociacoes_protege_movimentacao_por_permissao`,
-- `negociacoes_valida_handoff_sdr`, `funil_metricas`, integração WhatsApp.
-- ===========================================================================

create or replace function public.criar_ou_reaproveitar_cliente(
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
  p_owner_id     uuid default null,
  p_instagram    text default null,
  p_funil_id     uuid default null
)
returns table (cliente_id uuid, negociacao_id uuid, reaproveitado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id      uuid;
  v_chave_lock    text;
  v_candidatos    uuid[];
  v_qtd_candidatos int;
  v_cliente_id    uuid;
  v_negociacao_id uuid;
  v_reaproveitado boolean;
begin
  v_funil_id := coalesce(p_funil_id, (select id from public.funis where padrao));
  if v_funil_id is null then
    raise exception 'Nenhum funil padrão configurado.' using errcode = 'P0002';
  end if;

  -- Serializa chamadas concorrentes com o MESMO contato — ver comentário
  -- de cabeçalho sobre a limitação (não é um índice único).
  v_chave_lock := lower(coalesce(p_telefone, '') || '|' || coalesce(p_whatsapp, '') || '|' || coalesce(p_email, ''));
  perform pg_advisory_xact_lock(hashtext(v_chave_lock)::bigint);

  -- Dedup SEM RLS, de propósito (SECURITY DEFINER): telefone/WhatsApp
  -- cruzados (mesmo critério de `ingerir_lead_formulario`) + e-mail. Nome
  -- NUNCA entra aqui. Só reúne IDs — nenhuma outra coluna é lida.
  select array_agg(distinct c.id) into v_candidatos
    from public.clientes c
   where c.deleted_at is null
     and (
       (p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
       or (p_whatsapp is not null and (c.telefone = p_whatsapp or c.whatsapp = p_whatsapp))
       or (p_email is not null and lower(c.email) = lower(p_email))
     );

  v_qtd_candidatos := coalesce(array_length(v_candidatos, 1), 0);

  if v_qtd_candidatos > 1 then
    -- Nunca lista nomes/telefones/e-mails dos candidatos — só a contagem
    -- importa pra esta decisão.
    raise exception 'Encontramos mais de um cadastro compatível.' using errcode = 'P0003';
  end if;

  if v_qtd_candidatos = 1 then
    v_cliente_id := v_candidatos[1];
    v_reaproveitado := true;
  else
    v_reaproveitado := false;
    v_cliente_id := gen_random_uuid();

    insert into public.clientes (
      id, tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
      responsavel, cargo, observacoes, owner_id, instagram
    )
    values (
      v_cliente_id, p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone,
      p_whatsapp, p_email, p_responsavel, p_cargo, p_observacoes,
      coalesce(p_owner_id, (select auth.uid())), p_instagram
    );
  end if;

  -- Autorização de verdade: pode_mover_etapa(funil, etapa inicial) OU
  -- gerente, usando auth.uid() real (não afetado por este SECURITY
  -- DEFINER) — ver `criar_negociacao` (20261015140000). owner_id do
  -- cliente reaproveitado NUNCA decide nada aqui.
  v_negociacao_id := public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'manual');

  cliente_id := v_cliente_id;
  negociacao_id := v_negociacao_id;
  reaproveitado := v_reaproveitado;
  return next;
end;
$$;

comment on function public.criar_ou_reaproveitar_cliente is
  'Cadastro manual com deduplicação global e segura: busca por telefone/'
  'WhatsApp/e-mail SEM RLS (SECURITY DEFINER), mas nunca devolve PII do '
  'cliente encontrado — só cliente_id/negociacao_id/reaproveitado. 0 '
  'candidatos: cria cliente novo. 1: reaproveita (nunca sobrescreve os '
  'dados dele). 2+: erro P0003, sem revelar quais. A negociação sempre '
  'passa por criar_negociacao() (pode_mover_etapa/gerente, auth.uid() '
  'real) — nunca owner_id. pg_advisory_xact_lock serializa chamadas '
  'concorrentes com o mesmo contato (limitação: só entre chamadas que '
  'passam por esta função, não é um índice único).';

revoke all on function public.criar_ou_reaproveitar_cliente(
  public.tipo_cliente, text, text, text, text, text, text, text, text, text,
  text, uuid, text, uuid
) from public, anon;
grant execute on function public.criar_ou_reaproveitar_cliente(
  public.tipo_cliente, text, text, text, text, text, text, text, text, text,
  text, uuid, text, uuid
) to authenticated;
