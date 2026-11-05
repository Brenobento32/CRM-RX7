# App Review da Meta: app "AVANTE CRM" (preparação; NADA ENVIADO)

- **App:** ID 1849102593109058, portfólio Rio X7 (2430586127289598).
- **Embedded Signup:** configuração **"AVANTE WhatsApp ES v4"**, ID **2263375681228010**.

Conferido no painel da Meta em **04/11/2026**, só leitura, sem nenhuma alteração. Documentação usada:
[App Review para Tech Providers](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review)
e [versões do Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/).

## 1. Situação real (04/11/2026)

| Item | Situação no painel |
|---|---|
| Modo do app | **Não publicado** (desenvolvimento). Só quem tem papel no app usa (hoje: 1 administrador, 0 desenvolvedores). |
| Verificação da empresa (Rio X7) | **Aprovada** |
| Integridade | "Sua empresa foi autorizada a continuar com a integração." |
| Tech Provider independente | **1 de 2 etapas concluídas**: verificação da empresa aprovada; Análise do app pendente. O checklist mostra o rótulo "Em análise" nessa etapa, mas a página de envios diz **"Não enviado"**. Não existe pedido em análise. |
| Verificação de acesso | A Meta avisa que o uso em produção (empresas externas) exige a Análise do app **e depois** a verificação de acesso. Ainda não aparece como tarefa. |
| Embedded Signup | Configuração "AVANTE WhatsApp ES v4", versão **v4**, informações de sessão **3**. |
| Webhook do WhatsApp | URL de callback = Edge Function de produção (`…/functions/v1/integracoes/whatsapp/webhook`). Campos **assinados** (v26.0): `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`. |
| Testes de API exigidos | `whatsapp_business_messaging`: **0 de 1** chamada obrigatória. `whatsapp_business_management`: **0 de 1**. `business_management`: concluída. Cada teste vale 30 dias e pode levar até 24 h para aparecer. |
| Configurações básicas | E-mail de contato `suporte@riox7comunicacao.com.br`; domínio `avante.riox7comunicacao.com.br`; Política de Privacidade `/privacidade`; Termos `/termos`; exclusão de dados aponta para `/privacidade` (a página tem a seção "12. Como pedir a exclusão de dados"); categoria "Negócio e Páginas". |
| Ícone do app | **Não enviado** (a área de upload está vazia). O arquivo está pronto em `docs/meta-app/avante-icone-app-1024.png`. |
| Ações necessárias | Nenhuma. |
| Alertas | 1 não lido (não foi aberto, para não marcar como lido). |

### O envio em rascunho tem 12 itens, não só o WhatsApp

A Meta agora **analisa o app inteiro a cada envio**, incluindo os acessos atuais, o ícone e as URLs. Depois de enviado, **não dá para editar nem cancelar**. O rascunho atual inclui:

- **WhatsApp:** `whatsapp_business_messaging`, `whatsapp_business_management`.
- **Meta Ads e Lead Ads:** `ads_management`, `ads_read`, `leads_retrieval`, `pages_manage_ads`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`, `business_management` e **Marketing API Access Tier**.
- `public_profile` (padrão, sem vídeo).

**Decisão do proprietário antes do envio** (nada foi removido):
- (a) **Recomendado:** enviar agora só o WhatsApp. Os itens de Meta Ads saem **deste envio** pelo link "remover" do próprio rascunho, sem mexer nos casos de uso do app, e vão num envio próprio quando os vídeos de anúncios estiverem prontos.
- (b) Enviar tudo junto. Nesse caso, cada um dos 10 itens de anúncios também precisa de descrição e vídeo, e uma recusa em anúncios pode atrasar o WhatsApp.

Antes de remover qualquer item, conferir que o Meta Ads atual da Rio X7 (conta própria) continua com acesso padrão. Remover do envio não retira permissões já concedidas, mas vale confirmar no painel.

## 2. Ordem mínima até o envio

1. Publicar o MVP com o WhatsApp **desligado** (seção 7) e liberar **só a Empresa Teste A** na lista de homologação.
2. Conectar o **número de teste da Rio X7**, sem dados de cliente, pelo Embedded Signup, com o administrador do app. Isso faz as chamadas de teste das duas permissões: troca do código, leitura da conta e do número, inscrição no webhook e envio da resposta.
3. Esperar até 24 h e conferir em **Analisar › Teste**: 1 de 1 nas duas permissões.
4. Enviar o ícone (Configurações do app › Básico).
5. Gravar os 2 vídeos (seções 5 e 6).
6. Decidir (a) ou (b) acima, colar as descrições (seção 3) e as instruções ao revisor (seção 4) e **enviar, com a sua autorização**.
7. Depois da aprovação: fazer a **verificação de acesso** se a Meta pedir e, só então, conectar o primeiro cliente.

## 3. Descrições (colar em inglês no formulário)

**whatsapp_business_management**

> AVANTE CRM is a sales CRM used by small businesses. A business owner connects their own WhatsApp Business account through Embedded
> Signup, either as a new Cloud API number or keeping the number on the WhatsApp Business app (coexistence). We use
> whatsapp_business_management only on the accounts each client shares with us, to: read the shared WhatsApp Business account and its
> phone numbers so the client can confirm the right number; subscribe our app to that account's webhooks; register a Cloud API number
> with the client's 6-digit PIN; for coexistence numbers, request the app contacts sync at connection (contact names for the inbox)
> and request the chat history sync only when the business administrator explicitly authorizes it in the CRM, within Meta's 24-hour
> window; and read pricing analytics so the CRM can stop replies before free service conversations run out. We never create or send
> templates on the client's behalf, and each client pays Meta directly with their own payment method.

**whatsapp_business_messaging**

> AVANTE CRM lets each onboarded business answer the people who message it on WhatsApp. When a customer writes to the business number,
> the message appears in the CRM's Conversations screen and, for new contacts, a lead is created in the client's sales pipeline. A
> salesperson replies from the CRM only inside the 24-hour customer service window; free-form replies outside the window, templates,
> marketing and bulk sending are blocked in the product. For coexistence numbers, messages the business sends from the WhatsApp Business
> app are mirrored in the same conversation so the team sees the full thread. Delivery, read and failure statuses are shown next to
> each reply.

## 4. Instruções ao revisor (colar em inglês; credenciais só no momento do envio)

> AVANTE CRM is a web app at https://avante.riox7comunicacao.com.br. Reviewer access: sign in at /login with the demo account below
> (a demo company with fictitious data only; it can only see its own company).
>
> Email: [conta de revisor a criar, só com dados fictícios]
> Password: [informada só no formulário da Meta]
>
> To see the WhatsApp features: Settings › Integrations › WhatsApp Business shows the number connected through Embedded Signup and its
> sending policy ("free service replies only"). Conversations shows incoming messages and lets the user reply within the 24-hour
> window. The attached videos show the full Embedded Signup flow and a message sent from AVANTE being received on WhatsApp. The app
> never sends templates or bulk messages.

**Pendente, com autorização:** criar a conta de revisor (e-mail próprio da Rio X7, empresa de teste, dados fictícios), sem dar acesso a nenhuma empresa real.

## 5. Vídeo 1: `whatsapp_business_messaging` (≈ 2 min)

Pré-requisito: o passo 2 da seção 2 já concluído na Empresa Teste A. Nenhuma mensagem vai para quem não escreveu antes.

1. **Abertura (5 s):** navegador em `https://avante.riox7comunicacao.com.br`, com a barra de endereço visível. Legenda "AVANTE CRM — replying to a customer on WhatsApp".
2. **Contexto (10 s):** Configurações › Integrações › WhatsApp, com o número conectado. Legenda "Business number connected through Embedded Signup".
3. **Cliente escreve (20 s):** o celular de teste do proprietário manda "Olá, quero saber dos planos" para o número da empresa.
4. **Chegada no CRM (20 s):** Conversas mostra a mensagem recebida e o funil mostra o lead criado. Legenda "Incoming message creates a lead".
5. **Resposta (25 s):** digitar a resposta no CRM, enviar e mostrar o status enviado → entregue. Legenda "Reply sent with the Cloud API".
6. **Recebimento (20 s):** o mesmo celular, no WhatsApp móvel ou Web, exibindo a resposta. **É o ponto que a Meta exige ver.**
7. **Bloqueios (15 s, opcional):** aviso do CRM de que fora da janela de 24 h não há resposta livre.

Em coexistência, a inicialização do número precisa estar **concluída** antes do passo 3; senão a mensagem entra como "origem a revisar" e o lead não aparece.

## 6. Vídeo 2: `whatsapp_business_management` (≈ 2 min 30 s)

A Meta pede para gravar o app, ou o WhatsApp Manager, **criando um modelo de mensagem**. O AVANTE não cria modelos, então o vídeo mostra o uso real do produto e depois a criação no WhatsApp Manager, que a Meta aceita.

1. **Abertura (5 s):** Configurações › Integrações › WhatsApp, na Empresa Teste A.
2. **Onboarding (60 s):** cartão do WhatsApp → escolher funil, etapa e responsável → **Conectar WhatsApp** → janela oficial da Meta (login, portfólio, conta do WhatsApp e número) → concluir. Legenda "Client shares its own WhatsApp Business account via Embedded Signup".
3. **Uso da permissão (30 s):** número conectado (conta lida, nome verificado, webhook assinado). Em coexistência, mostrar também o quadro de inicialização (contatos recebidos; histórico opcional "only with admin authorization"). Legenda "We read the shared account and phone number, subscribe webhooks and request the app contacts sync".
4. **Modelo no WhatsApp Manager (45 s):** Modelos de mensagem › Criar modelo (categoria Utilidade, nome `teste_app_review`, texto curto) › Enviar para análise. Legenda "Message template created in WhatsApp Manager". **Só criar.** O AVANTE nunca envia o modelo.
5. **Fecho (10 s):** voltar ao AVANTE mostrando o número conectado.

## 7. Caminho mínimo para publicar o MVP desligado (cada passo com autorização)

1. **Commit** só dos arquivos do pacote, com staging explícito. **Push**.
2. **Backup** do banco de produção e linha de base: WhatsApp global `false`, nenhuma empresa liberada, CAPI pausada e travada, 0 números.
3. **Dry-run** que liste **só** `20261114090000_whatsapp_coexistencia_leads.sql`, depois `db push`.
4. **Deploy da Edge Function `integracoes`**: rota `/whatsapp/historico` e conexão pedindo só os contatos.
5. **Site na Hostinger:** ZIP do commit, sem arquivos locais.
6. **Pós-checagem:** chave global ainda `false`, nenhuma empresa liberada, CAPI igual, contagens iguais.

Com a chave desligada, nada muda para nenhuma empresa. Para o App Review, liberar só a Empresa Teste A (lista de homologação, auditada).

## 8. Cuidados de gravação (os dois vídeos)

- Só a Empresa Teste A e o celular de teste do proprietário; nenhum dado nem conversa real.
- Nunca mostrar token, App Secret, PIN digitado (borrar), cURL com token ou tela de secrets.
- Resolução 1080p, legendas em inglês, sem cortes nos momentos que a Meta precisa ver (mensagem chegando no celular; modelo criado).
- Um vídeo **por permissão**: gravação de tela, nunca captura estática.
