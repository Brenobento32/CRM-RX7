# AVANTE — Publicação da segunda fase (cargos, permissões e empresas)

Checklist da publicação controlada no CRM-RX7 (`ybgzlxgeoiggmfdxarqx`).
🔒 = só com autorização explícita para aquela etapa. Executado em 25/10/2026 com autorização.

Fora desta publicação: CRM pessoal, Scorpion, WhatsApp, Google Sheets, SMTP/Auth,
`next.config.ts` local (só muda o indicador de desenvolvimento) e a limpeza
opcional `supabase/propostas/20261027090000_planos_sem_agenda_google.sql`.

## Pacote

| Ordem | Arquivo (migrations em `supabase/migrations/`; auxiliares em `supabase/propostas/`) | O que faz | Transação |
|---|---|---|---|
| 1 | `20261027100000_empresa_papeis_enum.sql` | Vendedor e Atendente nos enums `tenant_papel` e `user_role` | **sozinha** (o valor novo só pode ser usado depois do commit) |
| 2 | `20261027100100_empresa_perfil.sql` | Contato/logo da empresa, bucket `empresa-logos`, slugs reservados e antigos, RPCs do Super Admin | própria |
| 3 | `20261027100200_cargos_estrutura.sql` | Liberação de etapas p/ Atendente, `criado_por` confiável, tabela `metas_reunioes` (sem acesso até a ativação) | própria |
| 4 | `20261027100300_cargos_ativacao.sql` | Permissões dos cargos | própria |
| — | `verificar_publicacao_cargos.sql` | Conferência **somente leitura**, antes e depois | — |
| — | `reverter_cargos_ativacao.sql` | Desfaz só a ativação (emergência) | uma transação |

Os dois últimos não têm timestamp: o Supabase CLI nunca os aplica.

Testado localmente sobre o espelho de produção:
- migrations 1→4 aplicadas em sequência, sem erro;
- 31 cenários de banco passam;
- os testes antigos dão o mesmo resultado antes e depois;
- histórico intacto (74 clientes, 79 negociações, 14 fechamentos, 35 eventos);
- reversão da ativação volta funções, policies, triggers e grants **idênticos** ao
  estado anterior (1.031 itens), e a ativação pode ser reaplicada depois.

## Compatibilidade

- **App publicado (66d1ac7) + banco novo:** compatível. As migrations 2–3 só
  acrescentam; a 4 só muda regras de cargos que a produção ainda não tem. Os
  vínculos hoje são só admin/gerente.
  - Mudança intencional para SDR: não grava/anula fechamento direto nem exclui
    negociação.
- **App novo + banco antigo:** **incompatível** (lê `logo_path`,
  `atendente_pode_mover` e chama as RPCs novas). O código só vai para a
  Hostinger depois da etapa 6.
- **Nenhum cargo desconhecido vira Gerente:** `papel_comercial()` em produção já
  devolve nulo para papel desconhecido; a ativação troca os três `else 'gerente'`
  restantes (equipe/metas) pelo mapeamento explícito `papel_do_cargo()`.
- **Sem janela de acesso indevido:**
  - entre o enum e a ativação ninguém tem papel Vendedor/Atendente: a Edge Function
    publicada recusa esses papéis, e a conferência barra se aparecer algum;
  - as permissões novas só valem depois da ativação, numa única transação.

## Sequência

### 1. Backup 🔒
1. Parar o uso local; nenhuma gravação durante a janela.
2. `C:\Tools\crm-rx7\backup.ps1` (somente leitura no Supabase).
3. `C:\Tools\crm-rx7\restaurar-teste.ps1` numa cópia local. Rodar
   `verificar_publicacao_cargos.sql` nela e conferir as contagens com o passo 2.

### 2. Conferência inicial 🔒 (somente leitura)
- SQL Editor do CRM-RX7 → `verificar_publicacao_cargos.sql`. Guardar a saída.
- Esperado:
  - última migration `20261026100000`;
  - enum/estrutura/ativação = `nao`;
  - todos os bloqueios = 0.

### 3. Enum 🔒
1. Copiar **só** o arquivo 1 para `supabase/migrations/`.
2. `npx supabase db push --linked --dry-run` → deve listar **apenas** `20261027100000`.
3. `npx supabase db push --linked`.
4. Conferência: enum = `sim`.

### 4. Estrutura 🔒
1. Copiar os arquivos 2 e 3 para `supabase/migrations/`.
2. Dry-run → só `20261027100100` e `20261027100200`.
3. Push.
4. Conferência: estrutura = `sim`.

O app publicado segue funcionando. **Pausa segura:** dá para parar aqui.

### 5. Ativação 🔒
1. Conferência: bloqueio "vendedor/atendente antes da ativação" = 0.
2. Copiar o arquivo 4. Dry-run → só `20261027100300`. Push.
3. Conferência final:
   - tudo `sim`;
   - "qualquer outro vira gerente" = 0;
   - contagens do histórico iguais às do passo 2.

### 6. Edge Function 🔒
- `npx supabase functions deploy admin-usuarios --use-api`
  (`verify_jwt = true` no `config.toml`).
- Única mudança: aceita `vendedor` e `atendente`. Quem convida continua sendo
  decidido no banco (`definir_membro_tenant`: admin da empresa ou Super Admin);
  ela nunca cria Super Admin.

### 7. Commit e push 🔒
- Staging explícito, nunca `git add .`.
- Entram:
  - os arquivos de `git status`, **exceto** `next.config.ts` e `.claude/`;
  - as 4 migrations já movidas para `supabase/migrations/`;
  - em `supabase/propostas/`, só os dois arquivos sem timestamp;
  - os novos testes (`cargos_test.sql`, `empresa_perfil_test.sql`);
  - os docs (`MATRIZ-CARGOS.md`, `PROPOSTA-NOVA-FASE.md`, este arquivo).
- Antes: `git diff --cached` e varredura de segredos.

### 8. ZIP e Hostinger 🔒
1. `C:\Tools\crm-rx7\montar-zip-avante.ps1` do commit novo. Conferir o `.sha256`.
2. Upload no app `avante.riox7comunicacao.com.br` → Deploy.

### 9. Testes reais mínimos (contas de teste)
1. Super Admin cria empresa com logo e gerente inicial.
2. URL `/nome-da-empresa/` abre a empresa; `/e/<slug>` e o slug antigo redirecionam.
3. Gerente:
   - edita só logo, telefone, e-mail e responsável (nome e endereço só leitura);
   - cria Vendedor, Atendente, SDR e Closer;
   - libera etapas para Atendentes.
4. Atendente:
   - move só as próprias negociações entre etapas liberadas;
   - Fechado/Perdido não aparecem.
5. SDR e Atendente agendam para um Closer: aviso de conflito e "Agendada por".
6. SDR vê só as próprias metas de reuniões; o Gerente vê a equipe.
7. Vendedor/Closer: "Minha meta" e fechamento da própria venda.
8. Usuário de uma empresa abrindo a URL de outra → volta para a própria.
9. Login, recuperação de senha e reuniões já existentes continuam iguais.

## Interrupção

| Falhou em | O que fazer |
|---|---|
| 1–2 | Parar. Nada mudou. |
| 3 (enum) | A transação desfaz sozinha. Se aplicou e algo depois falhar, **o enum fica**: valor sem uso é inofensivo, e nenhum vínculo usa. Não tentar remover. |
| 4 (estrutura) | Cada arquivo desfaz sozinho. Se aplicada, pode ficar: o app publicado funciona com ela. Parar e corrigir. |
| 5 (ativação) | Falha = desfeita sozinha. Problema depois do commit → 🔒 `reverter_cargos_ativacao.sql` (recusa se houver Vendedor/Atendente) e remover a linha `20261027100300` do histórico de migrations. |
| 6 (Edge Function) | Republicar a versão anterior (`git show 66d1ac7:supabase/functions/admin-usuarios/index.ts`). |
| 7–8 (código) | Republicar `C:\Tools\crm-rx7\saida\publicacao\avante-saas-66d1ac76.zip` (funciona com o banco novo). |
| Dados | 🔒 Restaurar o backup do passo 1 — último recurso, destrutivo. Preferir correção por migration nova. |
