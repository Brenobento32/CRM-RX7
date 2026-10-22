# Runbook — implantação do AVANTE (CRM-RX7 SaaS, Supabase + Hostinger Business)

**AVANTE** é o nome comercial do CRM-RX7 SaaS, produto da Rio X7 Agência Digital.
Nomes técnicos (repositório, Project Ref, migrations, `rx7_*`) continuam os mesmos.

Destino único: repositório `Brenobento32/CRM-RX7`, Supabase **CRM-RX7**
(`ybgzlxgeoiggmfdxarqx`), um **Web App Node.js novo** na Hostinger
(`https://avante.riox7comunicacao.com.br`). O CRM pessoal da Hostinger e a Scorpion não
são tocados. O Respondi antigo é da Scorpion e **não faz parte do RX7**: não é
requisito nem bloqueio (cada empresa conecta o próprio Respondi como fonte de leads).

🔒 = exige sua autorização explícita no momento da execução.

---

## 0. Bloqueantes (resolver antes de marcar a janela)

| # | Verificação (só leitura) | Por quê |
|---|---|---|
| B1 | ✅ **Confirmado (22/10)**: o CRM pessoal usa outro projeto Supabase (`zmwq…`), não o RX7. | A T4 esconde todo dado sem empresa na requisição. |
| B3 | ⏳ A conta GitHub conectada à Hostinger é `riox7comunicacao-design` (repositório do CRM pessoal); o RX7 é de `Brenobento32`. **Não trocar a conexão**: primeiro deploy por ZIP do commit (5.3) ou, com aprovação, colaborador no repositório. | A Hostinger aceita uma conta GitHub por vez. |
| B4 | ⏳ O código do SaaS está **sem commit**. 🔒 commit + push (staging explícito, nunca `git add .`). | Origem do código e do ZIP. |
| B5 | ⏳ Token novo da Supabase CLI (os antigos foram revogados). | Deploy das Edge Functions e secrets. |
| B6 | ✅ (22/10) `avante.riox7comunicacao.com.br` livre no DNS; o domínio usa os nameservers da Hostinger (`*.dns-parking.com`). Criar o subdomínio **só pelo assistente do Web App Node.js novo**, nunca em Domínios → Subdomínios de um site existente (ele ficaria preso àquele site). | Subdomínio do app novo. |

## 1. Pré-requisitos

- Node **22** no app da Hostinger (Next 16 exige ≥ 20.9; `.nvmrc` = 22).
- PostgreSQL local de ensaio parado ou ligado — não interfere.
- Arquivos (fora do Git, em `C:\Tools\crm-rx7\saida\`):

| Arquivo | SHA-256 |
|---|---|
| `aplicar-m1-rx7.sql` (M1 + registro da 190000) | `979ADB65CDD573DEE7BE6F2783B59E173F4B6206C105568141C705687E939D75` |
| `aplicar-saas-rx7.sql` (T1→T14, gerado por `montar-aplicacao-saas.ps1`) | `A40C0B53125C2945FB122DB8345961A05402C8DB1C847BAD77F058C880A2655E` |

Conferir antes de usar: `Get-FileHash <arquivo> -Algorithm SHA256`.

Migrations incluídas (SHA-256 conferido pelo gerador; qualquer mudança aborta a montagem):

| Ordem | Versão | Arquivo | SHA-256 (início) |
|---|---|---|---|
| 0 | 20261021190000 | remove_etapas_proposta_negociacao (já aplicada; só registrada pela M1) | `B528308F…` |
| M1 | 20261021200000 | escopo_dados_legado_rx7 | `22BDC491…` |
| T1 | 20261022130000 | tenants_base | `EA40CEF1…` |
| T2 | 20261022140000 | tenants_iniciais (+ vínculo do proprietário) | `1AA76727…` |
| T3 | 20261022150000 | tenant_id_tabelas | `9846C05F…` |
| T4–T7 | 20261022160000 | tenant_isolamento | `67684C38…` |
| T8 | 20261022170000 | tenant_rpcs | `4AF72C61…` |
| T9 | 20261023100000 | onboarding_empresa | `EAB6AC5C…` |
| T10 | 20261023110000 | ingestao_credencial | `8BE071EA…` |
| T11 | 20261023120000 | google_agenda_por_empresa | `785EAA86…` |
| T12 | 20261023130000 | storage_realtime_empresa | `F7C029B8…` |
| T13 | 20261024100000 | planos_assinaturas | `29E20DFF…` |
| T14 | 20261025100000 | fontes_leads | `299A809B…` |

`supabase/tests/scaffold_local_integracoes.sql` é **só do ensaio local** (aborta fora de `crm_rx7_*`) e nunca vai para o Supabase.

## 2. Backup e segurança (início da janela)

1. Parar o uso do CRM-RX7 local (`npm run dev`) — nenhuma gravação durante a janela.
2. Rodar `C:\Tools\crm-rx7\backup.ps1` (backup novo, somente leitura no Supabase).
3. Conferir no Dashboard que o projeto aberto é **CRM-RX7 / ybgzlxgeoiggmfdxarqx**.

## 3. Migrations 🔒

No **SQL Editor** do CRM-RX7, cada arquivo inteiro, uma vez:

1. 🔒 `aplicar-m1-rx7.sql` — trava de identidade/linha de base/corte; M1; registra 190000 e 200000.
   Se abortar com "registro depois do corte", alguém gravou no RX7 depois de 21/10 21:00 UTC: parar e reavaliar.
2. 🔒 `aplicar-saas-rx7.sql` — **uma transação**: trava (M1 aplicada, SaaS não), T1→T14 byte a byte,
   vínculo do proprietário (admin da Rio X7, leitura no arquivo), Super Admin = proprietário, registro das 11
   versões e conferência final (contagens 74/79/14/9/69/35/5/188, faturamento set R$ 33.650 / out R$ 17.900,
   todo legado no arquivo, Rio X7 com funil principal + 6 etapas, 2 empresas, 2 vínculos, 3 planos sem preço,
   102 policies RESTRICTIVE). Qualquer falha desfaz tudo.
3. Conferir: `select version from supabase_migrations.schema_migrations order by version desc limit 13;` → 13 linhas até 20261025100000.

Ensaio refeito em 22/10 (com T14) sobre restauração limpa do backup `20261022-095921`: M1 ✔, pacote ✔ (13 versões), reaplicação barrada pela trava ✔, testes de fontes de leads, A/B, integrações, assinaturas e concorrência ✔ no estado final.

## 4. Edge Functions, secrets e configurações 🔒

### Publicar (projeto `ybgzlxgeoiggmfdxarqx`)

| Função | Comando | JWT |
|---|---|---|
| `admin-usuarios` | `npx supabase functions deploy admin-usuarios --project-ref ybgzlxgeoiggmfdxarqx` | verificado (config.toml) |
| `agenda-google` | `npx supabase functions deploy agenda-google --project-ref ybgzlxgeoiggmfdxarqx` | sem (callback do Google) |
| `ingestao-lead-empresa` (nova) | `npx supabase functions deploy ingestao-lead-empresa --project-ref ybgzlxgeoiggmfdxarqx` | sem (token da fonte) |
| `meta-webhooks` (nova; Lead Ads + WhatsApp Cloud) | `npx supabase functions deploy meta-webhooks --project-ref ybgzlxgeoiggmfdxarqx` | sem (assinatura da Meta) — pode ficar para quando o app da Meta existir |

`ingestao-lead` (caminho antigo do Respondi da Scorpion) **não** é publicada no RX7. `_shared/` vai junto automaticamente.

### Secrets (Edge Functions → Secrets; nunca no app nem no Git)

| Secret | Situação | Valor |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | automáticos | — |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | conferir se existem (`npx supabase secrets list` mostra só nomes) | do Google Cloud |
| `CRM_URLS_PERMITIDAS` | conferir/ajustar | `http://localhost:3000,https://avante.riox7comunicacao.com.br` |
| `GOOGLE_OAUTH_STATE_SECRET` | **criar** | aleatório, ≥ 32 caracteres |
| `CRM_SITE_URL` | **criar** | `https://avante.riox7comunicacao.com.br` (link do convite) |
| `GOOGLE_OAUTH_REDIRECT_URI` | opcional | padrão: `https://ybgzlxgeoiggmfdxarqx.supabase.co/functions/v1/agenda-google/callback` |
| `GOOGLE_CONTA_PERMITIDA` | obsoleto | pode ficar; a conta aceita agora é por empresa |
| `META_APP_SECRET`, `META_VERIFY_TOKEN` | **criar só ao ativar Meta/WhatsApp** | do app da Meta da Rio X7 (Lead Ads e WhatsApp Cloud API) |
| `META_GRAPH_VERSION` | opcional | padrão `v21.0` |

### Auth → URL Configuration

- Site URL: `https://avante.riox7comunicacao.com.br`
- Redirect URLs: `https://avante.riox7comunicacao.com.br/auth/callback` e manter `http://localhost:3000/auth/callback`.
- Convites sem senha usam e-mail do Auth: o SMTP padrão do Supabase tem limite baixo — para clientes, configurar SMTP próprio (pode ficar para depois; com senha inicial não precisa).

### Google Cloud (sem mudar nada agora)

- O redirect cadastrado precisa ser o mesmo de `GOOGLE_OAUTH_REDIRECT_URI` (padrão acima).

### Storage e Realtime

- Storage: buckets `avatares` (público) e `whatsapp-midia` (privado) precisam existir no RX7 — conferir no Dashboard. As policies por empresa vêm da T12.
- Realtime: nada a ligar. O painel usa canal **privado** `empresa:<id>:conversa:<id>`, autorizado pela policy da T12 em `realtime.messages`.

## 5. Deploy na Hostinger 🔒

1. hPanel → Sites → **Crie um site → Web app Node.js** (não editar o do CRM pessoal). Na tela de domínio, digitar `avante.riox7comunicacao.com.br` e escolher a sugestão "Você é o proprietário deste domínio" (o aviso "registrado em outro provedor" é sobre o registro; o DNS já está na Hostinger).
2. Configuração (preset **Next.js**, detectado sozinho):
   - Node: **22.x**
   - Build: script `build` (`next build`), escolhido na lista
   - Diretório de saída: `.next`
   - Start: não há campo — a Hostinger sobe o servidor `standalone` do Next sozinha (ela força `output: "standalone"`; o `next.config.ts` é um objeto, compatível)
3. Origem do código — **ZIP** (a conta GitHub conectada na Hostinger é a do CRM pessoal; não trocar):
   - gerar: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Tools\crm-rx7\montar-zip-hostinger.ps1`
     (confere repositório, branch `main`, árvore igual à prévia validada e ausência de `.env`/`.claude`/`node_modules`/`.next`);
   - no app novo, escolher "Upload your files" (ZIP) em vez de GitHub e subir `avante-saas.zip` (gerado por `C:\Tools\crm-rx7\montar-zip-avante.ps1`, conferir o `.sha256`);
   - atenção (visto em 22/10): o **"Próximo" da tela de domínio já cria o site** `avante.` na lista (ícone PHP/HTML, "Página padrão" da Hostinger) e os registros DNS do subdomínio. O build/publicação do app só acontece no botão **Deploy** (🔒), depois do upload e das variáveis;
   - prévia validada em 22/10 (mesmo conteúdo do commit planejado): `npm ci` + `npm run build` a partir do ZIP extraído.
4. Variáveis do app (build e runtime): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://avante.riox7comunicacao.com.br`. Nada de `service_role`. **`NEXT_PUBLIC_SITE_URL` é obrigatória**: sem ela o app cai em `http://localhost:3000` e os links de e-mail (recuperar senha) quebram.
5. SSL do subdomínio ativo antes de testar o login.

Build local de produção (22/10): `next build` ok, 53 rotas, sem avisos. Sem dependência da Vercel; binários Linux (sharp, swc, lightningcss, tailwind oxide) já estão no `package-lock.json`.

## 6. Verificação mínima pós-publicação

1. Login com o proprietário → `/empresas` mostra Rio X7, Arquivo legado e o link "Painel Super Admin".
2. `/e/arquivo-legado`: 74 clientes, faturamento set R$ 33.650 / out R$ 17.900; tentar editar → recusado (somente leitura).
3. `/e/rio-x7`: vazio, funil principal com 6 etapas; criar e apagar um cliente de teste.
4. `/admin`: lista 2 empresas; Planos com preços "a definir". Uma aba anônima em `/admin` → login; usuário comum → 404.
5. Esqueci a senha → o e-mail aponta para `https://avante.riox7comunicacao.com.br/auth/callback`.
6. CRM pessoal: abrir e confirmar que nada mudou.

## 7. Interrupção e recuperação

| Situação | Ação |
|---|---|
| Trava ou conferência aborta no SQL Editor | Nada foi gravado (transação). Parar, anotar a mensagem, não reexecutar com ajuste manual. |
| Migrations ok, app com problema | Parar o app novo na Hostinger. O banco fica consistente; o CRM pessoal não depende dele. Corrigir e publicar de novo. |
| Erro grave de dados depois do COMMIT | 🔒 Restaurar o backup do passo 2 (pg_restore do schema `public`) — destrutivo, só com sua autorização, de preferência com o app parado. Preferir correção por migration nova quando possível. |
| Edge Function com erro | 🔒 Republicar a versão anterior a partir do commit anterior (`git checkout <commit> -- supabase/functions/<nome>`), ou desativar a integração afetada. |
| Hostinger sem rollback | Republicar o commit anterior; o app é novo, então "voltar" = parar/remover o app novo. |
