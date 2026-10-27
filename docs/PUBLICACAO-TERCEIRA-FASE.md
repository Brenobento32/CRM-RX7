# Publicação — 3ª fase do AVANTE (precedência do Super Admin, responsáveis de leads, identidade)

Projeto Supabase: `ybgzlxgeoiggmfdxarqx` (CRM-RX7). Site: https://avante.riox7comunicacao.com.br.
Fora desta publicação: CRM pessoal, Scorpion, Auth/SMTP/DNS, WhatsApp, Google Sheets, Edge Functions.

**Estado de partida:** commit `9f84d20` publicado; migration `20261028100000` aplicada (NÃO reaplicar).
**Nada aqui roda sem autorização específica do dono.** Na primeira falha crítica: parar e comunicar.

## O que entra

| Item | Arquivo | Efeito |
|---|---|---|
| Migration 1 | `supabase/migrations/20261028110000_super_admin_precedencia.sql` | Super Admin só acessa empresa com "Acessar CRM" (mesmo com vínculo antigo); nunca é responsável comercial (usuário logado ou ingestão automática); empresa nova nunca tem Super Admin como administrador inicial. |
| Migration 2 | `supabase/migrations/20261028120000_identidade_avante_dados_empresa.sql` | Identidade global do AVANTE CRM (logo claro/escuro, bucket `plataforma-marca`), nome comercial e observações internas da empresa. |
| App | arquivos listados no passo 6 | Telas `/admin/identidade`, dados da empresa, logo oficial no login/admin/menu, listas de responsáveis sem Super Admin. |
| Dados (config) | `supabase/propostas/responsaveis_leads_teste_ab.sql` | A: responsável padrão + fonte "Formulario de teste AVANTE" → SDR ativo. B: responsável padrão → Closer ativo. |
| Dados (config) | `supabase/propostas/responsaveis_leads_rio_x7.sql` | Rio X7: responsável padrão → conta operacional nova (Administrador), depois de criada. |

## Contas (conferidas em 26/10, somente leitura)

| Conta | Hoje | Destino |
|---|---|---|
| `brenosilvabento@gmail.com` (`c632f6d8…`) | **o único Super Admin**; vínculos antigos em arquivo-legado, rio-x7, teste-avante-a/b (preservados; a migration 1 os neutraliza) | Super Admin em `/admin` — **nada a migrar** |
| `riox7comunicacao@gmail.com` (`b1b5c071…`) | Closer da Empresa Teste B, sem carteira, sem permissões comerciais configuradas | Administrador **só** da Rio X7 |
| `brenosilvabento@hotmail.com` | não existe no Auth | SDR da Empresa Teste B (conta de testes) |

## Portão A — contas e responsáveis (ANTES das migrations: a captação não para)

Cada passo só com autorização específica. Feito pelo fluxo normal do app (Super Admin, que hoje
ainda entra nas empresas pelo vínculo; depois da migration 1, pelo "Acessar CRM").

A1. **Backup novo** + hashes + restauração local (como no passo 2 abaixo).
A2. **Hotmail → SDR da Empresa Teste B:** B → Configurações → Usuários → Novo
    (`brenosilvabento@hotmail.com`, cargo SDR, sem senha: o Supabase envia o convite). O dono
    aceita o convite, define a senha e entra por `/login` (só vê a Empresa Teste B).
A3. **Permissões do SDR de B** (Usuários → permissões): Funil Principal → Lead Novo, Reunião
    agendada, Reunião realizada — ver e mover (igual ao SDR da Empresa Teste A).
A4. **Gmail operacional → Rio X7:** B → Usuários → `riox7comunicacao@gmail.com` → **desativar**
    (vínculo fica no histórico, inativo); Rio X7 → Usuários → Novo com o mesmo e-mail, cargo
    **Administrador** (identidade existente: só ganha o vínculo; senha e e-mail não mudam). O
    dono entra por `/login` com essa conta: só a Rio X7, sem `/admin`.
A5. **Responsáveis:** `npx supabase db query --linked -f supabase/propostas/responsaveis_leads_teste_ab.sql`
    (A → SDR de A, inclusive a fonte; B → SDR de B) e `…/responsaveis_leads_rio_x7.sql`
    (Rio X7 → `riox7comunicacao@gmail.com`; recusa se ela ainda tiver vínculo ativo fora da Rio X7).
    Os dois scripts não dependem das migrations e mostram a conferência na saída.

## Portão B — publicação

1. **Contas do Portão A** ativas e testadas.
2. **Backup novo** pelo PowerShell do Windows (`C:\Tools\crm-rx7\backup.ps1`, senha digitada pelo
   dono) → conferir `manifest.json` e SHA-256 → restaurar em banco local novo
   (`restaurar-novo.ps1`) → comparar contagens. Restauração falhou: PARAR.
3. **Ensaio na cópia restaurada:** aplicar 110000 e 120000 em sequência; rodar as propostas de
   responsáveis com `rollback` no lugar de `commit`; conferir que os membros comuns resolvem como antes.
4. **Dry-run** `npx supabase db push --dry-run --linked` → deve listar **só**
   `20261028110000_super_admin_precedencia.sql` e `20261028120000_identidade_avante_dados_empresa.sql`.
5. **Aplicar as migrations** (`npx supabase db push --linked`, uma vez) e pós-verificar (somente leitura):
   contagens históricas iguais ao backup; `plataforma_identidade` com 1 linha; bucket
   `plataforma-marca` e as 4 policies `plataforma_marca_*`; membros comuns resolvem a própria empresa;
   o Super Admin, sem janela, nenhuma.
   > Entre a migration e o deploy: o Super Admin vê as empresas vazias até usar "Acessar CRM"
   > (o app antigo ainda tenta o vínculo). Os responsáveis já foram corrigidos no Portão A, então
   > nenhum lead é recusado. Conferir antes: nenhum `lead_responsavel_id`/fonte aponta para Super Admin.
6. **Commit e push** só dos arquivos aprovados (staging explícito, nunca `git add .`):
   `app/(app)/clientes/[id]/editar/page.tsx`, `app/(app)/configuracoes/integracoes/[id]/page.tsx`,
   `app/(app)/configuracoes/whatsapp/page.tsx`, `app/(auth)/layout.tsx`,
   `app/admin/(painel)/empresas/[id]/page.tsx`, `app/admin/(painel)/identidade/page.tsx`,
   `app/admin/_components/campo-logo-plataforma.tsx`, `app/admin/_components/marca-admin.tsx`,
   `app/admin/_components/nav-admin.tsx`, `app/not-found.tsx`, `components/layout/sidebar.tsx`,
   `components/marca/logo-avante.tsx`, `lib/actions/super-admin.ts`, `lib/dal/clientes.ts`,
   `lib/dal/empresa.ts`, `lib/dal/eventos.ts`, `lib/dal/fontes-leads.ts`, `lib/dal/identidade.ts`,
   `lib/dal/metas-reunioes.ts`, `lib/dal/metas.ts`, `lib/dal/super-admin.ts`, `lib/dal/whatsapp.ts`,
   `lib/types/database.ts`, `lib/validations/super-admin.ts`, `public/marca/*` (4 PNG),
   as 2 migrations, `supabase/tests/super_admin_precedencia_test.sql`,
   `supabase/tests/identidade_avante_dados_empresa_test.sql`, e este documento. Os scripts de operação (`supabase/propostas/responsaveis_leads_*.sql`, `etapa_a2_contas_responsaveis.sql`, executado em 26/10) ficam FORA do Git: são operação, não aplicação.
   **Fora:** `next.config.ts`, `.claude/`, todo `supabase/propostas/` novo (`20261027090000_planos_sem_agenda_google.sql` e os scripts de operação).
   Antes: varredura de segredos, typecheck, lint, testes, build (Webpack).
7. **ZIP do commit** (`git archive`) + SHA-256 → Hostinger: reimplantar **só** o Web App do AVANTE,
   Node 22 e variáveis atuais. Não navegar no site durante o build.
8. **Homologar:**
   - `/login` (clientes) e `/admin` (Super Admin) separados; Super Admin pelo `/login` recusado.
   - Super Admin (híbrido) **sem** "Acessar CRM": URL da empresa não abre; com ele: banner, só aquela
     empresa; trocar de empresa, "Encerrar", sair e novo login revogam.
   - Renovação real do token mantém o `session_id` (se divergir do emulador: PARAR).
   - `/admin/identidade`: logos oficiais nos dois temas; trocar uma variante, ver prévia, salvar,
     conferir login/admin/menu; remover → volta a oficial.
   - Dados da empresa: editar nome comercial/observações de uma empresa de teste; o Administrador
     dela não vê as observações.
   - Responsável comercial: nenhum Super Admin nas listas; lead de teste na Empresa Teste A cai no SDR.
9. **CDN e estáticos:** arquivos `/_next/static` completos (zstd/br/gzip) e `/marca/*.png` com 200;
   ChunkLoadError ou arquivo incompleto → limpar **só** o CDN do AVANTE. Não reimplantar sozinho.

## Como desfazer (não automático)

- Configuração de responsáveis: as propostas auditam `antes`/`depois` em `admin_auditoria`
  (`responsavel_leads_alterado`); voltar é um `update` com o valor `antes`.
- App: reimplantar o ZIP de `9f84d20`.
- Migrations: só com decisão explícita (funções substituídas estão no backup do passo 2).
