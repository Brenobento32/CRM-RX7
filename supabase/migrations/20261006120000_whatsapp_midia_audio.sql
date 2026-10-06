-- ===========================================================================
-- WhatsApp — envio e recebimento de ÁUDIO (voice note / PTT).
--
-- Reaproveita a mesma estrutura de imagem/documento (ver 20261006100000 e
-- 20261006110000): mesmo bucket privado whatsapp-midia, mesmo path
-- `{conversa_id}/{uuid}.{extensao}`, mesmas policies de storage.objects —
-- nenhuma delas checa mimetype, então áudio só precisa entrar no
-- allowed_mime_types. Só falta: MIME de áudio, CHECK/RLS cobrindo
-- tipo='audio', e uma coluna de duração (nenhuma mídia anterior precisava
-- disso — alimenta o player antes do <audio> carregar metadata, e é o
-- parâmetro `seconds` que o whatsapp-service manda pro Baileys).
--
-- O áudio ENVIADO pelo CRM fica no Storage no formato bruto que o navegador
-- gravou (webm/ogg/mp4, dependendo do browser — MediaRecorder não é
-- uniforme entre engines). A conversão pro Ogg/Opus real que o WhatsApp
-- exige pra voice note só acontece no whatsapp-service (ffmpeg), nunca no
-- Next. Áudio RECEBIDO do WhatsApp já chega em Ogg/Opus nativo e é
-- guardado como está, sem conversão nenhuma.
--
-- tipo_mensagem já tem 'audio' desde a fase 1 (20260930190000) — nenhuma
-- alteração de enum.
--
-- Dado legado: a linha 29cbab0c-bdc6-41f9-b662-42b54c973ab3 é um voice note
-- recebido em 2026-10-01, antes de qualquer download de mídia existir —
-- fase 1 só gravava `tipo='audio', conteudo='[Áudio]'` como placeholder,
-- sem baixar o arquivo. Sem arquivo real pra recuperar (o WhatsApp não
-- guarda mídia de mensagem antiga), essa linha violaria a CHECK nova
-- abaixo. Reclassificada pra `tipo='texto'` antes da CHECK existir — é o
-- retrato fiel do que ela sempre foi (só um texto-placeholder, nunca teve
-- arquivo). Condições do UPDATE abaixo (id exato + direcao/tipo/arquivo_
-- path/conteudo) travam a mudança só nessa linha, nenhuma outra mensagem.
-- ===========================================================================

update public.mensagens
   set tipo = 'texto'
 where id = '29cbab0c-bdc6-41f9-b662-42b54c973ab3'
   and direcao = 'entrada'
   and tipo = 'audio'
   and arquivo_path is null
   and conteudo = '[Áudio]';

update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv',
         'text/plain',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/mpeg'
       ]
 where id = 'whatsapp-midia';

-- ---------------------------------------------------------------------------
-- Duração — só pra tipo=audio. Nula pra todo o resto.
-- ---------------------------------------------------------------------------
alter table public.mensagens
  add column arquivo_duracao_segundos integer;

comment on column public.mensagens.arquivo_duracao_segundos is
  'Duração em segundos — só pra tipo=audio. Preenchida pelo cliente (cronômetro da gravação) na saída, ou por music-metadata na entrada. Nunca usada pra autorização, só exibição e o parâmetro seconds do Baileys.';

-- ---------------------------------------------------------------------------
-- CHECK generalizada: imagem, documento OU áudio exigem arquivo_path +
-- arquivo_mime; texto continua de fora (mensagens_saida_texto_nao_vazio,
-- inalterada).
-- ---------------------------------------------------------------------------
alter table public.mensagens
  drop constraint mensagens_midia_tem_arquivo;

alter table public.mensagens
  add constraint mensagens_midia_tem_arquivo
  check (
    (tipo in ('imagem', 'documento', 'audio')) = (arquivo_path is not null and arquivo_mime is not null)
  );

-- ---------------------------------------------------------------------------
-- RLS: mensagens_insert passa a aceitar tipo=audio. Mesma regra de posse de
-- antes, inalterada; a condição de arquivo (replicando a CHECK acima) só
-- troca `in ('imagem', 'documento')` por `in ('imagem', 'documento', 'audio')`.
-- ---------------------------------------------------------------------------
drop policy mensagens_insert on public.mensagens;

create policy mensagens_insert on public.mensagens
  for insert to authenticated
  with check (
    direcao = 'saida'
    and tipo in ('texto', 'imagem', 'documento', 'audio')
    and status = 'pendente'
    and autor_id = (select auth.uid())
    and (tipo in ('imagem', 'documento', 'audio')) = (arquivo_path is not null and arquivo_mime is not null)
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
