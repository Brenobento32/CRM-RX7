# Integrações oficiais: Google Sheets e WhatsApp Business

Estado: **implementado e testado só no ambiente LOCAL** (Google e Meta simulados).
Nada foi publicado, nenhuma conta real foi conectada e nenhuma mensagem real foi enviada.

## O que existe

| Parte | Onde |
|---|---|
| Banco (tabelas, regras, custo, isolamento) | `supabase/migrations/20261030100000_integracoes_sheets_whatsapp.sql` |
| Serviço (OAuth, sincronização, webhook, envio) | `supabase/functions/_shared/integracoes-servico.ts` + `google-sheets.ts` + `whatsapp-cloud.ts` |
| Edge Function (casca Deno) | `supabase/functions/integracoes/index.ts` |
| Telas | `/configuracoes/integracoes` (painel), `/configuracoes/integracoes/google-sheets`, `/configuracoes/integracoes/whatsapp`, `/conversas` |
| Painel do Super Admin | `/admin/empresas/[id]` → "Conexões oficiais" (só situação, sem credenciais) |
| Testes | `supabase/tests/integracoes_sheets_whatsapp_test.sql`, `lib/integracoes/*.test.ts` |

O WhatsApp de `meta-webhooks` foi **desligado** (o oficial agora é a rota
`integracoes/whatsapp/webhook`), para não criar o mesmo lead duas vezes. O
`whatsapp-service` (Baileys, sessão única) continua **desligado e não deve ser
ativado**.

## Regras principais

- **Empresa nunca vem do navegador.** Usuário: JWT + empresa da aba (`tenant_atual()`).
  Google: `state` assinado + registro de uso único no banco (10 min). Meta: `phone_number_id`
  assinado pela Meta, ligado a UMA empresa (único no banco).
- **Credenciais** (refresh token do Google, token da Meta) ficam no **Vault**, só a
  `service_role` da Edge Function lê. Nunca vão para a tela nem para log.
  Exceção documentada: o token de *acesso* curto do Google (1 h, escopo `drive.file`)
  vai para o navegador do Administrador só para abrir o seletor oficial do Google.
- **Google Sheets**: escopos `openid email drive.file`. O link sozinho não dá acesso a
  planilha privada: o Administrador escolhe o arquivo no **Google Picker** uma vez.
  O AVANTE nunca escreve na planilha.
- **Idempotência**: chave por linha = coluna identificadora (se escolhida) ou impressão
  digital do contato (telefone + e-mail + nome normalizados). Reordenar, inserir ou apagar
  linhas não duplica. Limitação: sem coluna identificadora, duas linhas com o mesmo contato
  contam como uma.
- **Contato que já é cliente**: mesmo funil com negociação aberta → só registra a nova
  origem (`atribuicao.origens_adicionais`); outro funil → nova oportunidade nele, para o
  MESMO cliente. WhatsApp → só vincula a conversa, sem criar nem mover negociação.
- **Destino** (funil, etapa aberta desse funil, responsável ativo, nunca Super Admin):
  validado no banco; mudar vale para os próximos leads; toda mudança é auditada (gatilho).
  Funil, etapa ou responsável em uso não pode ser desativado sem trocar o destino antes.
- **Custo do WhatsApp** (decidido no banco, antes de qualquer chamada à Meta):
  política inicial "Somente envios gratuitos" = só texto dentro da janela de 24 h;
  fora dela, bloqueado (e contado no indicador); limite diário por número; se a Meta
  indicar cobrança (`pricing.billable`), o número é bloqueado até o Administrador revisar.
  Modelos, marketing, automações e disparos não existem no código.
  `plataforma_regras_whatsapp.permitir_mensagens_pagas = false` (só `service_role` altera).
  **Não há garantia de custo zero**: as regras de preço são da Meta.

## Para levar à produção (cada passo com autorização própria)

1. **Migration** `20261030100000_integracoes_sheets_whatsapp.sql`: `npx supabase db push --linked --dry-run`
   primeiro; aplicação real só com autorização. Depois, `npm run db:types`.
2. **Google Cloud** (projeto da Rio X7):
   - Tela de consentimento OAuth (publicada; `drive.file` é escopo não restrito, mas a
     verificação da marca do app é exigida para uso externo).
   - Cliente OAuth "Aplicativo da Web" com URI de redirecionamento
     `https://ybgzlxgeoiggmfdxarqx.supabase.co/functions/v1/integracoes/google/callback`.
   - APIs ativadas: Google Sheets API, Google Picker API.
   - Chave de API restrita ao domínio `avante.riox7comunicacao.com.br` (Picker) e o
     número do projeto (App ID do Picker).
3. **Meta** (app da Rio X7):
   - Produto WhatsApp; Rio X7 como **Tech Provider**; configuração do **Embedded Signup v4**
     (`config_id`) — a v2 é desativada em 15/10/2026.
   - Revisão do app para `whatsapp_business_management` e `whatsapp_business_messaging`.
   - Webhook do objeto *WhatsApp Business Account*, campo `messages`, apontando para
     `https://ybgzlxgeoiggmfdxarqx.supabase.co/functions/v1/integracoes/whatsapp/webhook`
     com o verify token.
   - Domínio do AVANTE nas configurações do SDK JavaScript do Facebook.
4. **Secrets da Edge Function** (`supabase secrets set`, nunca no Git):
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_PICKER_API_KEY`,
   `GOOGLE_PICKER_APP_ID`, `INTEGRACOES_STATE_SECRET` (≥ 32), `INTEGRACOES_CRON_SECRET` (≥ 32),
   `AVANTE_URL`, `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`,
   `META_GRAPH_VERSION` (padrão v23.0).
5. **Deploy** `npx supabase functions deploy integracoes --no-verify-jwt` (o callback do
   Google, o webhook da Meta e o agendador não mandam JWT; as rotas de usuário conferem o
   JWT por dentro).
6. **Agendador** (pg_cron + pg_net), com o segredo guardado no Vault:

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

   A fila usa `FOR UPDATE SKIP LOCKED` + lease (sem processamento duplo), até 10 planilhas
   e 5.000 linhas por rodada, intervalo padrão de 10 min por planilha, backoff até 6 h em
   erro e pausa automática por erro de autorização.
7. **Homologação com contas reais** (só com autorização): uma conta Google de teste, uma
   planilha de teste, um número de teste da Meta; conferir OAuth, Picker, sincronização,
   webhook, uma resposta dentro da janela e o bloqueio fora dela.

## Ambiente local (C:\Tools\avante-local)

- `integracoes-local.mjs`: roda o mesmo serviço no Node com Google e Meta simulados
  (`simulado.json`); o `buscar` recusa qualquer endereço fora de `*.simulado.invalid`.
- `integracoes-e2e.mjs [--reiniciar]`: 75 verificações pela API (OAuth, Picker, fila,
  deduplicação, A/B, Embedded Signup, webhook assinado/forjado, custo).
- `integracoes-ui.mjs <pasta>`: 15 verificações pela tela, com os pop-ups simulados.
- Depois de criar função nova no banco local: `notify pgrst, 'reload schema'`.

---

# Rodada 2 — franquia do WhatsApp, destino único e Meta Conversions API

Também só LOCAL. Migrations novas (nenhuma aplicada em produção):

- `20261031090000_whatsapp_franquia_destino_unico.sql` — franquia mensal e regra de destino única;
- `20261031100000_meta_conversoes_crm.sql` — Meta Ads: Conversões do CRM.

Ordem de aplicação: `20261030100000` → `20261031090000` → `20261031100000`.

## WhatsApp: franquia mensal gratuita

Regra da Meta (página oficial de preços, a partir de 01/10/2026): cada **número** tem
**1.000 mensagens de serviço gratuitas por mês** (fuso da conta de mensagens, sem
acúmulo); a partir da 1.001ª, mensagem **entregue** é cobrada mesmo dentro da janela de
24 h. Modelos de utilidade dentro da janela também passaram a ser cobrados. O status da
Meta traz `pricing.billable` e `pricing.type` (`free_customer_service` / `regular`).

O que o AVANTE faz (tudo no banco, antes de qualquer chamada à Meta):

- **Reserva** capacidade antes de cada envio, com trava por número (envios simultâneos
  passam um por vez). A reserva só é devolvida se a mensagem falhar; entrega consome uma
  vez só (status repetidos não contam de novo).
- **Limite estimado** = franquia (1.000) − margem de segurança (50, regra da plataforma).
- **Reconciliação**: o agendador consulta o *pricing analytics* da WABA e guarda o total de
  mensagens de serviço do mês informado pela Meta; vale sempre o **maior** entre o que o
  AVANTE contou e o que a Meta informou (cobre uso por outros sistemas no mesmo número).
- **Bloqueio preventivo** quando: limite estimado atingido; consumo do mês ainda não
  confirmado com a Meta (número recém-conectado) ou confirmação com mais de 36 h; a Meta
  marcou uma mensagem como cobrada (`regular`/`billable`); fora da janela de 24 h; limite
  diário do número.
- **Alertas** de 80 %, 90 % e 100 %, uma vez por mês, na auditoria e no painel
  "Mensagens gratuitas utilizadas / limite estimado".
- Entrada de mensagens e criação/vínculo de leads seguem funcionando com a saída bloqueada.
- Templates, campanhas e disparos não existem no código; `permitir_mensagens_pagas` segue
  `false` e nenhuma cobrança é ativada.

Limites honestos: o AVANTE só controla o que sai por ele. Outros sistemas ligados ao mesmo
número podem gerar cobrança; o relatório da Meta pode ter atraso (a margem existe para
isso). O formato exato do *pricing analytics* precisa ser confirmado na homologação — se
vier diferente, a reconciliação falha e o envio fica **bloqueado** (lado seguro).

## Destino único (Google Sheets e WhatsApp)

| Situação do contato na empresa | Resultado |
|---|---|
| Não existe cliente | cria cliente + oportunidade no funil/etapa configurados |
| Cliente com negociação **aberta** no funil de destino | reaproveita (etapa e responsável intactos; a nova origem vai para `atribuicao.origens_adicionais`) |
| Cliente sem negociação aberta nesse funil | nova oportunidade nesse funil, para o **mesmo** cliente |

- Nada é movido entre funis. Reenvio da Meta, mensagem repetida ou linha já lida não
  duplicam (ID da mensagem / chave da linha + trava por contato).
- Responsável da nova oportunidade de cliente existente = **dono do cliente** (regra do
  CRM `negociacoes_owner_do_cliente`); o responsável configurado vale para cliente novo.
- Planilha sem coluna identificadora: a linha é reconhecida pelo contato; linha editada é
  vista como nova, mas cai na regra acima (mesmo cliente, negociação aberta reaproveitada).
  A tela avisa e recomenda a coluna de ID/data-hora.

## Meta Ads — Conversões do CRM (planos Pro e Business)

- **Formato** (documentação "Conversion Leads"): `action_source = system_generated`,
  `user_data.lead_id` (ID do lead dos Lead Ads, 15–17 dígitos, enviado como número sem
  perder precisão), `custom_data.event_source = crm`, `custom_data.lead_event_source =
  "AVANTE CRM"`, `event_name` = evento mapeado da etapa, `event_id` estável
  (`avante-<negociação>-<etapa>`), `event_time` ≤ 7 dias. Fechamento: `value` + `currency`
  (BRL) quando marcado. E-mail/telefone com hash SHA-256 só se o Administrador ligar.
- **Origem sem invenção**: só leads com ID de lead da Meta (Lead Ads via `meta-webhooks`, ou
  planilha com a coluna "ID do lead") geram envio. Os demais ficam "sem correspondência".
  O `ctwa_clid` dos anúncios Click-to-WhatsApp é guardado na entrada, mas o envio desses
  usa a Conversions API for Business Messaging (`business_messaging`) — não implementada.
- **Autorização**: Meta Business Extension (canal `CONVERSIONS_API`). O servidor procura a
  instalação pelo ID externo opaco da empresa, troca por token de usuário do sistema e
  guarda no Vault. Um dataset nunca serve a duas empresas.
- **Fila**: gerada pelo `historico_etapas` (funis monitorados + etapas mapeadas), lease +
  SKIP LOCKED, recuo exponencial até 6 h e 8 tentativas, pausa por limite da API
  (80004/4/17/32/613/429), reconexão em erro 190, expiração após 7 dias, reprocessamento
  pelo Administrador, código de teste do Gerenciador de Eventos. Sem dados pessoais na fila.
- **Plano**: recurso `meta_conversoes` (novo em `recursos_validos`). **Nenhum plano foi
  alterado**: o Super Admin inclui o recurso em Pro e Business pelo painel de planos.
  Empresa interna: liberada. Starter/sem plano: bloqueado no servidor e no banco.

## Checklist curto de homologação real (cada item só com autorização)

**Google**
- [ ] Cliente OAuth com conta de teste (tela de consentimento em modo teste).
- [ ] Planilha privada escolhida pelo Google Picker (link sozinho deve pedir autorização).
- [ ] Escopos concedidos = `openid email drive.file` (nada além).
- [ ] pg_cron + pg_net chamando `/integracoes/cron`; sincronização a cada 10 min.
- [ ] Inserir, reordenar e apagar linhas: sem duplicar; linha editada sem duplicar negociação.
- [ ] Revogar o acesso no Google → "Reconectar"; reconectar + reautorizar arquivo → volta.

**WhatsApp**
- [ ] App Meta aprovado (whatsapp_business_management / messaging), Tech Provider.
- [ ] Embedded Signup v4 real com número de teste da empresa certa.
- [ ] Webhook real assinado (verify token + assinatura); mensagem recebida vira lead.
- [ ] Pricing analytics real reconciliando (conferir formato) → envio liberado.
- [ ] Uma resposta de serviço dentro da janela; conferir `pricing.type` no status.
- [ ] Bloqueio fora da janela e no limite estimado; revogar o número.
- [ ] Baileys continua desligado.

**Meta Conversions API**
- [ ] Liberação de `manage_business_extension` (MBE) e revisão de `ads_read`/`ads_management`.
- [ ] Dataset de CRM de teste autorizado pelo MBE.
- [ ] Código de teste no AVANTE → evento fictício aparece em "Eventos de teste".
- [ ] Mapeamento de etapa funcionando (lead recebido → reunião → fechado com valor).
- [ ] Deduplicação: mover para trás e para frente não reenvia.
- [ ] Plano: Starter recusa; Pro/Business (com o recurso) liberam.

## Testes locais desta rodada

- `supabase/tests/franquia_destino_capi_test.sql` — 67 verificações (franquia, destino, CAPI).
- `lib/integracoes/meta-conversoes.test.ts` + casos novos em `whatsapp-cloud.test.ts`.
- `C:\Tools\avante-local\integracoes-e2e.mjs --reiniciar` — 110 verificações pela API.
- `C:\Tools\avante-local\integracoes-ui.mjs <pasta>` — 21 verificações pela tela.

---

# Rodada 3 — preparação da primeira publicação (só Google Sheets)

- **Chaves da plataforma** (`plataforma_integracoes`): Google Sheets, WhatsApp oficial e
  Meta Ads nascem **desligados**; com a chave desligada o banco recusa conexão, ignora
  webhook, não deixa resposta sair e não gera conversão — com ou sem credencial.
- **Ensaio** em cópia do nível de produção: `supabase/propostas/ensaio_integracoes.sh`
  (cada migration numa transação, invariantes antes/depois, conferência e rollback).
- **Rollback**: `supabase/propostas/rollback_integracoes.sql` (ensaiado).
- **Correções do ensaio**: `google_registrar_erro_conta` passou a `plpgsql` (a versão
  `sql` falhava num banco novo); `set client_encoding = 'UTF8'` nos arquivos (o `psql`
  do Windows podia gravar acentos errados).
- **Click-to-WhatsApp**: proposta separada (`supabase/propostas/20261101090000_capi_whatsapp_ctwa.sql`
  + `_shared/meta-conversoes-mensagens.ts`), formato Business Messaging
  (`business_messaging`, `messaging_channel: whatsapp`, `ctwa_clid` + WABA, eventos
  padrão `LeadSubmitted`/`QualifiedLead`/`Purchase`, dataset da WABA, token do número com
  `whatsapp_business_manage_events`). Não ligada ao serviço nem ao `db push`.
- Passo a passo da publicação: [PUBLICACAO-INTEGRACOES-GOOGLE.md](PUBLICACAO-INTEGRACOES-GOOGLE.md).
