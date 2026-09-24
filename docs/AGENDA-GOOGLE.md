# Agenda Google — configuração da conexão (Agenda 2.0, Fase A)

Conecta o Google Calendar da conta `assessoriacomercial.scorpion@gmail.com` ao
CRM, **somente leitura** (escopo `calendar.readonly`). Nesta fase o CRM apenas
se conecta e roda o diagnóstico de cores; nenhum evento é importado ainda.

## Como funciona

```
Gerente clica "Conectar Google" (Configurações › Agenda Google)
  → Edge Function agenda-google cria um state de uso único e devolve o link
  → Google: login com a conta da empresa + consentimento
  → Google redireciona para  <SUPABASE_URL>/functions/v1/agenda-google/callback
  → a função troca o código pelo refresh token, confere que a conta é a
    permitida e guarda o token no Supabase Vault
  → volta para o CRM com ?google=conectado
```

- O **client secret** fica só nos secrets das Edge Functions.
- O **refresh token** fica só no Vault; nenhuma tabela que a aplicação lê o
  guarda. Nem o gerente consegue lê-lo (teste de fumaça, caso 59).
- Uma conta diferente de `GOOGLE_CONTA_PERMITIDA` é recusada e o acesso dela é
  revogado na hora.

## 1. Google Cloud (uma vez)

Faça logado com a conta `assessoriacomercial.scorpion@gmail.com`, em
<https://console.cloud.google.com>.

1. **Criar projeto**: "Scorpion CRM".
2. **Ativar a API**: APIs e serviços › Biblioteca › *Google Calendar API* › Ativar.
3. **Tela de consentimento OAuth** (APIs e serviços › Tela de consentimento / Google Auth Platform):
   - Tipo de usuário: **Externo** (conta Gmail não tem a opção Interno).
   - Nome do app: "Scorpion CRM"; e-mail de suporte: a conta da empresa.
   - Escopos: adicionar `https://www.googleapis.com/auth/calendar.readonly`.
   - Usuários de teste: adicionar `assessoriacomercial.scorpion@gmail.com`.
4. **Status de publicação: "Em produção"** (botão *Publicar app*).
   Em modo *Teste*, o Google invalida o refresh token de escopos sensíveis
   **a cada 7 dias**, e a conexão cairia toda semana. Em produção sem
   verificação o Google mostra o aviso "app não verificado" no consentimento —
   basta clicar em *Avançado › Acessar Scorpion CRM*. A verificação só seria
   necessária para mais de 100 contas, o que não é o caso.
5. **Credenciais** › Criar credenciais › **ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**.
   - URI de redirecionamento autorizado (exatamente):
     `https://lonyiyopurzxnczwrysm.supabase.co/functions/v1/agenda-google/callback`
   - Guarde o **Client ID** e o **Client secret**.

## 2. Secrets da Edge Function

Rode você mesmo (o client secret não deve passar pelo chat), trocando os valores:

```bash
npx supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID="…apps.googleusercontent.com" \
  GOOGLE_OAUTH_CLIENT_SECRET="…" \
  GOOGLE_CONTA_PERMITIDA="assessoriacomercial.scorpion@gmail.com" \
  CRM_URLS_PERMITIDAS="http://localhost:3000,https://scorpion-crm.vercel.app"
```

`CRM_URLS_PERMITIDAS` são as origens para onde o retorno do Google pode voltar
(sem barra no fim). Inclua o domínio de produção do CRM.

## 3. Banco e função

```bash
npx supabase db push                                   # migration 20260927120000
npx supabase functions deploy agenda-google --no-verify-jwt --use-api
npm run db:types
```

`--no-verify-jwt` é necessário porque o `/callback` chega do Google sem JWT.
As rotas POST conferem o JWT e `is_gerente()` dentro da função.

## 4. Conectar e diagnosticar

1. CRM › Configurações › **Agenda Google** › *Conectar Google*.
2. Entrar com `assessoriacomercial.scorpion@gmail.com`, aceitar o aviso de app
   não verificado e marcar a permissão de **ver a agenda**.
3. De volta ao CRM: *Rodar diagnóstico* (padrão: 90 dias para trás e 90 para frente).
4. A tabela mostra cada cor realmente usada (com o `colorId` do Google), a
   quantidade de eventos, o período e exemplos de título. É com ela que a
   Fase B define o que cada cor significa.

## Problemas comuns

| Sintoma | Causa |
|---|---|
| `redirect_uri_mismatch` no Google | A URI do passo 1.5 não está idêntica (https, sem barra no fim) |
| "Endereço de retorno não permitido" | A origem do CRM não está em `CRM_URLS_PERMITIDAS` |
| "A conta … não é a agenda da empresa" | Login feito com outra conta Google |
| Conexão cai após 7 dias | App ficou em modo *Teste* (passo 1.4) |
| "O Google recusou o acesso salvo" | Acesso revogado na conta Google; clique em *Reconectar* |
