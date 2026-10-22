# CRM - RX7 SaaS — decisões técnicas da base multiempresa

Estado: **T1 escrita e testada só na cópia local. Não aplicada em produção.**
Migration: `supabase/migrations/20261022130000_tenants_base.sql`.
Teste: `supabase/tests/tenants_base_test.sql` (só em banco de teste; usa
fixtures em `auth.users` com colunas mínimas).

## Decisões

1. **Empresas** (`tenants`): `tipo` = `assinante` (cliente), `interno` (Rio X7,
   primeira empresa operacional) ou `arquivo` (legado, somente leitura).
   `somente_leitura` é derivado do status (`suspenso`, `cancelado`, `arquivo`).
2. **Papéis por empresa** (`tenant_memberships.papel`): `admin_empresa`,
   `gerente`, `sdr`, `closer`. Um usuário pode estar em várias empresas com
   papéis diferentes. `profiles.role` continua valendo para o app atual até a
   T10, quando sai.
3. **Super Admin** (`super_admins`) é separado dos papéis da empresa e **não
   dá acesso a dados comerciais**. Não há função que crie Super Admin.
4. **Empresa sempre explícita e validada no banco.** Todo helper recebe o
   tenant como parâmetro e confere o vínculo ativo do `auth.uid()` em
   `tenant_memberships` a cada chamada. Não existe "empresa ativa" gravada
   numa linha de sessão; a empresa escolhida na tela é só uma dica que o
   banco revalida.
5. **Escrita só por funções.** As 3 tabelas têm RLS e nenhum
   INSERT/UPDATE/DELETE para `anon`/`authenticated`.
6. **Integrações automáticas** (formulários, WhatsApp, Google, pagamentos)
   identificam a empresa por credencial própria da empresa (token/segredo
   guardado por empresa), nunca por sessão de navegador.

## Helpers para as próximas etapas

| Função | Uso |
|---|---|
| `membro_do_tenant(t)` | policies de leitura |
| `pode_escrever_no_tenant(t)` | policies de escrita (bloqueia arquivo/suspenso/cancelado) |
| `papel_no_tenant(t)` / `tem_papel_no_tenant(t, papeis[])` | regras por papel |
| `exigir_papel_no_tenant(t, papeis[])` | primeira linha de toda RPC `SECURITY DEFINER` |
| `tenants_do_usuario()` | `tenant_id in (select tenants_do_usuario())` nas policies restritivas |
| `is_super_admin()` | só telas e RPCs administrativas |

## Provisionamento

- `provisionar_tenant(nome, slug, tipo, admin)`: só Super Admin; cria a
  empresa e o primeiro `admin_empresa`. Não cria empresa de arquivo.
- `definir_membro_tenant(tenant, usuario, papel, ativo)`: Super Admin, ou
  `admin_empresa` ativo da própria empresa (não somente leitura).
- Guarda: toda empresa (menos a de arquivo) mantém pelo menos um
  `admin_empresa` ativo; empresa e usuário de um vínculo são imutáveis.

**Bootstrap do primeiro Super Admin** (uma vez, pelo dono do banco, no SQL
Editor, com autorização):
`insert into public.super_admins (user_id) values ('<uuid do usuário>');`

## Próximas etapas (ordem)

T2 criar a empresa de arquivo e a Rio X7 (com autorização) → T3 `tenant_id`
nas 25 tabelas (default constante = arquivo, sem UPDATE) → T4 CHECK
`escopo`↔arquivo → T5 FKs compostas → T6 índices únicos por empresa → T7
policies RESTRICTIVE por empresa → T8/T9 RPCs → T10 papéis por empresa.

## Hostinger

Nada da T1 roda na Hostinger: é só banco. O app Next.js não mudou. Nenhuma
variável de ambiente nova.

## T2 — empresas iniciais (`20261022140000_tenants_iniciais.sql`)

| Empresa | id fixo | tipo / status |
|---|---|---|
| Arquivo legado | `a0000000-0000-4000-8000-000000000001` (`tenant_arquivo_id()`) | `arquivo` / `arquivo` (somente leitura) |
| Rio X7 Agência Digital | `a0000000-0000-4000-8000-000000000002` (`tenant_rio_x7_id()`) | `interno` / `ativo` |

Idempotente. Não cria usuários nem vínculos. O proprietário é vinculado
depois, uma vez, pelo dono do banco:
`select public.vincular_proprietario_rx7('<e-mail confirmado do proprietário>');`
— só aceita exatamente 1 usuário com e-mail confirmado e perfil ativo; cria
`admin_empresa` na Rio X7 e `gerente` (leitura) no arquivo. Nenhum papel de
usuário executa essa função.

## T3 — `tenant_id` (`20261022150000_tenant_id_tabelas.sql`)

- 25 tabelas com `tenant_id NOT NULL`, FK para `tenants`, índice e **sem
  default**. Registros atuais: todos no arquivo, sem UPDATE.
- Raízes (tenant explícito): `clientes`, `funis`, `nichos`, `servicos`,
  `agenda_google_conexao`, `agenda_google_oauth_estados`.
- Filhas (herdam do pai obrigatório, `_tenant_10_derivar`): `negociacoes`,
  `fechamentos`, `negociacao_servicos`, `respostas_lead`, `historico_etapas`,
  `atividades`, `proximas_acoes`, `eventos`, `eventos_series`, `mensagens`,
  `mensagem_reacoes`, `mensagem_exclusoes`, `etapas_funil`, `formularios`,
  `perguntas`, `permissoes_colaborador`, `whatsapp_conexoes`; e, quando o pai
  existir, `conversas` (cliente) e `metas` (funil).
- `_tenant_20_validar` (25 tabelas): `tenant_id` imutável; com usuário, exige
  `pode_escrever_no_tenant`. Sem usuário (service_role), o tenant vem
  explícito ou do pai.

### NÃO liberar a T3 sozinha em produção

Com a T3 aplicada e o app atual sem mudanças:

| Quebra | Onde | Correção (próximo bloco) |
|---|---|---|
| criar cliente | `criar_cliente`, `criar_ou_reaproveitar_cliente`, `ingerir_lead_formulario`, `criar_cliente_whatsapp` | receber `p_tenant` validado por `exigir_papel_no_tenant` (ou, na ingestão, o tenant da credencial) |
| criar funil | `criar_funil`, `duplicar_funil` | idem |
| meta geral (sem funil) | `salvar_metas_funis`, `lib/dal/metas.ts` | idem |
| nicho, serviço | `lib/dal/nichos.ts`, `lib/dal/servicos.ts` | DAL envia `tenant_id` da empresa escolhida |
| conversa sem cliente | `whatsapp-service/src/mensagens.ts` | serviço não é implantado (Baileys); a integração oficial grava com tenant da credencial |
| estado OAuth | Edge Function `agenda-google` | tenant da empresa que conecta |
| editar/excluir legado | todo o app | **intencional**: o arquivo é somente leitura |

Liberação conjunta: M1 → T1 → T2 → `vincular_proprietario_rx7` → T3 +
RPCs/DAL com tenant + T7 (policies RESTRICTIVE por empresa), numa mesma
janela, depois de backup e ensaio na cópia.

Observação: a pós-verificação da M1 confere 48 triggers; depois da T1 e da T3
são 95 (3 + 44). Ela deve rodar logo após a M1, antes da T1.

## T4–T8 — isolamento por empresa (`20261022160000_tenant_isolamento.sql`, `20261022170000_tenant_rpcs.sql`)

Estado: **escritas e testadas só na cópia local. Não aplicadas em produção.**
Teste: `supabase/tests/tenant_isolamento_ab_test.sql` (empresas fictícias A e B).

- **Empresa da requisição**: o app manda `x-rx7-tenant: <slug>` em toda
  chamada; `tenant_atual()` lê `request.headers` e só devolve a empresa se o
  `auth.uid()` tiver vínculo ativo (e perfil ativo). Sem linha de sessão: cada
  requisição/aba traz a sua. Header ausente, inválido ou de empresa alheia =
  nada visível, nenhuma gravação.
- **RESTRICTIVE** nas 25 tabelas (ler/incluir/alterar/excluir: `tenant_id =
  tenant_atual()`; gravação também `pode_escrever_no_tenant`) e em `profiles`
  (só membros da empresa; alteração por quem gere todas as empresas do alvo).
- **Papéis por empresa**: `is_gerente`, `pode_ver_etapa`, `pode_mover_etapa`,
  handoff SDR, metas de closer, permissões e agenda usam `papel_comercial(user,
  tenant)` (admin_empresa = gerente). `profiles.role` não decide mais nada.
- **Integridade**: `UNIQUE (tenant_id, id)` nos pais + 35 FKs compostas
  validadas; usuário referenciado (owner, responsável, autor...) precisa ser
  membro ativo da empresa do registro.
- **Únicos por empresa** (13): CPF, CNPJ, telefone da conversa, chave da etapa,
  slug de formulário/nicho, nome de funil/nicho/serviço, funil padrão, meta do
  mês, external_id, evento Google. Mesmo CPF em A e B: permitido; repetido
  dentro de A: bloqueado.
- **Arquivo somente leitura** para qualquer requisição da API (usuário ou
  service_role); só migration sem JWT escreve.
- **RPCs SECURITY DEFINER** começam com `tenant_exigir()` e filtram cada
  leitura/gravação por empresa; dedup de cliente só dentro da empresa;
  agregados (realizado, metas, dashboard) só da empresa da requisição.
- **Integrações (service_role)**: empresa vem do registro (formulário,
  conversa, cliente). Slug de formulário repetido em duas empresas é recusado.
- `membros_empresa_atual()`: papel de cada membro na empresa (telas).

### App (empresa ativa)

- URL `/e/<slug>/...`. O `proxy.ts` descarta o header interno vindo do
  browser, reescreve para a rota interna e repassa o slug (`x-rx7-empresa`);
  `lib/supabase/server.ts` envia ao banco. Caminho sem prefixo é completado com
  a empresa da aba de origem (Referer do mesmo site) ou, em aba nova, com o
  cookie da última usada — que nunca autoriza nada.
- `getEmpresaAtual()` (DAL) confere o vínculo; `getUsuarioAtual().role` é o
  papel na empresa. `/empresas` escolhe a empresa; trocar recarrega a página.
- Papel e acesso de usuário: vínculo da empresa via `definir_membro_tenant`
  (exige admin_empresa). Desativar tira o acesso só nesta empresa.

### Ordem de liberação (inalterada, numa janela só)

M1 → T1 → T2 → `vincular_proprietario_rx7` → T3 → T4 → T8 → deploy do app.
O app novo **não funciona** sem T1–T8 (consulta `tenant_memberships` e manda o
header); o app atual **não funciona** depois da T4 (sem header não vê nada).

## T9–T12 — onboarding e integrações por empresa

Estado: **escritas e testadas só na cópia local. Não aplicadas; Edge Functions não publicadas.**
Testes: `supabase/tests/integracoes_multiempresa_test.sql` (com
`scaffold_local_integracoes.sql`, esqueleto local de vault/storage/realtime) e
`supabase/tests/ingestao_concorrencia_local.sh` (duas sessões reais).

| Migration | O quê |
|---|---|
| `20261023100000_onboarding_empresa` | `provisionar_empresa` (Super Admin, idempotente, atômica): empresa + admin_empresa + funil principal com as 6 etapas padrão, nicho "geral", formulário "padrao" e `tenant_configuracoes`. Rio X7 recebe a mesma estrutura se o proprietário já estiver vinculado. |
| `20261023110000_ingestao_credencial` | `ingestao_credenciais` (só hash do segredo), `gerar/revogar_credencial_ingestao` (admin_empresa), `ingerir_lead_por_credencial` (service_role). Lock por empresa+external_id e por contato; recusa suspensa/cancelada/arquivo. O caminho atual `ingerir_lead_formulario` passa a gravar só na Rio X7. |
| `20261023120000_google_agenda_por_empresa` | Conexão Google por empresa (PK tenant_id), estado OAuth por empresa (uso único, 10 min), token no Vault por empresa, RPCs só da service_role com empresa explícita. |
| `20261023130000_storage_realtime_empresa` | RESTRICTIVE no Storage (`whatsapp-midia`: `{tenant}/{conversa}/{arquivo}`; arquivos atuais legíveis só na empresa da conversa; `avatares`: só o próprio ou quem gere todas as empresas dele). Realtime por canal privado `empresa:<tenant>:conversa:<id>` (triggers com `realtime.send` + policy em `realtime.messages`). |

Edge Functions: nova `ingestao-lead-empresa` (credencial no header, nunca na
URL); `admin-usuarios` (convidar/vincular por empresa, provisionar empresa,
bloquear login — Super Admin); `agenda-google` (empresa pelo header validado
no banco, state HMAC + estado gravado, callback configurável). `ingestao-lead`
(Respondi atual) não mudou. Helpers puros em `supabase/functions/_shared/`.

Secrets novos (não configurados): `GOOGLE_OAUTH_STATE_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI` (opcional), `CRM_SITE_URL` (convites).
`GOOGLE_CONTA_PERMITIDA` deixa de ser usado (vai para `tenant_configuracoes`).

Ordem de liberação: … → T8 → T9 → T10 → T11 → T12 → Edge Functions → app.

## T13 — Super Admin, planos e assinaturas (`20261024100000_planos_assinaturas.sql`)

Estado: **escrita e testada só na cópia local** (`supabase/tests/superadmin_assinaturas_test.sql`).

- `planos` (starter/pro/business): preço mensal/anual, limite de usuários e
  de integrações, dias de teste, recursos e status. **Sem preços e sem
  limites definidos** (nulos, status rascunho) até a Rio X7 decidir.
- `assinaturas` (uma por empresa assinante): teste/ativa/vencida/suspensa/
  cancelada, ciclo, datas, referência do provedor. O status define o da
  empresa (suspensa/cancelada = somente leitura, nada apagado; vencida =
  carência). Arquivo e empresa interna não têm assinatura.
- Histórico automático (`assinaturas_historico`) e auditoria de toda ação do
  Super Admin (`admin_auditoria`).
- Limites no banco: usuários ativos (RX001), integrações = credenciais de
  ingestão ativas + Google (RX002), recurso do plano (RX003).
- Pagamento: `registrar_evento_pagamento` (service_role) idempotente por
  (provedor, evento); suspensão manual nunca é desfeita por pagamento. O
  adaptador do provedor escolhido (Asaas, Mercado Pago, Stripe…) só traduz o
  evento para essa função.
- Tabelas sem GRANT; tudo por RPC `admin_*` (confere `is_super_admin()`) e
  `minha_assinatura()` (admin_empresa da empresa da requisição).

App: `/admin` (empresas, nova empresa, detalhe com assinatura/suspensão/
histórico, planos, auditoria) — 404 para quem não é Super Admin;
`/configuracoes/assinatura` (só leitura, admin_empresa).

## T14 — Fontes de leads por empresa (`20261025100000_fontes_leads.sql`)

Estado: **escrita e testada só na cópia local** (`supabase/tests/fontes_leads_test.sql`).

- `fontes_leads`: tipo (formulário RX7, webhook, Respondi da empresa, Google
  Sheets, Meta Lead Ads, WhatsApp Cloud), funil + etapa de entrada +
  responsável (da mesma empresa), configuração pública, status
  ativa/pausada/revogada, `validada_em` (provedor), último lead/erro.
- Empresa sempre pela fonte: token `rx7f_…` (só hash), payload assinado da Meta
  + página/número de fonte **validada**, ou id público do formulário RX7.
- `ingerir_lead_nucleo`: normaliza (telefone com DDI 55, e-mail, texto),
  deduplica cliente e torna o lead idempotente por fonte, só na empresa.
- `ingestao_eventos`: todo recebimento (criado/atualizado/recusado/erro).
- Limites e recursos do plano valem para fontes ativas; empresa
  suspensa/cancelada não recebe.
- O Respondi antigo (Scorpion) não faz parte do RX7.

Edge Functions: `ingestao-lead-empresa` (token da fonte; formato interno ou
Respondi) e `meta-webhooks` (Lead Ads + WhatsApp Cloud; assinatura
`X-Hub-Signature-256`, verificação GET, `/validar` com o token da empresa).
App: `/configuracoes/integracoes` (catálogo + fontes) e `/f/<id>` (formulário público).
