# Google Sheets quase em tempo real (avisos do Google Drive)

Estado: **implementado e testado só no ambiente local**. Nada disto está em
produção (migration `20261102090000`, função `integracoes` e site continuam na
versão `bda9c3f` até uma publicação autorizada).

## Como funciona

1. O cliente conecta a planilha como hoje (conta Google → link → seletor do
   Google → aba → colunas → funil, etapa e responsável). Nenhuma permissão nova:
   continua `openid email drive.file`.
2. Logo depois da 1ª sincronização, a função `integracoes` registra um **canal de
   aviso oficial do Google Drive** (`files.watch`) naquela planilha, apontando para
   `POST /functions/v1/integracoes/google/notificacao`.
3. Quando a planilha muda, o Google chama esse endereço. A função confere o token
   do canal (HMAC de canal + fonte, com `INTEGRACOES_STATE_SECRET`, comparação em
   tempo constante). O banco (`sheets_canal_notificar`) confere canal, recurso, fonte,
   empresa liberada, conta Google válida e fonte ativa. Só então a planilha é marcada
   para leitura **imediata**.
4. A leitura é a **mesma fila** de sempre (`sheets_reservar`: lease + `SKIP LOCKED`),
   com a mesma deduplicação e o mesmo destino. Um aviso que chega no meio de uma
   leitura não se perde: a mesma planilha é lida de novo na hora (no máximo 2 vezes
   por rodada).
5. O agendador (job `integracoes-sheets`, a cada 5 min) continua como **contingência**
   e faz a manutenção dos canais: cria para planilhas que ainda não têm, **renova**
   antes de vencer (o Google limita canal de arquivo a 1 dia e não renova; cria-se
   outro), e **encerra** os de planilhas pausadas, desconectadas, de contas revogadas
   ou de empresas sem liberação.
6. Pausar, retomar e desconectar no painel encerram ou recriam o canal na hora.
   Desconectar a conta Google encerra os canais **antes** de revogar o acesso, porque
   depois da revogação o Google não aceita mais o pedido de parada.

## O que o Google garante (e o que não garante)

- O aviso diz só que **o arquivo mudou**: vem sem conteúdo, por isso quem lê as linhas
  continua sendo o AVANTE.
- O Google **não garante prazo de entrega**. Há relatos de que, em planilhas, as
  alterações são **agrupadas e avisadas a cada ~3 minutos**. Isso ainda não foi
  medido com o Google real (ver "Publicação").
- O Drive não distingue quem alterou: edição na tela, formulário do Google, Respondi,
  Zapier ou outro serviço que grava pela Sheets API geram o mesmo aviso.
- Avisos podem atrasar, chegar repetidos ou não chegar. Repetidos não duplicam nada;
  os que não chegam são cobertos pela leitura periódica.
- Se o Google recusar o canal (endereço não autorizado, arquivo sem acesso), o painel
  mostra **"Avisos do Google indisponíveis"** com o motivo, e a planilha segue na
  leitura periódica. O AVANTE tenta de novo depois de 6 h (recusa definitiva) ou de
  15 min (erro passageiro).

Por isso o painel diz "normalmente em segundos ou poucos minutos", e não "instantâneo".

## Painel

Cada planilha mostra o estado dos avisos (`ativo`, `ativando`, `desligado`, `erro`,
`indisponivel`), o horário do último aviso do Google e a "Conferência periódica" (o
próximo horário da contingência). A situação "ativa" passou a se chamar **Ativa** (antes
aparecia "Sincronizando").

## Etiqueta da origem no funil

Leads de planilha apareciam como **"Formulário"**. O motivo é de classificação:
`origem_negociacao` só tem `formulario | whatsapp | manual` e a ingestão grava
`formulario` para o Google Sheets. A fonte exata **já estava gravada** em
`negociacoes.atribuicao.fonte = 'google_sheets'`.

Correção, sem mexer no histórico: a tela passa a mostrar **"Google Sheets"** quando
`atribuicao.fonte = 'google_sheets'` (`rotuloDaOrigem`). Vale para o card do funil, o
painel do lead e a lista de leads ativos. Nenhum registro é reclassificado, e métricas
por origem continuam iguais. Leads arquivados ainda mostram "Formulário", porque aquela
lista não carrega a atribuição.

## Testes (todos locais)

| Conjunto | Resultado |
|---|---|
| `supabase/tests/sheets_monitoramento_test.sql` (regras no banco) | 48/48 |
| SQL existentes com a migration nova (75 + 86) | ok |
| `npm run test` | 449 testes |
| `C:\Tools\avante-local\tempo-real-e2e.mjs` (ponta a ponta, Google simulado) | 52/52 |
| `integracoes-e2e.mjs` com e sem a migration nova | 110/110 nos dois |
| `smoke-deno.mjs` (Deno 2.5.6, função real) | 14/14 |
| Ensaio na cópia do backup de produção (27/10 21:59) | invariantes idênticos; pós-migration 17/17 |

Tempos locais, com o Google **simulado** (medem só o caminho do AVANTE):

| Cenário | Tempo até a negociação existir |
|---|---|
| edição manual | ~110 ms |
| gravação por outra integração | ~110–190 ms |
| rajada de 5 linhas | ~100–165 ms |
| Google atrasando 3 s | ~3,1 s |
| 3 alterações agrupadas em 1 aviso de 2 s | ~2,1 s |

O tempo real em produção será **o atraso do Google + menos de 1 s**.

## Backup e restauração isolada (antes de qualquer migration de produção)

Ferramentas locais em `C:\Tools\crm-rx7`, fora do repositório.

1. **Backup** (você executa e digita a senha; nada fica salvo):
   `powershell -ExecutionPolicy Bypass -File "C:\Tools\crm-rx7\backup.ps1"`.
   O backup gera uma pasta `C:\Backups\crm-rx7\AAAAMMDD-HHMMSS` com `manifest.json`
   (tamanho e SHA-256 de cada arquivo).
2. **Conferir o manifesto**: o SHA-256 e o tamanho de cada arquivo têm de bater com o
   `manifest.json`.
3. **Restaurar num banco LOCAL novo**, com nome inédito (o script recusa sobrescrever e
   recusa servidor que não seja `localhost:5543`):
   `powershell -ExecutionPolicy Bypass -File "C:\Tools\crm-rx7\restaurar-novo.ps1" -Pasta <pasta> -Banco crm_rx7_bkp_AAAAMMDD_HHMM`.
4. **Comparar com a produção** (só leitura). Os invariantes da restauração têm de bater
   com os da produção:
   - `integracoes_invariantes.sql`;
   - a planilha da Teste A, as 4 linhas importadas e o job `integracoes-sheets`.
5. **Ensaio**: `bash /c/Tools/crm-rx7/ensaio-tempo-real.sh crm_rx7_bkp_AAAAMMDD_HHMM`.
   Ele trabalha numa cópia do banco restaurado e o deixa intacto. Na cópia, ele:
   - aplica `20261102090000` numa transação;
   - exige invariantes idênticos (dados, planos, planilha conectada, linhas importadas,
     conta Google e liberações);
   - exige pós-migration 17/17, nenhum canal criado e 48/48 nas regras dos avisos;
   - descarta as cópias no fim.
   Só com "tudo certo" se segue para o dry-run e a migration real.

## Publicação controlada (cada passo só com autorização)

1. **Backup** de produção (procedimento de sempre) e ensaio da migration
   `20261102090000` na cópia restaurada.
2. **Commit e push** dos arquivos desta entrega, com staging explícito.
3. `npx supabase db push --linked --dry-run`: tem de listar **só** `20261102090000`.
4. `npx supabase db push --linked`, depois os invariantes,
   `integracoes_pos_migration_check.sql` e a conferência de que nenhum canal existe.
5. Deploy da função `integracoes` (`--no-verify-jwt`, como hoje). **Nenhum secret
   novo**: os tokens de canal usam `INTEGRACOES_STATE_SECRET`, e a Drive API já está
   ativa no projeto `avante-crm-513014`. Testes de fumaça:
   - `POST /google/notificacao` sem token → 401;
   - `POST /google/monitoramento` sem sessão → 401;
   - os testes de antes continuam iguais.
6. Site: ZIP novo na Hostinger (painel com o estado dos avisos e a etiqueta "Google
   Sheets").
7. **Homologação com o Google real**, só na Teste A:
   - em até 5 min o agendador cria o canal da planilha conectada, e o painel mostra
     "Avisos do Google ativos";
   - adicionar **uma** linha fictícia (T005) na tela e cronometrar até o lead aparecer;
   - repetir com uma linha gravada por um Formulário Google ligado à planilha, se
     autorizado;
   - medir também depois de renovar o canal e de pausar e retomar.
   Esse é o único jeito de medir o atraso real do Google: localmente não há endereço
   público para o Google chamar.
8. **Desfazer, do mais leve ao mais pesado:**
   - secret `GOOGLE_AVISOS_DRIVE=desligado`: nada cria canal, avisos são ignorados,
     os canais existentes vencem em até 1 dia, e a leitura periódica segue;
   - voltar a função para `bda9c3f`;
   - voltar o site para o ZIP anterior;
   - a migration só acrescenta (colunas novas, tabela nova, funções); a versão antiga
     da função convive com ela.

## Arquivos

- `supabase/migrations/20261102090000_sheets_monitoramento_drive.sql`
- `supabase/functions/_shared/google-sheets.ts`: `criarCanal`, `encerrarCanal`,
  token do canal
- `supabase/functions/_shared/integracoes-servico.ts`: rotas `/google/notificacao` e
  `/google/monitoramento`, manutenção no agendador e releitura imediata
- `supabase/functions/integracoes/index.ts`: Drive API, `EdgeRuntime.waitUntil` e o
  secret `GOOGLE_AVISOS_DRIVE`
- `lib/dal/integracoes-oficiais.ts`, `lib/actions/integracoes-oficiais.ts`,
  `app/(app)/configuracoes/integracoes/**`: painel, pausar/retomar e textos
- `lib/validations/funil.ts`, `lib/dal/funil.ts`, `app/(app)/funil/**`: etiqueta da
  origem
- Testes: `supabase/tests/sheets_monitoramento_test.sql`,
  `lib/integracoes/google-sheets.test.ts`, `lib/integracoes/integracoes-servico.test.ts`,
  `lib/validations/origem.test.ts`
- Fora do repositório (ambiente local): `C:\Tools\avante-local\integracoes-local.mjs`
  (Drive simulado), `tempo-real-e2e.mjs`, `integracoes-e2e.mjs` e `smoke-deno.mjs`
  (ajustes)
