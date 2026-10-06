-- ===========================================================================
-- WhatsApp — envio e recebimento de IMAGEM.
--
-- Bucket privado `whatsapp-midia` (nunca público como `avatares`): mídia de
-- conversa é dado de cliente, sujeito à mesma regra de posse de
-- `mensagens`/`conversas` (closer só a sua carteira; gerente vê tudo). Path
-- de convenção: `{conversa_id}/{uuid}.{extensao}` — o primeiro segmento do
-- path é o que a RLS de storage.objects usa pra checar posse, sem precisar
-- de outra tabela.
--
-- Documento, áudio e vídeo ficam pra fases futuras — `tipo_mensagem` já
-- cobre os quatro desde a fase 1 (ver 20260930190000); só a estrutura de
-- arquivo (bucket + colunas) nasce aqui, e só pra imagem.
--
-- Upload de saída (closer) acontece com a sessão do próprio usuário — nunca
-- service_role no Next —, então a policy de INSERT do bucket precisa da
-- mesma regra de posse de `mensagens_insert`. Upload de entrada (mídia
-- recebida do WhatsApp) é sempre feito pelo whatsapp-service (service_role,
-- ignora RLS, não precisa de policy).
--
-- Leitura é sempre por signed URL (createSignedUrl), nunca getPublicUrl —
-- diferente de `avatares`. A policy de SELECT abaixo é o que de fato
-- autoriza a assinatura: sem ela, a API de Storage nega createSignedUrl
-- mesmo pra quem já vê a linha em `mensagens`.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-midia',
  'whatsapp-midia',
  false,
  8 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Mesma regra de posse de conversas_select/mensagens_select: gerente vê
-- tudo; closer só o que for de conversa de cliente que é dele.
-- storage.foldername(name) dá o path em segmentos; o primeiro é o
-- conversa_id, por convenção.
create policy whatsapp_midia_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'whatsapp-midia'
    and (
      public.is_gerente()
      or exists (
        select 1
          from public.conversas cv
          join public.clientes c on c.id = cv.cliente_id
         where cv.id::text = (storage.foldername(name))[1]
           and c.owner_id = (select auth.uid())
      )
    )
  );

create policy whatsapp_midia_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'whatsapp-midia'
    and (
      public.is_gerente()
      or exists (
        select 1
          from public.conversas cv
          join public.clientes c on c.id = cv.cliente_id
         where cv.id::text = (storage.foldername(name))[1]
           and c.owner_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- mensagens: colunas do anexo (nulas pra tipo=texto).
-- ---------------------------------------------------------------------------
alter table public.mensagens
  add column arquivo_path    text,
  add column arquivo_mime    text,
  add column arquivo_nome    text,
  add column arquivo_tamanho bigint;

comment on column public.mensagens.arquivo_path is
  'Caminho no bucket whatsapp-midia ({conversa_id}/{uuid}.{extensao}). Nulo pra tipo=texto.';
comment on column public.mensagens.arquivo_mime is
  'MIME do arquivo, conferido contra allowed_mime_types do bucket no upload. Nulo pra tipo=texto.';
comment on column public.mensagens.arquivo_nome is
  'Nome original do arquivo, só pra exibição — nunca usado no path (que é sempre um uuid).';
comment on column public.mensagens.arquivo_tamanho is
  'Tamanho em bytes no momento do upload — só exibição, nunca usado pra autorização.';

alter table public.mensagens
  add constraint mensagens_imagem_tem_arquivo
  check ((tipo = 'imagem') = (arquivo_path is not null and arquivo_mime is not null));

-- ---------------------------------------------------------------------------
-- RLS: mensagens_insert passa a aceitar tipo=imagem. Mesma regra de posse de
-- antes, inalterada; a condição de arquivo aqui replica a CHECK da coluna
-- (defesa em profundidade — falha na RLS antes de chegar na constraint).
-- ---------------------------------------------------------------------------
drop policy mensagens_insert on public.mensagens;

create policy mensagens_insert on public.mensagens
  for insert to authenticated
  with check (
    direcao = 'saida'
    and tipo in ('texto', 'imagem')
    and status = 'pendente'
    and autor_id = (select auth.uid())
    and (tipo = 'imagem') = (arquivo_path is not null and arquivo_mime is not null)
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
