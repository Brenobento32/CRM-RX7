# Central de Integrações

Migration `20261104090000_central_integracoes.sql` (depende de `20261103090000`)
+ telas da Central, Super Admin, Sheets, WhatsApp e funil. Não publicada.

## Regras

- **Lançada** (chave global ou lista de homologação, como antes) **e permitida**
  (plano ou exceção do Super Admin). Não lançada nunca funciona nem aparece como
  operacional ("em breve").
- Plano: recursos cadastrados. `ingestao_leads` = captação completa (formulários
  + Google Sheets); **`formularios`** (novo) = só formulários (Formulário AVANTE,
  Respondi, webhook, credenciais de ingestão), sem Google Sheets; `whatsapp`;
  `meta_conversoes`. Para vender formulários no Starter sem abrir planilhas:
  marcar "Captação só por formulário" no plano e definir a quantidade de fontes.
- Exceção por empresa (`empresa_integracoes_regras`): liberar ou bloquear, com
  motivo, auditada em `admin_auditoria`. "Seguir o plano" remove a exceção.
- O bloqueio vale no banco: `integracao_habilitada()` exige permissão, e ela é
  chamada na conexão, na entrada de mensagens e no envio.
- Meta Ads: plano Business por padrão; outro plano só com liberação.
- Pedido de upgrade (`integracoes_solicitacoes`): registra o interesse; liberar
  pelo Super Admin atende o pedido. Nada é liberado sozinho.

## Limites (ausência de limite NÃO é ilimitado)

Três cotas independentes (uma não consome a outra):

| Cota | Coluna do plano | Conta | Vazio |
|---|---|---|---|
| Fontes de captação | `limite_integracoes` (já existia) | `uso_fontes()`: Formulário AVANTE, Respondi, webhook, Google Sheets, credenciais de ingestão | a definir: nenhuma fonte nova |
| Números de WhatsApp | `limite_numeros_whatsapp` (novo) | `uso_numeros_whatsapp()`: API oficial + app existente | a definir: nenhum número novo |
| Funis | `limite_funis` (novo) | funis ativos | a definir: só o 1º funil |
| Usuários | `limite_usuarios` | inalterado | inalterado |

- **Número de WhatsApp não gasta a cota de fontes** (a fonte `whatsapp_cloud` fica
  fora de `uso_fontes`); a Agenda Google também não (só o recurso do plano).
  `uso_integracoes()` (nome antigo, telas de assinatura) passa a ser a conta de fontes.
- Credencial de ingestão (Respondi via Apps Script) segue a permissão de
  formulários e a cota de fontes; vazio também é "a definir".
- Exceção por empresa: `empresa_limites` com recurso `fontes`, `numeros_whatsapp`
  ou `funis` (com motivo, auditada).
- O que já está em uso continua (só conexões/funis NOVOS são barrados).
- Empresa interna (Rio X7): sem limite de plano, como antes.
- Os dois cartões de WhatsApp contam no MESMO limite de números; o mesmo número
  (`phone_number_id`) nunca fica em duas empresas.

## Formulários e planilhas

Todas as colunas além de nome/telefone/e-mail/empresa/ID do lead ficam em
`negociacao_respostas` (por envio; pergunta repetida vira `_2`; vazia é
ignorada; reprocessar o mesmo envio atualiza sem duplicar; novo envio do mesmo
contato fica guardado à parte). Formulários por token (Respondi/webhook) passam
a guardar também as respostas sem pergunta cadastrada. Resumo (2 respostas) no
cartão do funil; lista completa na ficha do lead.

## WhatsApp — dois cartões, uma integração oficial

- **A — API Oficial:** número novo pela Cloud API (registro com PIN).
- **B — Conectar aplicativo existente:** coexistência oficial (Embedded Signup
  com `featureType: whatsapp_business_app_onboarding`, `sessionInfoVersion: '3'`).
  O número continua no app do celular; a confirmação é feita no app, pelo
  código ou QR Code que a janela oficial da Meta mostrar. App 2.24.17+.
- Mesma permissão (`whatsapp_oficial`), mesmo limite, mesmos webhooks, custos e
  isolamento. Depois da coexistência, o servidor pede `smb_app_data`
  (`smb_app_state_sync` e `history`, 24 h, uma vez por tipo).
- Webhooks: `smb_message_echoes` (enviadas pelo app), `history` (até 180 dias,
  só se a empresa aceitar; recusa 2593109 registrada) e `smb_app_state_sync`.
  Histórico entra nas conversas, sem criar negociação.
- **Sem WhatsApp Web, Baileys ou QR não oficial.** A demonstração local de
  espelhamento foi retirada do produto (servidor, telas e migration); o desenho
  ficou só como registro em `supabase/propostas/referencia_demo_whatsapp_qr_local.sql`
  (fora dos pacotes). `whatsapp-service/` (Baileys, sessão única, sem empresa)
  continua desligado e fora dos pacotes.
- Depende de teste real: elegibilidade do número, confirmação no app, assinatura
  dos campos de webhook no app da Meta, histórico real e cobrança.

## Testes locais

- SQL: `central_integracoes_test.sql` (72, inclui L7–L10 das cotas separadas) +
  registro 50, Sheets 75, franquia/CAPI 86, monitoramento 48.
- Unitários: `lib/integracoes/central.test.ts`, `central-edge.test.ts`.
- Ponta a ponta (emulador): `C:\Tools\avante-local\integracoes-e2e.mjs` (176).
- Tela: `central-ui.mjs` (27), `integracoes-ui.mjs`, `paginas-publicas-ui.mjs`.
- Testes antigos `fontes_leads`, `superadmin_assinaturas` e `integracoes_multiempresa`
  param em "clientes legados" com ou sem a Central (falha anterior, sem relação).

## Publicação (cada passo com autorização)

1. Pacote 1 — páginas (`paginas-publicas` 99befc6): migration `20261102120000`
   + ZIP `avante-1-paginas-publicas-99befc6`.
2. Pacote 2 — WhatsApp + páginas (merge 34e0c76): migration `20261103090000`,
   deploy da Edge Function `integracoes`, ZIP `avante-2-whatsapp-com-paginas-34e0c76`.
3. Pacote 3 — Central (sobre o pacote 2): Super Admin define os limites dos
   planos ANTES (fontes, números e funis de cada plano; sem isso, novas conexões
   ficam bloqueadas — as existentes continuam); migration `20261104090000` (recusa se alguma empresa com
   integração em uso perderia a permissão); deploy da `integracoes`; ZIP 3.
4. Meta: assinar os campos de webhook da coexistência e homologar.
