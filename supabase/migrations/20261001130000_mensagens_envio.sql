-- ===========================================================================
-- Envio de mensagens de texto pelo CRM.
--
-- Até aqui `mensagens` só tinha gravação de entrada (service_role). Esta
-- migration abre uma porta estreita: `authenticated` pode inserir mensagem
-- de SAÍDA, só TEXTO, só com status='pendente' (quem efetivamente envia
-- pelo WhatsApp é o whatsapp-service, de forma assíncrona). Nenhuma policy
-- de UPDATE é criada para authenticated — o grant de UPDATE na tabela já
-- vem por padrão do Supabase, então o portão aqui é a ausência de policy:
-- sem USING, nenhuma linha casa, e authenticated não muda status nenhum.
-- As transições de status (pendente → enviando → enviado/falhou) continuam
-- exclusivas do service_role, que ignora RLS.
--
--   status      — só tem sentido pra direcao='saida' (ciclo de envio).
--                 Mensagens de entrada ficam null; nunca um valor inventado.
--   autor_id    — quem escreveu uma mensagem de saída pelo CRM. Mensagens
--                 de entrada (do cliente) ficam null.
--   índice parcial — só as linhas pendentes, pro whatsapp-service não
--                 varrer a tabela inteira no polling de segurança.
--   CHECK       — mensagem de saída de texto nunca pode ter conteúdo vazio
--                 (defesa em profundidade; a UI já impede, isto é a garantia
--                 do banco).
-- ===========================================================================

create type public.status_mensagem as enum ('pendente', 'enviando', 'enviado', 'falhou');

alter table public.mensagens
  add column status    public.status_mensagem,
  add column autor_id  uuid references public.profiles (id) on delete set null;

comment on column public.mensagens.status is
  'Ciclo de envio (pendente → enviando → enviado/falhou), só pra direcao=saida. Mensagens de entrada ficam null.';
comment on column public.mensagens.autor_id is
  'Quem escreveu a mensagem de saída pelo CRM. Mensagens de entrada (do cliente) ficam null.';

create index mensagens_pendentes_idx
  on public.mensagens (created_at)
  where status = 'pendente';

alter table public.mensagens
  add constraint mensagens_saida_texto_nao_vazio
  check (
    not (direcao = 'saida' and tipo = 'texto')
    or (conteudo is not null and length(btrim(conteudo)) > 0)
  );

-- ---------------------------------------------------------------------------
-- RLS: authenticated ganha INSERT, estreito. Mesmo critério de visibilidade
-- de `mensagens_select`/`conversas_select` (gerente vê tudo; closer só
-- conversa de cliente que é dele) — replicado aqui porque WITH CHECK não
-- pode reaproveitar a policy de SELECT diretamente.
-- ---------------------------------------------------------------------------
create policy mensagens_insert on public.mensagens
  for insert to authenticated
  with check (
    direcao = 'saida'
    and tipo = 'texto'
    and status = 'pendente'
    and autor_id = (select auth.uid())
    and exists (
      select 1 from public.conversas cv
      where cv.id = mensagens.conversa_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id
              and c.owner_id = (select auth.uid())
          )
        )
    )
  );

grant insert on table public.mensagens to authenticated;
