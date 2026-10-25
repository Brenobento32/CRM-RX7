# AVANTE — Nova fase: propostas (empresas, URL, WhatsApp, Google Sheets)

Documento de **proposta**. Nada aqui foi aplicado em produção. As migrations
propostas ficam em `supabase/propostas/` (fora de `supabase/migrations/`, para
nenhum `db push` aplicá-las por engano) e foram testadas só em cópia local
(`crm_rx7_empresa`, teste `supabase/tests/empresa_perfil_test.sql`, 7/7 ok).

---

## 1. Empresas, usuários e papéis (Etapa 4)

### Como está hoje

- `tenants`: nome, slug (único, normalizado, separado do `id`), tipo, status,
  somente_leitura. **Não tem** logo, telefone, e-mail nem responsável.
- O Super Admin cria a empresa pela Edge Function `admin-usuarios`
  (`provisionar_empresa`): empresa + **um administrador inicial**
  (`admin_empresa`, que é o "gerente inicial") + funil inicial + teste do plano.
  Tudo auditado em `admin_auditoria`.
- Papéis na empresa (`tenant_papel`): admin_empresa, gerente, sdr, closer.
  Toda regra do banco pergunta pelo papel por **uma função só**,
  `papel_comercial()`, que traduz para `user_role` (gerente/closer/sdr).
- Super Admin é uma tabela à parte (`super_admins`); nenhum fluxo do app cria
  Super Admin, e criar usuário pelo gerente só cria vínculo **na empresa da
  aba** (a Edge Function exige admin_empresa daquela empresa).

### Proposta (`20261027100000` + `20261027100100`)

| Item | Como |
|---|---|
| Logo, telefone, e-mail, responsável | Colunas novas opcionais em `tenants`. A logo é um **caminho** no bucket (`<tenant_id>/logo.png`), nunca uma URL livre; o banco recusa caminho fora da pasta da empresa. |
| Bucket de logos | `empresa-logos`, leitura pública (logo não é segredo), só PNG/JPEG/WEBP (SVG fora: pode carregar script), até 2 MB; gravar só Super Admin ou admin da própria empresa. |
| Vendedor e Atendente | Valores novos em `tenant_papel`, como **cargos distintos**: não herdam as regras de Closer nem de SDR. Até a matriz ser implementada, ficam sem acesso comercial. Regras propostas em [MATRIZ-CARGOS.md](MATRIZ-CARGOS.md). |
| Editar dados da empresa | RPC `admin_atualizar_empresa`: Super Admin ou admin da própria empresa; nunca altera slug, tipo ou status; auditada. |

**Decisão sua antes de aplicar:** aprovar a matriz de cargos
([MATRIZ-CARGOS.md](MATRIZ-CARGOS.md)) e as quatro decisões pendentes dela.

### O que muda no app depois da migration (ainda não feito)

1. `lib/validations/usuario.ts` + formulário de usuário: opções Gerente,
   Vendedor, Atendente, SDR, Closer (o rótulo vem de `tenant_papel`).
2. Edge Function `admin-usuarios`: aceitar os papéis novos (lista fechada; nunca
   `admin_empresa` vindo de gerente comum, nunca Super Admin).
3. Super Admin → "Nova empresa": campos telefone, e-mail, responsável e upload
   de logo (upload direto ao Storage com a sessão do Super Admin).
4. Configurações da empresa (admin): editar os mesmos dados.

### "Trocar empresa"

Já ajustado nesta rodada: o item só aparece para Super Admin. Usuário normal
fica na própria empresa (quem tem vínculo com mais de uma ainda passa pela
tela `/empresas` no login, que só lista os vínculos ativos dele).

---

## 2. URL `/nome-da-empresa/` (Etapa 5)

### Como está hoje

- URL `/e/<slug>/...`. O `proxy.ts` tira o prefixo, reescreve para a rota
  interna e passa o slug num header interno (`x-rx7-empresa`; qualquer valor
  vindo do navegador é apagado).
- O app manda o slug ao PostgREST (`x-rx7-tenant`), e `tenant_atual()` só o
  aceita se o usuário tiver **vínculo ativo** nessa empresa. As policies
  RESTRICTIVE por `tenant_id` fazem o resto. Slug, header e cookie são só a
  escolha do usuário, nunca autorização. Isso **não muda** com a URL nova.

### Proposta de migração para `/<slug>/...`

1. **Slugs reservados** (já na proposta SQL, `slug_reservado()`): login, auth,
   admin, api, f, e, esqueci-senha, redefinir-senha, sem-acesso, empresas
   **e todas as rotas internas** (agenda, funil, clientes, metas, propostas,
   relatorios, configuracoes, perfil, negociacoes, conversas, leads…), porque
   `/<slug>` e `/agenda` dividem o mesmo primeiro segmento. Constraint
   `NOT VALID`: não reprova empresa antiga; vale para toda criação/alteração.
2. **Proxy** (mudança pequena em `lib/empresa/rota.ts`):
   - `separarPrefixo` passa a aceitar `/<slug>/resto` quando o primeiro segmento
     é slug válido **e não reservado** (mesma lista, espelhada em TS com teste
     que compara com a do banco);
   - `/e/<slug>/x` continua funcionando e responde **308 → `/<slug>/x`**
     (links e favoritos antigos não quebram);
   - `caminhoDaEmpresa()` passa a gerar `/<slug>/x`.
3. **Troca de slug controlada**: só Super Admin, com motivo, auditada
   (`admin_alterar_slug`). O slug antigo vai para `tenant_slugs_antigos` e
   **nunca** pode ser usado por outra empresa (link velho jamais abre a empresa
   errada). `resolver_slug_antigo()` devolve o slug novo **só para membro** da
   empresa — para os demais devolve nulo, sem revelar que a empresa existe.
4. **Sem vazamento entre empresas**: slug de empresa de que o usuário não é
   membro cai no mesmo "sem acesso" de um slug inexistente (mesma resposta,
   mesmo tempo), e nenhum dado é lido, porque `tenant_atual()` recusa antes.

Ordem segura: aplicar SQL (com autorização) → publicar o proxy aceitando os
dois formatos → trocar os links gerados → depois de um tempo, `/e/` vira só
redirecionamento.

---

## 3. WhatsApp por QR Code (Etapa 6)

### Diagnóstico

1. **O que está pronto**: serviço Node separado (`whatsapp-service/`) que
   conecta **um** número por QR Code, grava mensagens recebidas (texto, imagem,
   documento, áudio; vídeo só legenda) em `conversas`/`mensagens`, cria lead
   automático (`criar_cliente_whatsapp`) e envia texto pendente criado pelo CRM
   (polling + Realtime). O CRM tem a tela de conversas e a configuração de funil
   e responsável padrão (`/configuracoes/whatsapp`).
2. **Tecnologia**: Baileys (`@whiskeysockets/baileys` 6.7), **biblioteca não
   oficial** que imita o WhatsApp Web.
3. **QR Code**: gerado pelo Baileys e impresso **no terminal**
   (`qrcode-terminal`). Não existe QR na tela do CRM.
4. **Sessão**: `useMultiFileAuthState('auth_info_baileys')`, arquivos em disco
   na máquina do serviço (fora do Git). Sem pasta, sem sessão.
5. **O que falta para leads e conversas**:
   - **multiempresa**: o serviço não conhece empresa nenhuma. Usa uma linha
     fixa de conexão (`id …0001`) e busca cliente por telefone **em todas as
     empresas** com a `service_role`, que ignora a RLS. Com mais de uma
     empresa, um contato poderia ser ligado ao cliente de outra empresa. Além
     disso, conversa sem cliente não recebe `tenant_id`, e a gravação falha.
     **Não deve ser ligado assim no AVANTE.**
   - QR na tela do CRM (hoje só terminal), status ao vivo, desconectar.
   - Uma sessão por empresa (pasta/credencial por `tenant_id`) e filtro por
     `tenant_id` em toda consulta do serviço.
6. **Hostinger atual**: não serve como está. O Baileys precisa de um processo
   **sempre ligado**, com socket aberto 24 h e disco persistente para a sessão;
   a hospedagem gerenciada de apps Node reinicia e hiberna processos. Precisaria
   de uma VPS (ou outro worker dedicado).
7. **Riscos e caminho seguro**:
   - não oficial: pode quebrar a cada mudança do WhatsApp e o **número pode ser
     banido**, mais ainda com envio em massa;
   - a sessão em disco equivale à senha do WhatsApp da empresa.

**Comparação com a opção oficial da Meta (WhatsApp Cloud API)**: já existe
meio caminho no AVANTE. A Edge Function `meta-webhooks` recebe o webhook do
número oficial e **cria ou atualiza o lead** na empresa dona do número
(fonte `whatsapp_cloud`, separada por empresa). Falta guardar as mensagens em
`conversas` e enviar respostas pela API. Ela não tem servidor sempre ligado,
não tem risco de banimento por uso de cliente não oficial e já nasce
multiempresa. Custa por conversa e exige app da Meta, número verificado e
templates para iniciar conversa.

**Recomendação**: usar a Cloud API oficial como caminho principal. Deixar o
QR/Baileys só como opção "beta" depois de reescrito para multiempresa,
rodando numa VPS. Nesta rodada nada foi conectado nem escaneado.

---

## 4. Google Sheets (Etapa 7)

### Como está hoje

- Fonte de leads tipo `google_sheets` (por empresa, em
  Configurações → Integrações). A empresa cola um **Apps Script** na
  planilha. O script guarda o token em `AVANTE_TOKEN` e envia cada nova linha
  para a Edge Function `ingestao-lead-empresa`.
- Já existe: token por fonte (só o hash fica no banco, com rotação e
  revogação), dedup por `external_id` dentro da empresa, funil, etapa e
  responsável por fonte, histórico em `ingestao_eventos` (criado, atualizado,
  recusado ou erro) e origem gravada.
- Não existe: colar a URL da planilha, escolher a aba, mapear campos, ver uma
  prévia, importar linhas antigas ou sincronizar sem o script.

### Plano (sem publicar a planilha)

1. **Autorização**: OAuth do Google por empresa, com o escopo `drive.file` e
   o Google Picker. O usuário escolhe a planilha, e o app só ganha acesso
   àquele arquivo, sem precisar torná-la pública. É um escopo não sensível,
   com verificação mais simples que `spreadsheets.readonly`. Reaproveita o
   desenho do OAuth da agenda (tokens só na Edge Function, nunca no Next,
   estado do OAuth com validade curta, conta permitida por empresa).
2. **Configurar** (só Gerente/admin da empresa e Super Admin, travado no banco
   como as outras fontes): planilha → aba → linha de cabeçalho →
   **mapeamento** coluna → campo (nome, telefone, e-mail, empresa, instagram,
   nicho) → **prévia** das 10 primeiras linhas com o resultado (novo,
   atualiza ou recusado) → confirmar.
3. **Importar**: Edge Function lê em lotes e chama o mesmo
   `ingerir_lead_empresa` de hoje. `external_id = <planilha>:<aba>:<linha>`
   mais um hash do conteúdo (reimportar não duplica; linha editada atualiza),
   origem "Google Sheets".
4. **Sincronizar**: `pg_cron` a cada 15 min chama a função por fonte ativa,
   que lê só a partir da última linha processada (cursor salvo na fonte).
   Erros e totais vão para `ingestao_eventos` e para "último erro" da fonte,
   como hoje.
5. **Separação por empresa**: fonte, token OAuth, cursor e histórico sempre com
   `tenant_id`. A Edge Function resolve a empresa pela fonte, nunca por nada
   vindo da planilha.

O Apps Script atual continua funcionando para quem já usa.
