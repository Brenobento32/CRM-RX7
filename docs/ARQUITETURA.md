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

### Como isso é aplicado

1. **RLS no Supabase** — policies em todas as tabelas de dados. Única fonte de
   verdade da autorização.
2. **Chave `anon`, nunca `service_role`** — o JWT do usuário viaja na
   requisição, então o Postgres sabe quem está perguntando. A `service_role`
   ignora a RLS e não deve existir no caminho de nenhum request.
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
  migrations/      SQL versionado: schema, RLS, triggers
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
| `profiles` | Espelho de `auth.users` com `role` (gerente / closer) |
| `clientes` | Dados cadastrais, `owner_id`, soft delete via `deleted_at` |
| `negociacoes` | O card do Kanban: etapa, valor estimado, posição, owner |
| `fechamentos` | 1:1 com a negociação: valor vendido, contrato enviado/assinado, status de pagamento, onboarding |
| `historico_etapas` | Append-only, escrito por trigger a cada mudança de etapa. Alimenta "últimas movimentações" e será a base do relatório de conversão e ciclo de venda |
| `eventos` | Agenda: reunião, ligação, follow-up, apresentação. Dono em `usuario_id`; `google_event_id` / `sincronizado_em` reservados para o Google Calendar |
| `atividades` | Timeline da ficha do cliente: `tipo`, `descricao`, `data`, autor em `usuario_id` |
| `proximas_acoes` | Follow-up combinado (`titulo`, `data`, `observacao`); pendente enquanto `concluida_em` for nulo |

### Enums

```
user_role         gerente | closer
etapa_funil       reuniao_agendada | reuniao_realizada | proposta_enviada |
                  negociacao | fechado | perdido
status_pagamento  pendente | parcial | pago | atrasado | cancelado
status_onboarding nao_iniciado | em_andamento | concluido
tipo_evento       reuniao | ligacao | followup | apresentacao
status_evento     agendado | realizado | nao_compareceu | cancelado
tipo_atividade    nota | ligacao | email | whatsapp | reuniao
tipo_cliente      pessoa_fisica | empresa
temperatura_negociacao  quente | morno | frio
```

### Regras que moram no banco, não no formulário

- Passar uma negociação para `fechado` exige uma linha em `fechamentos`
  (valor vendido, contrato enviado, contrato assinado, status de pagamento,
  onboarding). Garantido por trigger.
- Passar para `perdido` exige `motivo_perda`.
- `atividades` não tem policy de `UPDATE`: uma entrada da timeline não se
  edita, para não apagar o rastro de quem falou o quê e quando.
- Um closer não altera a própria coluna `role`. A policy de UPDATE de
  `profiles` deixa ele editar o próprio registro, então um trigger bloqueia
  especificamente a mudança de papel e de acesso.

Validar isso apenas no modal do Kanban significa que qualquer import, correção
manual ou action futura fura a regra.

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
