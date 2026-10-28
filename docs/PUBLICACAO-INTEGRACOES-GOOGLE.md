# Primeira publicação das integrações — só Google Sheets

Projeto Supabase **ybgzlxgeoiggmfdxarqx** · repositório **CRM-RX7** · site
**avante.riox7comunicacao.com.br**. Nada daqui foi executado em produção.

## O que vai e o que fica desligado

| Item | Estado depois da publicação |
|---|---|
| Migrations `20261030100000`, `20261031090000`, `20261031100000` | aplicadas; **tudo nasce desligado** (`plataforma_integracoes`) |
| Google Sheets | liberado **só para a Empresa Teste A** (`teste-avante-a`) no passo 8, pela lista de homologação; chave global continua desligada |
| WhatsApp oficial | **desligado no banco** (`whatsapp_oficial = false`) **e** sem segredos `META_*` |
| Meta Ads — Conversões | **desligado no banco** (`meta_conversoes = false`), sem segredos `META_*`, nenhum plano com o recurso |
| Click-to-WhatsApp (conversões) | só proposta local (`supabase/propostas/20261101090000_capi_whatsapp_ctwa.sql`), fora do `db push` |
| Baileys (`whatsapp-service`) | continua desligado |

Por que as três migrations, mesmo só com Google:
- a tela de Integrações lê dados das três (`integracoes_da_empresa` — 1030;
  `whatsapp_franquia_empresa` — 0909; `capi_da_empresa` — 1031): sem elas a página quebra;
- a regra de destino aprovada (reaproveitar negociação aberta / nova oportunidade
  sem duplicar cliente) e a coluna "ID do lead" da planilha estão na 0909;
- a 1031 só cria estruturas inertes (sem plano com o recurso e com a chave desligada).

Travas que valem **independentemente de credenciais** (testadas, K1–K10):
conectar conta Google, número ou Meta Ads é recusado no banco (RX030) com a chave
desligada; webhook do WhatsApp é ignorado; nenhuma resposta sai; nenhuma
conversão é gerada nem sai da fila; o menu "Conversas" some; as telas mostram
"Em homologação" sem botão de conexão. Só `postgres`/`service_role` mudam as
chaves, e cada mudança fica em `admin_auditoria`.

**Liberação restrita** (`plataforma_integracoes_empresas`): uma integração vale para uma
empresa se a chave global estiver ligada **ou** se a empresa estiver na lista. A lista
nasce vazia; o Administrador não consegue se incluir. Testado no banco (K7b–K7g), no
runtime Deno (S9/S10) e no ensaio (`integracoes_ativacao_restrita_check.sql`).

## Google Cloud (você cadastra; nenhum segredo no chat)

Projeto do Google Cloud da Rio X7:
1. **APIs**: ativar *Google Sheets API*, *Google Picker API* e *Google Drive API*.
2. **Tela de consentimento OAuth**: tipo *Externo*; status *Em teste*; usuário de
   teste = a conta Google fictícia da homologação; escopos **só**
   `openid`, `.../auth/userinfo.email` e `.../auth/drive.file`.
   Atenção: com o app *Em teste*, o Google expira o refresh token em **7 dias**
   (o AVANTE mostra "Reconectar"). Para uso real: publicar o app (verificação da
   marca; `drive.file` não exige avaliação de segurança de escopo restrito).
3. **Credencial OAuth** tipo *Aplicativo da Web*:
   - URI de redirecionamento autorizado:
     `https://ybgzlxgeoiggmfdxarqx.supabase.co/functions/v1/integracoes/google/callback`
   - Origem JavaScript autorizada: `https://avante.riox7comunicacao.com.br`
4. **Chave de API** (para o Picker): restringir a *Referenciadores HTTP*
   `https://avante.riox7comunicacao.com.br/*` e à API *Google Picker API*.
5. **App ID do Picker** = número do projeto (Painel do projeto → "Número do projeto").

## Supabase (você digita os valores no seu terminal)

```bash
npx supabase secrets set --project-ref ybgzlxgeoiggmfdxarqx GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... GOOGLE_PICKER_API_KEY=... GOOGLE_PICKER_APP_ID=... INTEGRACOES_STATE_SECRET=... INTEGRACOES_CRON_SECRET=... AVANTE_URL=https://avante.riox7comunicacao.com.br
```

- `INTEGRACOES_STATE_SECRET` e `INTEGRACOES_CRON_SECRET`: valores aleatórios
  diferentes, com 32+ caracteres (ex.: `openssl rand -hex 32`).
- **Não** cadastrar `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`.
- Extensões (Dashboard → Database → Extensions): `pg_cron` e `pg_net`.

Agendamento (SQL Editor, depois do passo 7; você cola o segredo no Vault):

```sql
select vault.create_secret('<mesmo valor de INTEGRACOES_CRON_SECRET>', 'integracoes_cron_secret');
select cron.schedule('integracoes-sheets', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://ybgzlxgeoiggmfdxarqx.supabase.co/functions/v1/integracoes/cron',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'integracoes_cron_secret')),
    body := '{}'::jsonb)
$$);
```

## Sequência controlada (cada passo só com autorização)

| # | Passo | Critério para seguir (senão: parar) |
|---|---|---|
| 0 | Backup de produção (seu procedimento) → restaurar local → `bash supabase/propostas/ensaio_integracoes.sh <banco_restaurado> --rollback` | todas as linhas `ok`, inclusive rollback |
| 1 | Commit com staging explícito + push (sem `.env*`, sem `whatsapp-service/auth_info_baileys*`) | `git diff --cached` só com os arquivos listados |
| 2 | `npx supabase db push --linked --dry-run` | lista **exatamente** as 3 migrations |
| 3 | SQL Editor: `supabase/tests/integracoes_invariantes.sql` (guardar a saída) | — |
| 4 | `npx supabase db push --linked` | sem erro |
| 5 | SQL Editor: invariantes de novo + `supabase/tests/integracoes_pos_migration_check.sql` | invariantes idênticos; nenhuma linha `FALHOU` |
| 6 | Secrets Google + `npx supabase functions deploy integracoes --no-verify-jwt --project-ref ybgzlxgeoiggmfdxarqx` | fumaça: `GET .../integracoes/whatsapp/webhook` → 503 `nao_configurado`; `POST .../integracoes/cron` sem segredo → 401; `POST .../integracoes/google/iniciar` sem sessão → 401 |
| 7 | Front-end (ZIP da Hostinger, mesmo procedimento) → conferir: Google "Em homologação", WhatsApp/Meta "Em homologação", sem "Conversas" no menu | telas como descrito |
| 8 | SQL: `insert into public.plataforma_integracoes_empresas (tipo, tenant_id) select 'google_sheets', id from public.tenants where slug = 'teste-avante-a';` + `supabase/tests/integracoes_ativacao_restrita_check.sql` (`-v slug=teste-avante-a`) + agendamento | todas as linhas `ok` (Google só na Teste A; WhatsApp/Meta desligados em todas) |
| 9 | Homologação (abaixo) | todos os itens ok |

**Interromper** se: dry-run listar outra migration; qualquer `FALHOU`; invariantes
diferentes; erro 5xx na Edge Function; qualquer tela de produção quebrada;
lead duplicado ou em funil errado; qualquer sinal de WhatsApp/Meta ativo.

**Desfazer** (do mais leve ao mais pesado):
1. `delete from public.plataforma_integracoes_empresas;` e `select cron.unschedule('integracoes-sheets');`
2. `npx supabase functions delete integracoes --project-ref ybgzlxgeoiggmfdxarqx`
3. Front-end: subir o ZIP anterior.
4. Banco (só se necessário): `psql ... -v ON_ERROR_STOP=1 --single-transaction -f supabase/propostas/rollback_integracoes.sql`
   (ensaiado: dados e esquema voltam ao original; leads importados continuam; a auditoria é mantida).

**Enum `status_mensagem`** (`entregue`, `lido`): o Postgres não remove valores de enum sem
recriar o tipo. Estratégia: **não remover**. Nada legado usa esses valores; o rollback converte
qualquer mensagem com eles para `enviado` antes; a migration usa `add value if not exists`,
então reaplicar depois de um rollback é seguro. Recuperação total do banco (se um dia for
preciso) é pelo backup do passo 0, restaurado pelo procedimento já usado.

## Edge Function — validação de runtime

- `deno check` (Deno 2.5.6) da função `integracoes`, com `npm:@supabase/supabase-js@2`: sem erros.
- `C:\Tools\avante-local\smoke-deno.mjs`: `deno run` da função real contra o emulador local,
  com segredos Google falsos e **sem** `META_*` (configuração da 1ª publicação): 11/11.
- Limite: o *Edge Runtime* do Supabase (empacotamento no deploy) não roda aqui sem Docker;
  por isso os testes de fumaça do passo 6 são o critério de aceite logo após o deploy.

## Entrega (commit e ZIP)

- 49 arquivos, gerados/validados por `C:\Tools\crm-rx7\montar-zip-integracoes.ps1`
  (índice temporário, sem commit; recusa `.env*`, `.claude/`, `node_modules/`, `.next/`
  e `next.config.ts` diferente do HEAD).
- **Fora** da entrega: `next.config.ts` (alteração local preexistente), `.claude/`, todos os
  arquivos novos de `supabase/propostas/` (rollback, ensaio, scripts operacionais, proposta
  Click-to-WhatsApp e o teste dela), `_shared/meta-conversoes-mensagens.ts` e o teste dele.
- A proposta Click-to-WhatsApp não entra no `db push` (está fora de `supabase/migrations`) e
  nenhum código publicado a importa.
- Árvore do ZIP conferida isolada: typecheck, lint e 426 testes ok.

## Homologação Google Sheets (Empresa Teste A, dados fictícios)

Pré-requisitos: conta Google fictícia como usuário de teste; planilha **privada**
dessa conta com colunas `ID`, `Nome`, `Telefone`, `E-mail` e 3 linhas fictícias;
o plano da Empresa Teste A (se houver) precisa incluir *Webhook de leads*
(`ingestao_leads`), senão o banco recusa (RX003) — não alterar planos sem decisão;
responsável = um usuário de teste ativo da empresa (nunca o Super Admin).

- [ ] Conectar conta Google: só pede e-mail + "arquivos que você escolher".
- [ ] Colar o link: a tela pede "Escolher no Google Drive" (link sozinho não basta).
- [ ] Picker escolhe a planilha; abas listadas; colunas sugeridas (ID como identificadora).
- [ ] Funil, etapa e responsável da Empresa Teste A; "Conectar e sincronizar": 3 oportunidades.
- [ ] Linha nova no meio + reordenar + apagar uma: na próxima sincronização, só a nova entra.
- [ ] Contato que já é cliente com negociação aberta no funil: reaproveitada (etapa e responsável intactos).
- [ ] "Sincronizar agora" (limite 1/min); agendamento roda sozinho a cada ~10 min.
- [ ] Revogar o acesso em myaccount.google.com → "Reconectar"; reconectar + reautorizar o arquivo → volta.
- [ ] Desconectar planilha: leads ficam; nada mais é lido.
- [ ] Outra empresa não vê a conta/planilha; SDR/Closer não veem a configuração.
