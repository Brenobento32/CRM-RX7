@AGENTS.md

# Scorpion CRM

CRM comercial da Scorpion: gestão de clientes, funil de vendas multi-funil,
agenda, metas (TCV/MRR) e integrações (Respondi via Apps Script, Google
Calendar, WhatsApp). Ver o estado atual completo em
[`docs/SCORPION-MASTER.md`](docs/SCORPION-MASTER.md), arquitetura e convenções
de código em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md), prioridades
futuras em [`docs/SCORPION-ROADMAP.md`](docs/SCORPION-ROADMAP.md), e como
configurar uma máquina nova em [`docs/SCORPION-SETUP.md`](docs/SCORPION-SETUP.md).

## Arquitetura (resumo)

Next.js 16 (App Router) + Supabase (Postgres/Auth/Storage/Edge Functions).
Mutação é Server Action, leitura é RSC; nenhuma tela fala com o Supabase
direto, sempre via DAL (`lib/dal/**`). A segurança real é **RLS no
Postgres**, nunca um filtro no código da aplicação — o app usa a chave
`anon`; a `service_role` só existe no processo separado `whatsapp-service/`.

## Regras de negócio

- **SDR × CLOSER (handoff)**: um SDR trabalha o lead de "Lead Novo" até
  "Reunião realizada"; dali em diante só CLOSER ou GERENTE movimentam. É um
  teto absoluto, reforçado por trigger no banco
  (`negociacoes_valida_handoff_sdr`) — nunca relaxado por nenhuma permissão
  configurada, mesmo "por engano".
- **Permissões comerciais** (`permissoes_colaborador`): modelo configurável
  por colaborador/funil/etapa (ver/mover), **não aditivo** — `owner_id`
  **nunca** concede visualização ou movimentação para SDR/CLOSER, só a
  tabela de permissões decide. GERENTE sempre tem acesso total, sem precisar
  de nenhuma linha configurada. Detalhe completo em `SCORPION-MASTER.md`.
- **TCV/MRR**: classificação de venda/meta, nullable, sem backfill — nunca
  reclassifica histórico sozinho.
- **Respondi → CRM**: Google Forms → Sheets → Apps Script → Edge Function
  `ingestao-lead` → `ingerir_lead_formulario()` (upsert cliente + negociação).
  Ver `docs/GOOGLE-APPS-SCRIPT-LEADS.md`.

## Regras de segurança (nunca relaxar sem pedido explícito)

- Nenhum secret, token, senha ou chave privada vai para o Git — nunca. Isso
  inclui `.env*` (exceto `.env.example`) e qualquer coisa parecida com
  `SUPABASE_SERVICE_ROLE_KEY`, `BEGIN PRIVATE KEY`, credencial real.
- A sessão do WhatsApp (`whatsapp-service/auth_info_baileys*`, incluindo
  qualquer backup tipo `auth_info_baileys_backup_*`/`auth_info_baileys_old_*`)
  **nunca** vai para o Git — já está no `.gitignore`; não criar script que
  copie, leia ou publique esses arquivos.
- `service_role` nunca entra no caminho de um request do Next.js — só existe
  no `whatsapp-service`, um processo separado.
- Nunca usar `git add .` (ou `git add -A`) às cegas — sempre revisar
  `git status --short` e `git diff --cached` antes de comitar, com staging
  explícito do que é intencional.
- Nunca rodar `npx supabase db push --linked` (aplicação real) sem
  autorização explícita para aquela migration específica — `--dry-run`
  primeiro, sempre.

## Processo de trabalho

investigar → implementar → testar (`npm run test`) → revisar (`typecheck`,
`lint`, `build`, diff) → commit → push → deploy — nessa ordem, sem pular
etapa. Migration/deploy real em produção só com autorização explícita do
pedido em questão, nunca por iniciativa própria.
