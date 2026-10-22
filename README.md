# AVANTE (CRM-RX7)

CRM comercial AVANTE, da Rio X7 Agência Digital — gestão de clientes, funil de vendas, agenda e
relatórios, com permissões distintas para gerente e closer.

## Rodando localmente

Requer **Node.js 20.9+**.

```bash
npm install
cp .env.example .env.local   # preencher com os dados do projeto Supabase
npm run dev
```

A aplicação sobe em http://localhost:3000.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run start` | Servir o build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | Checagem de tipos sem emitir arquivos |
| `npm run db:types` | Regera `lib/types/database.ts` a partir do schema do Supabase |

## Documentação

Arquitetura, modelo de dados, modelo de permissões, roadmap e convenções estão
em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). Leia antes de abrir código.

Dois pontos que economizam tempo:

- Este projeto usa **Next.js 16**, onde `middleware.ts` virou `proxy.ts` e
  `cookies()`, `headers()`, `params` e `searchParams` são assíncronos. A
  documentação da versão instalada está em `node_modules/next/dist/docs/`.
- A regra "closer vê apenas seus clientes" é aplicada por **RLS no Postgres**,
  não pelo código da aplicação. Nunca use a chave `service_role` no caminho de
  um request.
