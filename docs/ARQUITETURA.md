# Scorpion CRM — Arquitetura

CRM comercial da Scorpion. Documento de referência para quem for mexer no
projeto: decisões tomadas, o porquê delas, e o que não pode ser afrouxado.

## Stack

| Camada | Escolha | Observação |
| --- | --- | --- |
| Framework | Next.js 16.3.6 (App Router) | Turbopack por padrão; APIs de request são assíncronas |
| UI | React 19.2 + Tailwind CSS v4 | Tailwind v4 sem `tailwind.config.js` — tema via `@theme` em `app/globals.css` |
| Linguagem | TypeScript 5 (strict) | Alias `@/*` aponta para a raiz do projeto |
| Backend | Supabase (Postgres + Auth + RLS + Storage) | RLS é a fronteira de autorização |
| Validação | Zod 4 | Schemas em `lib/validations`, usados nas Server Actions |
| Datas | date-fns + date-fns-tz | Agenda e relatórios em `America/Sao_Paulo` |
| Kanban | @dnd-kit | Drag-and-drop acessível, compatível com React 19 |
| Gráficos | Recharts | Relatórios e dashboard |

Requisitos mínimos do Next 16: **Node.js 20.9+** e TypeScript 5.1+.

## Particularidades do Next.js 16

Este projeto roda numa versão do Next.js cujas convenções divergem da maior
parte do material disponível online. Antes de copiar qualquer snippet,
consulte `node_modules/next/dist/docs/`.

1. **`middleware.ts` não existe mais — o arquivo é `proxy.ts`**, na raiz do
   projeto. Comportamento idêntico, nome novo.
2. **APIs de request são assíncronas.** `cookies()`, `headers()`, `params` e
   `searchParams` só funcionam com `await`. O acesso síncrono foi removido —
   é isso que quebra os tutoriais de Supabase + Next que circulam por aí.
3. **Cache Components (`use cache`) é opt-in** e está **desligado** neste
   projeto. Ver "Cache" abaixo.
4. **Invalidação pós-mutação tem três verbos:** `updateTag` (o usuário precisa
   ver a própria escrita imediatamente), `revalidateTag` (stale-while-
   revalidate, não força re-render na resposta da action) e `revalidatePath`
   (uma rota específica).

## Modelo de segurança

O princípio que organiza o projeto inteiro:

> **A permissão vive no banco. O código da aplicação é conveniência.**

Se a regra "closer vê apenas seus clientes" existir só no TypeScript, basta uma
query sem filtro para vazar a carteira inteira — e a falha é silenciosa. Com
RLS, o Postgres devolve apenas as linhas permitidas mesmo num `select *`.

### Papéis

| Ação | Gerente | Closer |
| --- | --- | --- |
| Ver clientes | Todos | Apenas os seus |
| Editar clientes | Qualquer um | Apenas os seus |
| Mover negociações no funil | Qualquer uma | Apenas as suas |
| Relatórios por closer | Sim | Apenas os próprios números |
| Metas | Cria, edita e remove (empresa e por closer) | Vê apenas a própria |
| Catálogo de serviços | Cria, edita, desativa e exclui (se nunca usado) | Consulta os ativos |

### Como isso é aplicado

1. **RLS no Supabase** — policies em todas as tabelas de dados. Única fonte de
   verdade da autorização.
2. **Chave `anon`, nunca `service_role`** — o JWT do usuário viaja na
   requisição, então o Postgres sabe quem está perguntando. A `service_role`
   ignora a RLS e não deve existir no caminho de nenhum request do Next.

   **Exceções:** as Edge Functions `admin-usuarios` e `agenda-google`.

   `agenda-google` (Agenda 2.0) faz o OAuth com o Google Calendar da empresa
   e guarda o refresh token no Supabase Vault; o client secret do Google fica
   nos secrets das Edge Functions. Deploy com `--no-verify-jwt` (o retorno do
   OAuth chega sem JWT); as rotas POST conferem JWT e `is_gerente()` dentro da
   função. Configuração: `docs/AGENDA-GOOGLE.md`.

   A Edge Function `admin-usuarios`
   (`supabase/functions/admin-usuarios`). Criar usuário e bloquear o login no
   Auth exigem a API de admin, que só funciona com a `service_role`. A chave
   fica no ambiente das Edge Functions (injetada pelo Supabase), nunca no
   `.env` do Next. A função exige JWT e confere `is_gerente()` com o token de
   quem chama antes de usar o cliente admin. Deploy:
   `npx supabase functions deploy admin-usuarios --use-api`.
3. **Data Access Layer (`lib/dal`)** — único lugar que conversa com o banco.
   Verifica a sessão, aplica filtros e devolve DTOs enxutos, de modo que
   nenhum objeto cru de banco chegue a um Client Component.
4. **`proxy.ts`** — apenas renova a sessão e faz redirect otimista de quem não
   está logado. Nunca consulta o banco: ele roda em toda navegação, inclusive
   nos prefetches do `<Link>`.

### Cache

`cacheComponents` fica **desligado** enquanto o CRM for majoritariamente dado
por usuário. Cache de página com conteúdo de um closer é a origem clássica do
bug "o closer A viu a carteira do closer B". Quando for ligado, deve ser
pontual e apenas sobre agregados que não contenham dado individual.

## Estrutura de pastas

```
app/
  (auth)/          rotas públicas (login) — layout sem sidebar
  (app)/           rotas autenticadas — dashboard, clientes, funil, agenda, relatórios
  api/             apenas o que precisa de HTTP de verdade (webhooks, exports)
  globals.css      tema Tailwind v4 + tokens de cor das etapas do funil
  layout.tsx

components/
  ui/              primitivos: botão, input, select, dialog, badge
  layout/          sidebar, topbar, menu de usuário

lib/
  env/
    public.ts      variáveis NEXT_PUBLIC_* (browser)
    server.ts      variáveis restritas ao servidor (import 'server-only')
  supabase/
    client.ts      cliente de browser — Realtime, Storage, login
    server.ts      cliente de RSC / Server Actions / Route Handlers
    proxy.ts       renovação da sessão, usada pelo proxy.ts da raiz
  dal/             Data Access Layer — único acesso ao banco
  actions/         Server Actions
  validations/     schemas Zod
  types/
    database.ts    gerado via npm run db:types
  utils/

supabase/
  migrations/      SQL versionado: schema, RLS, triggers, bucket de avatares
  functions/       Edge Functions (Deno) — só admin-usuarios, com service_role
  tests/           teste de fumaça da RLS, para rodar no SQL Editor

docs/
  ARQUITETURA.md   este arquivo

proxy.ts           raiz — substitui o antigo middleware.ts
```

Route groups `(auth)` e `(app)` não aparecem na URL; servem para dar layouts
diferentes às duas áreas. Pastas com `_` (ex.: `_components`) não viram rota e
são o lugar certo para componentes específicos de uma tela.

## Modelo de dados

Decisão estrutural: **cliente e negociação são entidades separadas.** A etapa
do funil pertence à oportunidade, não ao cliente. Sem essa separação não é
possível reabordar um cliente perdido nem manter duas propostas simultâneas, e
o histórico de conversão se corrompe a cada reentrada.

| Tabela | Papel |
| --- | --- |
| `profiles` | Espelho de `auth.users`: `role` (gerente / closer), `ativo`, `telefone`, `foto_url`. Nunca excluído — desativar bloqueia o login. Sempre há ao menos um gerente ativo (trigger) |
| `clientes` | Dados cadastrais, `owner_id`, soft delete via `deleted_at` |
| `negociacoes` | O card do Kanban: etapa, valor estimado, posição, owner |
| `fechamentos` | 1:1 com a negociação: valor vendido, contrato enviado/assinado, status de pagamento, onboarding. `responsavel_id` (dono no fechamento, para metas) e `fechado_por` (quem executou, auditoria) |
| `etapas_funil` | Colunas do Kanban (Fase 8B). As 6 de sistema (`chave` preenchida) só mudam de cor; personalizadas mudam nome, cor e posição, sempre antes de Negociação. Excluir só o que nunca foi usado; o resto é desativado |
| `historico_etapas` | Append-only, escrito por trigger a cada mudança de etapa. Alimenta "últimas movimentações" e será a base do relatório de conversão e ciclo de venda |
| `eventos` | Agenda: reunião, ligação, follow-up, apresentação. Dono em `usuario_id`; `google_event_id` / `sincronizado_em` reservados para o Google Calendar |
| `atividades` | Timeline da ficha do cliente: `tipo`, `descricao`, `data`, autor em `usuario_id` |
| `metas` | Meta mensal de venda (Fase 10): `usuario_id` nulo = empresa, preenchido = closer. `periodo_mes` é o dia 1 do mês; uma meta por alvo por mês (`unique nulls not distinct`). Editar muda só o valor |
| `servicos` | Catálogo de serviços vendidos (Fase 11A), sem preço. `categoria` opcional. Todos leem; gerente escreve. Usado em negociação não é excluído, é desativado — e continua nas negociações antigas |
| `negociacao_servicos` | Serviços de cada negociação. RLS herdada da negociação. Serviço desativado não entra em vínculo novo (trigger) |
| `proximas_acoes` | Follow-up combinado (`titulo`, `data`, `observacao`); pendente enquanto `concluida_em` for nulo |

### Enums

```
user_role         gerente | closer
tipo_etapa        aberta | ganha | perdida
cor_etapa         azul | violeta | amarelo | laranja | verde | vermelho |
                  ciano | rosa | turquesa | cinza
status_pagamento  pendente | parcial | pago | atrasado | cancelado
status_onboarding nao_iniciado | em_andamento | concluido
tipo_evento       reuniao | ligacao | followup | apresentacao
status_evento     agendado | realizado | nao_compareceu | cancelado
tipo_atividade    nota | ligacao | email | whatsapp | reuniao
tipo_cliente      pessoa_fisica | empresa
temperatura_negociacao  quente | morno | frio
```

### Etapas: regras seguem o tipo, nunca o nome

Desde a Fase 8B as etapas são linhas de `etapas_funil`, e `negociacoes.etapa_id`
aponta para elas. As regras de negócio olham o **tipo** da etapa:

| Tipo | Etapa | Regra |
| --- | --- | --- |
| `aberta` | as 4 de trabalho + todas as personalizadas | nenhuma |
| `ganha` | Fechado (única) | exige registro em `fechamentos` |
| `perdida` | Perdido (única) | exige `motivo_perda` |

Negociação nova começa sempre em Reunião agendada (`etapa_id_por_chave`).
No código, etapas de sistema são referenciadas pela `chave`, nunca pelo id ou
pelo nome. Cores vêm de uma paleta fixa (`cor_etapa`); o app mapeia cada nome
para o hex em `lib/utils/etapas.ts`.

### Regras que moram no banco, não no formulário

- Passar uma negociação para a etapa `ganha` (Fechado) exige uma linha em
  `fechamentos` (valor vendido, contrato enviado, contrato assinado, status de
  pagamento, onboarding). Garantido por trigger.
- Passar para a etapa `perdida` (Perdido) exige `motivo_perda`. Trigger.
- Negociação em etapa `ganha` ou `perdida` tem os dados comerciais (qualificação,
  proposta, serviços) somente leitura. Triggers em `negociacoes` e
  `negociacao_servicos`, além de `salvar_negociacao`. Reabrir pelo Kanban
  (voltar a uma etapa aberta) libera a edição.
- Nenhuma negociação entra numa etapa desativada. Trigger.
- `atividades` não tem policy de `UPDATE`: uma entrada da timeline não se
  edita, para não apagar o rastro de quem falou o quê e quando.
- Um closer não altera a própria coluna `role`. A policy de UPDATE de
  `profiles` deixa ele editar o próprio registro, então um trigger bloqueia
  especificamente a mudança de papel e de acesso.

Validar isso apenas no modal do Kanban significa que qualquer import, correção
manual ou action futura fura a regra.

### Metas: o realizado segue o responsável no fechamento

O realizado de cada pessoa soma `fechamentos.valor_vendido` por
`responsavel_id`: o dono da negociação **no momento do fechamento**, gravado
por trigger (`fechamentos_define_responsavel`).

- Não é quem clicou: gerente que fecha a venda de um closer credita o closer.
  Quem executou continua em `fechado_por`, só para auditoria.
- Não é o dono atual: transferir a carteira depois não reescreve metas
  passadas. O responsável só é recalculado num novo fechamento
  (`fechar_negociacao` renova `fechado_em`).
- Fechamentos anteriores à Fase 10 receberam o dono atual da negociação, a
  melhor estimativa disponível (não há histórico de dono).

O filtro é o mesmo do dashboard (negociação na etapa `ganha`,
`data_fechamento` no mês), então o realizado da empresa bate com o "Vendido"
do dashboard no mesmo mês; por pessoa os dois podem divergir depois de uma
transferência, porque o dashboard atribui ao dono atual.

`metas_progresso` é SECURITY DEFINER com a autorização no próprio WHERE
(closer recebe só a sua linha). Como INVOKER ela não funcionaria: a RLS de
`fechamentos` segue o dono atual, e o responsável deixaria de enxergar a venda
depois da transferência. A função devolve apenas somas, nunca linhas de
fechamento.

### Dinheiro e datas

Valores em `numeric(14,2)` — nunca `float8`, que gera divergência de centavos
nos relatórios de comissão. Datas em `timestamptz`, com conversão explícita
para `America/Sao_Paulo` na agenda e nos cortes de fim de mês.

## Roadmap

| Fase | Entrega | Status |
| --- | --- | --- |
| 0 | Fundação: dependências, clientes Supabase, env, estrutura, docs | concluída |
| 1 | Banco: migrations, enums, triggers, RLS | concluída |
| 2 | Auth: `proxy.ts`, login, `verifySession()`, shell com sidebar | concluída |
| 3 | Clientes: CRUD completo — validação prática da RLS | concluída |
| 4 | Funil Kanban: dnd-kit, optimistic UI, modal de fechamento | concluída |
| 5A | Atividades comerciais e próxima ação na ficha e no card | concluída |
| 5B | Agenda: eventos, compromissos do dia, status → timeline | concluída |
| 6 | Dashboard: KPIs sobre dados reais | concluída |
| 7 | Relatórios: performance por closer, conversão, export CSV | pendente |
| 8A | UX: sidebar recolhível, "Mover para" no Kanban | concluída |
| 8B | Funil dinâmico: etapas em tabela, configuráveis pelo gerente | concluída |
| 9A | Métricas do funil: conversão por etapa, tempo na etapa, cards parados (`funil_metricas`) | concluída |
| 10 | Metas comerciais: meta mensal da empresa e por closer, realizado pelo responsável no fechamento (`metas_progresso`) | concluída |
| 11A | Serviços e proposta: `servicos`, `negociacao_servicos`, `valor_proposta`, `forma_pagamento`, `salvar_negociacao` | concluída |
| 11B | Configurações › Serviços: CRUD do gerente, consulta do closer (só ativos) | concluída |
| 11C | Edição da negociação (`/negociacoes/[id]/editar`): qualificação, proposta e serviços via `salvar_negociacao`. Etapa, dono e motivo de perda só pelo funil. Encerrada (ganha/perdida) é somente leitura | concluída |
| 11C+ | Propostas (`/propostas/abertas` e `/fechadas`), métricas do funil em `/funil/metricas`, sidebar com submenus (painel flutuante quando recolhida) | concluída |
| 11D | Kanban: setas ‹ › rolam uma coluna por vez (somem quando tudo cabe na tela) | concluída |
| 11E | Períodos rápidos: últimos 7 e 15 dias (dashboard, métricas do funil, propostas fechadas) | concluída |
| Agenda A | Conexão OAuth com o Google Calendar (somente leitura, token no Vault) e diagnóstico das cores | concluída |
| Agenda N1 | Agenda nativa no banco: `confirmado`/`outro`, cor por usuário, responsável com acesso ao cliente, séries (`eventos_series`, término obrigatório), alterar/cancelar com escopo, excluir só sem histórico | concluída |
| Agenda N2 | Formulário completo: duração, responsável filtrado pelo cliente, status inicial, repetição com prévia, "aplicar a" em séries, cancelar/excluir; cor na agenda em Usuários | concluída |
| 8 | Acabamento: Realtime, estados vazios, responsivo, auditoria de policies | pendente |

A ordem não é negociável em dois pontos: **banco e RLS antes de qualquer
tela**, e **clientes antes do funil** — é na Fase 3 que a RLS é provada na
prática, logando como um closer e confirmando que a carteira do outro é
invisível.

## Convenções

- Mutação é **Server Action**, leitura é **RSC**. Route Handler só para
  webhooks e exports.
- Toda Server Action começa validando com Zod e chamando a DAL. Nenhuma action
  fala com o Supabase diretamente.
- A diretiva de client component fica o mais fundo possível na árvore. O
  Kanban é client; a página que o carrega não é.
- Nenhum componente de tela importa `lib/supabase/server.ts` — importa a DAL.
- Queries respeitam `deleted_at IS NULL`. Soft delete esquecido faz cliente
  "excluído" reaparecer em relatório.

## Setup local

```bash
cp .env.example .env.local   # preencher com os dados do projeto Supabase
npm install
npm run dev
```

Após a Fase 1, regerar os tipos do banco sempre que o schema mudar:

```bash
npm run db:types
```
