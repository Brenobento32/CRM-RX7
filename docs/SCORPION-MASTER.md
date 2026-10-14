# Scorpion CRM — Estado atual

Snapshot do que existe no projeto **nesta data** (commit `b262a86`, branch
`main`). Não é arquitetura (isso é [`ARQUITETURA.md`](ARQUITETURA.md)) nem
setup (isso é [`SCORPION-SETUP.md`](SCORPION-SETUP.md)) — é "o que já foi
construído e o que falta", pra quem chega no projeto não precisar reconstruir
esse quadro lendo o histórico de commits inteiro. Prioridades futuras estão em
[`SCORPION-ROADMAP.md`](SCORPION-ROADMAP.md).

## Arquitetura atual (resumo)

- **Next.js 16** (App Router), Server Components + Server Actions; mutação é
  sempre Server Action, leitura é RSC. Ver particularidades da versão 16
  (`proxy.ts` em vez de `middleware.ts`, `cookies()`/`params` assíncronos) em
  `AGENTS.md`/`ARQUITETURA.md`.
- **Supabase** (Postgres + Auth + Storage + Edge Functions) como único banco
  e backend. Segurança real é **RLS no Postgres**, nunca filtro no código —
  o app usa a chave `anon`; a `service_role` só existe no `whatsapp-service`.
- Dois serviços Node separados no mesmo repositório: o CRM (raiz) e o
  `whatsapp-service/` (Baileys, processo independente).
- Dois alvos de "produção": o app na **Vercel**
  (`https://scorpion-crm.vercel.app`) e o banco no **Supabase**
  (`npx supabase db push --linked` aplica migrations — só com autorização
  explícita, nunca por rotina).

## Integrações

- **Respondi → CRM**: formulário externo → planilha Google → **Google Apps
  Script** (`docs/GOOGLE-APPS-SCRIPT-LEADS.md`) → POST com segredo no header
  → Edge Function `supabase/functions/ingestao-lead` →
  `public.ingerir_lead_formulario()` (upsert de cliente + negociação +
  respostas). Existe também um importador histórico
  (`scripts/importar-respondi.mts`, com testes) pra carga retroativa.
- **Google Calendar** (`docs/AGENDA-GOOGLE.md`): conexão OAuth só leitura
  (`calendar.readonly`), Edge Function `agenda-google`, refresh token no
  Supabase Vault — nunca em variável de ambiente do Next.js.
- **WhatsApp** (`whatsapp-service/`, Baileys): conexão por QR Code, leitura e
  envio de mensagens (texto, mídia, documento, áudio), criação automática de
  lead a partir de conversa nova, painel de conversa dentro do funil. Sessão
  (`auth_info_baileys/`) nunca vai pro Git — ver seção 19 de
  `SCORPION-SETUP.md`.
- **Importação de planilha/carteira inicial** (`scripts/importar-planilha.mts`)
  — migração pontual da base antiga em Excel.

## Banco

- Migrations em `supabase/migrations/`, uma por mudança, timestamp-prefixed.
  Cada migration de regra de negócio tem o dry-run correspondente em
  `supabase/tests/` (bloco `begin;...rollback;`, autoinstalável, nunca deixa
  nada gravado).
- `lib/types/database.ts` é gerado (`npm run db:types`), nunca editado à mão.
- Funis são multi-funil desde a Fase "Funil - suporte a múltiplos funis":
  cada funil tem suas próprias etapas (`etapas_funil`), com `chave` estável
  para etapas de sistema e `ordem` configurável pelo gerente.
- Fechamento (`fechar_negociacao`) e perda (`marcarPerdida`) são os únicos
  caminhos para entrar em etapa `ganha`/`perdida` — nunca um `UPDATE` cru.

## Produção

- App publicado na Vercel; deploy e variáveis de ambiente lá (ver
  `SCORPION-SETUP.md` para recuperar com `vercel env pull`).
- Banco Supabase vinculado via `npx supabase link --project-ref
  lonyiyopurzxnczwrysm`; qualquer migration real exige `db push --linked`
  **só com autorização explícita**, nunca automática.

## Permissões comerciais (SDR/CLOSER/GERENTE)

Modelo configurável por colaborador, substituindo qualquer regra fixa de
"todo SDR vê tudo":

- Tabela `permissoes_colaborador(usuario_id, funil_id, etapa_id?, pode_ver,
  pode_mover)` — linha com `etapa_id` nulo = acesso ao funil (pré-requisito);
  linha com `etapa_id` preenchido = permissão fina daquela etapa.
- **Não é aditivo**: `owner_id` (quem é o responsável pelo lead) **nunca**
  concede visualização nem movimentação para SDR/CLOSER — só
  `permissoes_colaborador` decide. Confirmado por teste real contra produção
  (owner dono, sem permissão, não vê nem move a própria negociação).
- **GERENTE** continua com acesso total, sempre, sem precisar de nenhuma
  linha configurada.
- Tela de configuração: Configurações → Usuários → editar colaborador →
  "Permissões comerciais" (funil + tabela de etapas com Visualizar/
  Movimentar). Marcar "Movimentar" liga "Visualizar" automaticamente.
- Reforço no banco, em duas camadas independentes:
  - `negociacoes_select`/`clientes_select`/etc.: `is_gerente() OR
    pode_ver_etapa(funil_id, etapa_id)`.
  - Trigger `negociacoes_protege_movimentacao_por_permissao` (`BEFORE UPDATE
    OF etapa_id`): fecha o bypass que a policy `negociacoes_update`
    (`owner_id OR gerente`, necessária pra edição dos outros campos) ainda
    permitia só pra essa coluna — qualquer caminho que mude etapa_id (RPC
    `mover_negociacao`, `fechar_negociacao`, reativar lead arquivado, ou uma
    chamada direta à API) passa por `pode_mover_etapa`, nunca por owner_id.
- **Handoff SDR → CLOSER**: trigger separado
  (`negociacoes_valida_handoff_sdr`), teto absoluto — um SDR nunca move uma
  negociação além da etapa de chave `reuniao_realizada` no mesmo funil,
  mesmo que alguma permissão libere isso "por engano". Não é relaxado por
  nenhuma permissão configurada.
- CLOSERs já existentes, no momento da migration, receberam backfill
  (acesso ao funil + ver/mover em todas as etapas ativas onde já atuavam) —
  só como estado inicial; o gerente edita livremente depois pela tela. SDR
  nunca é backfillado — todo SDR novo começa zerado.
- Limitação aceita e documentada (não corrigida por não ter solução sem
  inventar regra nova): um cliente sem **nenhuma** negociação (caso raro —
  `criar_cliente`/`criar_cliente_whatsapp` sempre criam cliente+negociação
  juntos; só ocorre se todas as negociações dele forem excluídas) não é
  visível a SDR/CLOSER, só ao gerente — não há coluna de funil/etapa no
  cliente pra inferir permissão, e a decisão foi não ampliar RLS pra
  compensar isso.

## TCV / MRR

Classificação de venda (`tipo_venda`) em `fechamentos` e de meta
(`tipo_meta`) em `metas` — `nullable`, sem backfill: registros anteriores à
classificação continuam `null` ("não classificado"); só quem escolhe
ativamente TCV ou MRR na tela passa a ter o campo preenchido. Nunca
reclassifica histórico sozinho (`coalesce` preserva o valor atual quando a
chamada não manda um novo).

## Kanban

- Lê a view `funil_cards` (`security_invoker`) — a visibilidade é 100% da RLS
  das tabelas de origem (`negociacoes`, `clientes`, etc.), nunca de um filtro
  por `owner_id` no código.
- Cards em etapa `ganha`/`perdida` saem do quadro depois de
  `DIAS_VISIVEIS_ENCERRADOS` (30 dias) na etapa.
- Drag-and-drop (`dnd-kit`) com UI otimista; mover entre etapas abertas vai
  pelo RPC `mover_negociacao`; entrar em `ganha`/`perdida` só pelo modal de
  fechamento/perda.
- Mostra "parado há X" na etapa atual (relativo, calculado a partir de
  `data_entrada_etapa`).
- Zona de recuperação, múltiplos funis, reordenação de etapas abertas,
  edição rápida pelo próprio card, painel de conversa WhatsApp integrado.

## Ficha do cliente / desqualificação

- Ficha do cliente (`/clientes/[id]`) consolida negociações, atividades,
  próximas ações e (quando aplicável) a conversa de WhatsApp.
- "Desqualificar lead" é soft delete (`arquivada_em` + motivo obrigatório) —
  nunca apaga a negociação, o cliente, conversas ou histórico; o card some do
  Kanban porque `funil_cards` filtra `arquivada_em is null`.
- Reativar um lead arquivado volta pra etapa inicial do mesmo funil (pela
  flag `etapa_inicial`, nunca pelo nome da etapa) — sujeito à mesma proteção
  de permissão de qualquer outra mudança de etapa.
- Exclusão permanente de cliente é auditada (ação separada da
  desqualificação, mais restrita).

## Tempo na etapa atual

Texto relativo no card ("Parado há 10 min" / "1h" / "2 dias"), calculado a
partir de `negociacoes.data_entrada_etapa` (reinicia a cada troca de etapa).

## Recuperação de senha

Fluxo via **Supabase Auth nativo** (`resetPasswordForEmail` /
`updateUser`) — sem token customizado, sem tabela própria de tokens.

## SDR × CLOSER (papéis)

- Enum `user_role` com `gerente`, `closer`, `sdr`.
- Regra de negócio (handoff): SDR trabalha o lead de "Lead Novo" até
  "Reunião realizada"; a partir daí só CLOSER ou GERENTE movimentam —
  reforçado no banco (trigger, independente de qualquer permissão) e também
  checado em TypeScript antes de chamar o RPC, pra dar mensagem amigável sem
  round-trip.
- Visualização e movimentação de SDR/CLOSER dependem só de
  `permissoes_colaborador` (ver seção acima) — nunca de `owner_id`.

## Funcionalidades concluídas (visão rápida)

Autenticação e layout · módulo Clientes (CRUD, arquivamento, exclusão
auditada) · Funil Kanban multi-funil (etapas configuráveis, zona de
recuperação, drawer de negociação, conversão por etapa) · Atividades e
próximas ações · Agenda nativa (séries, recorrência, cores por usuário,
integração só-leitura com Google Calendar) · Dashboard com KPIs · Metas
comerciais (mensal, por closer, TCV/MRR) · Catálogo de serviços e propostas
(`/propostas/abertas`, `/fechadas`) · Métricas do funil (conversão, tempo na
etapa, cards parados) · Gestão de usuários e cores · Importação de carteira
(planilha/Excel) e de histórico Respondi · Integração WhatsApp completa
(conexão, envio/recebimento de texto/mídia/documento/áudio, criação
automática de lead, painel de conversa) · Ingestão automática de leads via
Google Apps Script → Edge Function · Permissões comerciais configuráveis por
colaborador (este documento, seção dedicada acima) · Proteção de
movimentação por permissão (trigger de banco, fecha bypass de owner_id) ·
TCV/MRR · recuperação de senha nativa.

## Decisões de produto registradas — AINDA NÃO IMPLEMENTADAS

Esta seção registra decisões de produto já tomadas, para não se perderem,
**sem que nenhuma delas tenha sido implementada ainda**. Prioridade e
sequenciamento em [`SCORPION-ROADMAP.md`](SCORPION-ROADMAP.md); a regra
matemática de conversão (pendente de especificação) está em
[`SCORPION-REGRAS-NEGOCIO.md`](SCORPION-REGRAS-NEGOCIO.md).

### Metas (TCV/MRR)

- Metas TCV e MRR são **independentes** entre si (não é uma meta só dividida
  em dois jeitos de ver).
- A tela de metas deve ser filtrável por **funil** e por **período**.
- Boxes e gráficos da tela de metas devem respeitar exatamente os filtros
  selecionados (nunca mostrar um número e um gráfico calculados com
  filtros diferentes um do outro).
- Os cálculos precisam ser baseados em **dados históricos corretos** — nunca
  simplesmente o estado atual dos cards (ver `SCORPION-REGRAS-NEGOCIO.md`).

### Funil de conversão

- Mostrar quantos leads entraram no funil (no período/funil filtrado).
- Mostrar quantos avançaram em cada etapa.
- Mostrar taxa de conversão por etapa.
- Dinâmico por funil e por período (mesmo requisito de filtro da tela de
  metas).
- Evitar duplicidade quando uma negociação entra novamente na mesma etapa
  (ex.: volta de "Reunião realizada" pra "Reunião agendada" e passa por ela
  de novo) — isso não pode contar como dois leads/duas entradas.
- Fonte de verdade: **histórico real de movimentação**
  (`historico_etapas`), nunca o estado atual das negociações.
- A regra matemática exata de cohort/conversão ainda **não foi definida** —
  fica como item de especificação pendente, a ser definida e testada
  rigorosamente antes de implementar (ver `SCORPION-REGRAS-NEGOCIO.md`).

### Card/Métricas — fonte única de verdade

- Todos os indicadores (dashboard, metas, funil de conversão, qualquer outro
  box/gráfico) devem usar **uma única fonte de verdade** (uma única
  camada/função de cálculo).
- Boxes e gráficos não podem apresentar números calculados por regras
  diferentes entre si, mesmo que pareçam medir "a mesma coisa".

### Configurações — organização por domínio

Reorganizar `/configuracoes` em três domínios (hoje as páginas existem, mas
não estão agrupadas assim na navegação):

- **Funil**: etapas do funil, demais configurações relacionadas ao funil.
- **Clientes**: nichos, serviços, demais configurações relacionadas a
  clientes.
- **Configurações gerais**: logo, dados básicos da empresa, usuários,
  permissões, integrações, demais configurações gerais.

### Permissões administrativas (nova categoria, separada da comercial)

- Hoje só existe permissão **comercial** (`permissoes_colaborador`: ver/
  mover leads — ver seção "Permissões comerciais" acima).
- Decisão: criar uma categoria **separada**, permissão **administrativa**
  (acessar/configurar os módulos de Configurações).
- GERENTE continua com controle total das configurações.
- GERENTE pode conceder acesso administrativo a SDR/CLOSER
  **individualmente** (não é um nível de papel fixo — é concedido pessoa a
  pessoa, do mesmo jeito que a permissão comercial hoje é por colaborador).
- As duas permissões (comercial e administrativa) são **independentes**: ter
  uma não implica nem afeta a outra.

### UX — padrão consistente

- Princípio do produto: **"uma mesma ação deve se comportar da mesma forma
  em todo o CRM."**
- Padronizar: abrir, editar, salvar, cancelar, fechar, ESC, mensagens de
  sucesso, mensagens de erro, estado de carregamento — em botões, painéis e
  modais de todas as telas.
- Priorizar simplicidade e baixa curva de aprendizado — a experiência
  precisa funcionar bem para usuários com níveis de conhecimento técnico
  bem diferentes entre si (gerente, SDR, closer).

### Integrações — menu dedicado

Criar um menu **"Integrações"** (hoje não existe como agrupamento próprio):

- **WhatsApp**: integração já existente (conexão por QR Code) — continua
  funcional exatamente como está; só passa a aparecer dentro desse menu.
- **Google Sheets**: item reservado no menu, integração futura — nada
  implementado ainda.
- **Respondi**: item reservado no menu; o webhook atual
  (`docs/GOOGLE-APPS-SCRIPT-LEADS.md` → Edge Function `ingestao-lead`)
  continua sendo a integração de verdade; no futuro, permitir
  gerenciar/configurar essa integração pelo próprio CRM em vez de só pelo
  Apps Script.
- **Meta Ads**: integração futura — objetivo é devolver eventos/conversões
  do CRM para o Meta (lead recebido, lead qualificado, reunião realizada,
  venda), para permitir otimização de campanha com dados reais do funil.
- **Google Ads**: integração futura — mesmo objetivo do Meta Ads, devolvendo
  eventos/conversões reais do CRM para o Google Ads.

Nenhuma dessas integrações novas (Google Sheets, Meta Ads, Google Ads, nem a
configuração de Respondi pelo CRM) foi implementada — são só reservas de
espaço no menu e de intenção de produto.

### SaaS / multiempresa (visão futura, não iniciada)

Todas as decisões acima já foram tomadas pensando na futura transformação do
Scorpion em um produto SaaS multiempresa — sem que a multiempresa em si
tenha sido implementada ainda. A arquitetura futura deverá permitir isolar
por organização: empresa, usuários, logo, configurações, funis, permissões
e integrações. Ver `SCORPION-ROADMAP.md`.

## Funcionalidades pendentes (visão rápida)

Ver [`SCORPION-ROADMAP.md`](SCORPION-ROADMAP.md) para prioridades e
detalhamento, e a seção acima ("Decisões de produto registradas") para o
que já foi decidido mas ainda não implementado. Também em aberto, de acordo
com `ARQUITETURA.md` e o estado atual: relatórios de performance por
closer/conversão com export CSV; acabamento geral (Realtime, estados
vazios, responsivo, auditoria completa de policies).
