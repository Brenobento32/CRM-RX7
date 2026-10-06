-- ===========================================================================
-- WhatsApp — envio e recebimento de DOCUMENTO.
--
-- Reaproveita 100% da estrutura da imagem (ver 20261006100000): mesmo bucket
-- privado `whatsapp-midia`, mesmo path `{conversa_id}/{uuid}.{extensao}`,
-- mesmas policies de `storage.objects` (SELECT/INSERT por posse da
-- conversa) — nenhuma delas checa mimetype ou tipo de mensagem, então
-- documento não precisa de policy nova, só de entrar no `allowed_mime_types`
-- do bucket. `arquivo_path/mime/nome/tamanho` em `mensagens` também já
-- existem e já são genéricas (nada específico de imagem no nome).
--
-- O que falta pra documento funcionar:
--   1. bucket: allowed_mime_types (PDF, Word, Excel, PowerPoint, CSV, TXT —
--      ZIP fica fora nesta fase) e file_size_limit (8 MB → 20 MB, documento
--      real passa fácil do que bastava pra foto).
--   2. CHECK: a antiga `mensagens_imagem_tem_arquivo` só testava o lado
--      `imagem` — uma linha tipo=documento sem arquivo passaria por ela.
--      Generalizada aqui pra `tipo IN ('imagem','documento')`.
--   3. RLS de INSERT: `mensagens_insert` tinha `tipo = ANY ('texto','imagem')`
--      hard-coded — documento era rejeitado antes de chegar na CHECK.
--
-- Áudio e vídeo continuam de fora — mesma lógica da migration de imagem,
-- `tipo_mensagem` já cobre os quatro desde a fase 1, aqui só avança o que
-- documento precisa.
-- ===========================================================================

update storage.buckets
   set file_size_limit = 20 * 1024 * 1024,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv',
         'text/plain',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation'
       ]
 where id = 'whatsapp-midia';

-- ---------------------------------------------------------------------------
-- CHECK generalizada: imagem OU documento exigem arquivo_path + arquivo_mime;
-- texto continua de fora (regra própria em mensagens_saida_texto_nao_vazio,
-- inalterada).
-- ---------------------------------------------------------------------------
alter table public.mensagens
  drop constraint mensagens_imagem_tem_arquivo;

alter table public.mensagens
  add constraint mensagens_midia_tem_arquivo
  check (
    (tipo in ('imagem', 'documento')) = (arquivo_path is not null and arquivo_mime is not null)
  );

-- ---------------------------------------------------------------------------
-- RLS: mensagens_insert passa a aceitar tipo=documento. Mesma regra de posse
-- de antes, inalterada; a condição de arquivo (replicando a CHECK acima) só
-- troca `'imagem'` por `in ('imagem', 'documento')`.
-- ---------------------------------------------------------------------------
drop policy mensagens_insert on public.mensagens;

create policy mensagens_insert on public.mensagens
  for insert to authenticated
  with check (
    direcao = 'saida'
    and tipo in ('texto', 'imagem', 'documento')
    and status = 'pendente'
    and autor_id = (select auth.uid())
    and (tipo in ('imagem', 'documento')) = (arquivo_path is not null and arquivo_mime is not null)
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
