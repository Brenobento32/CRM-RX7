# Google Apps Script — ingestão automática de leads

Este arquivo é **documentação/referência**, não código executado pelo Next
nem pelo build do CRM (`tsconfig.json` nem olha pra pasta `docs/`). O script
abaixo deve ser **colado manualmente** no editor de Apps Script vinculado à
planilha que já recebe as respostas do formulário atual (Instituição de
Ensino) — Extensões → Apps Script, dentro da própria planilha do Google
Sheets.

## Como funciona o fluxo

```
Google Forms
  → Google Sheets (planilha atual, uma linha por resposta)
  → Google Apps Script (trigger "Ao enviar formulário")
  → POST com segredo no header
  → Edge Function supabase/functions/ingestao-lead
  → public.ingerir_lead_formulario() — upsert de cliente + negociação + respostas
```

O CRM nunca lê a planilha diretamente, nem tem nenhuma credencial do Google.
Todo o acesso à planilha é feito pelo próprio Apps Script, dentro da conta
Google que já é dona do formulário/planilha.

## 🛑 Bloqueio atual: funil de leads automáticos sem etapa inicial

O teste transacional de `ingerir_lead_formulario` (ver relatório da sessão)
encontrou que o funil configurado para receber leads automáticos
(`whatsapp_conexoes.funil_id`, hoje **"Funil Inbound"** — não é o Funil
Principal/padrão) tem uma etapa **"Lead Novo"** (ordem 0, ativa, aberta),
mas nenhuma etapa desse funil está marcada como `etapa_inicial = true`. A
migration `20261008130000` só marcou a "Lead Novo" do funil **padrão**
("Funil Out"), que não é o funil realmente usado pelo WhatsApp/formulário.

**Até isso ser corrigido no banco, todo lead de formulário real falha com
`P0002` ("funil não tem etapa inicial configurada").** A correção é uma
atualização de dado (1 linha, usando a função `definir_etapa_inicial` já
existente), não uma migration — mas ainda não foi aplicada, aguardando
aprovação (ver relatório). **Não instale o Apps Script na planilha real
nem envie leads antes disso ser corrigido e revalidado.**

## Headers reais da planilha (confirmados)

```
1.  Qual seu nome e sobrenome?
2.  Digite o número do seu WhatsApp para contato
3.  Digite o seu melhor E-mail
4.  Qual o nome da empresa?
5.  Qual o Instagram da sua Instituição de Ensino?
6.  Quantos colaboradores você possui?
7.  Atualmente, qual é o maior desafio da sua instituição?
8.  <nome do respondente>, qual é a sua meta de alunos na sua instituição de ensino?
9.  E quantos alunos você tem atualmente?
10. Pontuação
11. Data
12. ID
```

As colunas depois de `ID` existem vazias na planilha e **nunca são lidas**
por este script.

## ⚠️ Pendência: texto exato do header 8

O header 8 é dirigido ao respondente pelo nome da pessoa que criou o
formulário (hoje, provavelmente "Breno, qual é a sua meta..." — o mesmo
texto já cadastrado em `perguntas.texto`, ver seção de mapeamento abaixo),
mas o texto **byte a byte** desse header não foi confirmado nesta rodada.
Por isso o script localiza essa coluna pela **posição** (8ª das 12 colunas
reais acima), não pelo texto — funciona hoje, mas é sensível a reordenar
colunas na planilha. Se a planilha for alterada, revalide essa posição; se
quiser remover essa fragilidade, informe o texto exato do header 8 e o
script passa a localizá-lo por texto, como as outras 11 colunas.

## Mapeamento exato

### Dados do cliente

| Header real | Destino |
|---|---|
| `Qual seu nome e sobrenome?` | `clientes.nome` |
| `Digite o número do seu WhatsApp para contato` | `clientes.telefone` |
| `Digite o seu melhor E-mail` | `clientes.email` |
| `Qual o nome da empresa?` | `clientes.empresa` |
| `Qual o Instagram da sua Instituição de Ensino?` | `clientes.instagram` |

### Qualificação (`respostas_lead`, nunca coluna própria em clientes/negociações)

O `pergunta_externa` enviado no payload precisa casar **exatamente** (depois
de `trim`, mas sensível a maiúscula/minúscula) com `perguntas.texto` no
banco — por isso a tabela abaixo tem duas colunas diferentes: o header real
(usado só para achar a célula) e o texto canônico já cadastrado (enviado no
payload). Quando os dois coincidem, não há nada especial; quando não
coincidem, **nunca** mandar o header real como `pergunta_externa` — sempre a
canônica.

| # | Header real (acha a coluna) | `pergunta_externa` enviado (canônica no banco) | Observação |
|---|---|---|---|
| 1 | `Quantos colaboradores você possui?` | `Quantos colaboradores você possui?` | Idênticos — `escolha_unica`, já cadastrada |
| 2 | `Atualmente, qual é o maior desafio da sua instituição?` | `Atualmente, qual é o maior desafio da sua Instituição?` | **Diferem só no "I" maiúsculo** — o banco tem `Instituição` com I maiúsculo. Mandar o header real aqui faria a resposta ser **ignorada silenciosamente** (nunca gravada) — ver aviso geral abaixo |
| 3 | posição 8 (ver pendência acima) | `Breno, qual é a sua meta de alunos na sua instituição de ensino?` | Já cadastrada no banco com esse texto — ver pendência do nome acima |
| 4 | `E quantos alunos você tem atualmente?` | `E quantos alunos você tem atualmente?` | Já cadastrada em `perguntas` (`texto_livre`, inserida como dado de configuração — sem migration) |

Pergunta não reconhecida pelo banco (texto não casa com nenhuma
`perguntas.texto` ativa) é **ignorada silenciosamente** pela função de
ingestão — não quebra o lead, só não grava aquela resposta.

### Pontuação, Data e ID — não são qualificação nem dado de cliente

| Header real | Destino | Por quê |
|---|---|---|
| `Pontuação` | `negociacoes.atribuicao.pontuacao` (texto) | Não existe hoje coluna própria pra isso; `atribuicao` é o único campo JSON genérico já existente que aceita uma chave adicional sem migration. **Nunca** usada para derivar temperatura ou qualificação automaticamente — só preservada como veio |
| `Data` | `negociacoes.atribuicao.data_formulario` (texto) | Mesmo raciocínio de `pontuacao`: sem coluna própria sem migration. Guardada **exatamente como a planilha mandou** (string), sem nenhuma conversão de timezone. **Nunca** substitui `negociacoes.created_at` (que continua sendo preenchido pelo banco, no momento do INSERT) |
| `ID` | `external_id` (dedup) | Ver seção abaixo |

### Atribuição / campanha — a planilha real não tem nenhum campo de Meta Ads/UTM

Os headers reais confirmados **não incluem** `campaign_id`, `campaign_name`,
`adset_id`, `adset_name`, `ad_id`, `ad_name`, `utm_source`, `utm_medium`,
`utm_campaign`, `utm_content` nem `utm_term`. Nenhum desses é preenchido por
este script — `atribuicao` sai só com `pontuacao` e `data_formulario`
(quando houver), nunca com valores inventados. Se existir outra aba/fonte
com dados de campanha, isso não foi assumido aqui — é uma pendência
separada (ver relatório).

## `external_id` — coluna `ID`

`external_id` passa a ser **exatamente o valor da coluna `ID`** da planilha
— nunca mais `sheetId + número da linha` (isso só valia enquanto não
tínhamos um identificador real de resposta). Nunca timestamp.

- Se `ID` estiver vazio nesta linha: o script **não envia a requisição**,
  registra um erro técnico na coluna de status (sem nenhum dado do lead) e
  para — igual a uma falha de validação, só que resolvida antes de gastar
  uma chamada de rede. A Edge Function também rejeita `external_id` vazio
  (400) de qualquer forma, como segunda camada.
- Reenviar o mesmo `ID` nunca duplica: `ingerir_lead_formulario` faz upsert
  por `(origem, external_id)` — mesmo cliente, mesma negociação, respostas
  atualizadas.

## Antes de instalar

1. Os headers já estão confirmados (seção acima) — exceto o texto exato do
   header 8 (pendência própria, não bloqueia a instalação: a posição já
   funciona).
2. Peça ao administrador do CRM o valor do segredo (`INGESTAO_LEAD_SECRET`,
   o mesmo configurado via `npx supabase secrets set` na Edge Function) e a
   URL da função (`INGESTAO_LEAD_URL`, formato
   `https://<project-ref>.supabase.co/functions/v1/ingestao-lead`, só existe
   depois do deploy). Os dois vão em **Propriedades do script**
   (PropertiesService) — nunca escritos no código, ver seção própria abaixo.
3. Slugs usados hoje (seed da migration `20261008100000_leads_multinicho.sql`):
   - `nicho_slug`: `instituicao-ensino`
   - `formulario_slug`: `instituicao-ensino-captacao`
4. As 4 perguntas de qualificação já estão cadastradas em `perguntas`,
   incluindo "E quantos alunos você tem atualmente?" (inserida como dado de
   configuração, sem migration, confirmada idempotente).
5. ⚠️ **Bloqueio encontrado pelo teste transacional (ver relatório):** o
   funil que hoje recebe leads automáticos (`whatsapp_conexoes.funil_id`,
   "Funil Inbound") tem uma etapa "Lead Novo" mas ela **não está marcada
   como `etapa_inicial`** — só a etapa "Lead Novo" do Funil Principal
   recebeu a flag na migration anterior. Sem corrigir isso no banco (fora
   deste arquivo, aguardando aprovação), `ingerir_lead_formulario` falha com
   `P0002` para todo lead novo de formulário. Não instale o trigger real
   enquanto isso não for corrigido.

## Script

```javascript
// ===========================================================================
// Ingestão de leads — Instituição de Ensino.
// Instalar em: Extensões → Apps Script, na planilha que recebe o formulário.
// Trigger: Editar → Acionadores do projeto atual → Adicionar acionador →
//          função `aoReceberResposta`, evento "Ao enviar formulário".
// ===========================================================================

// URL da Edge Function e segredo — NUNCA escritos aqui no código (nem num
// repositório público, nem neste arquivo). Os dois vivem só em Propriedades
// do script: Configurações do projeto → Propriedades do script → Adicionar
// propriedade (ver seção "Configurar URL e segredo" abaixo). Falha alto e
// claro se faltar algum, em vez de mandar a requisição pra uma URL vazia.
var PROPRIEDADES = PropertiesService.getScriptProperties()
var URL_INGESTAO = PROPRIEDADES.getProperty('INGESTAO_LEAD_URL')
var SEGREDO = PROPRIEDADES.getProperty('INGESTAO_LEAD_SECRET')

if (!URL_INGESTAO || !SEGREDO) {
  throw new Error(
    'Configure INGESTAO_LEAD_URL e INGESTAO_LEAD_SECRET em Propriedades do script antes de usar.',
  )
}

var NICHO_SLUG = 'instituicao-ensino'
var FORMULARIO_SLUG = 'instituicao-ensino-captacao'

// Headers REAIS confirmados da planilha (ver seção "Headers reais" acima).
// `dados`/`pontuacao`/`id`: texto exato do header, usado tanto para achar a
// coluna quanto (quando for o caso) como o próprio valor enviado.
//
// `perguntas`: cada item tem `coluna` (como achar a célula: texto exato do
// header OU `{ posicao: N }` quando o texto do header não é conhecido com
// certeza — ver pendência do header 8) e `canonica` (o texto EXATO já
// cadastrado em `perguntas.texto` no banco, sempre enviado como
// `pergunta_externa` — nunca o header real, que pode ter grafia diferente
// da canônica, como a pergunta 2 abaixo).
var MAPA_COLUNAS = {
  dados: {
    nome: 'Qual seu nome e sobrenome?',
    telefone: 'Digite o número do seu WhatsApp para contato',
    email: 'Digite o seu melhor E-mail',
    empresa: 'Qual o nome da empresa?',
    instagram: 'Qual o Instagram da sua Instituição de Ensino?',
  },
  perguntas: [
    {
      // Header real e canônica são idênticos — sem pegadinha.
      coluna: 'Quantos colaboradores você possui?',
      canonica: 'Quantos colaboradores você possui?',
    },
    {
      // ATENÇÃO: o header real tem "instituição" minúsculo; a canônica no
      // banco tem "Instituição" maiúsculo. O casamento é sensível a
      // maiúscula/minúscula — por isso NUNCA mandar o header real aqui.
      coluna: 'Atualmente, qual é o maior desafio da sua instituição?',
      canonica: 'Atualmente, qual é o maior desafio da sua Instituição?',
    },
    {
      // Texto do header não confirmado byte a byte (pendência) — localiza
      // pela posição: é a 8ª das 12 colunas reais (nome, telefone, email,
      // empresa, instagram, colaboradores, desafio, ESTA, alunos hoje,
      // pontuação, data, id). Revalide se a planilha for reorganizada.
      coluna: { posicao: 8 },
      canonica: 'Breno, qual é a sua meta de alunos na sua instituição de ensino?',
    },
    {
      // Pergunta nova — ainda não cadastrada em `perguntas` (pendência de
      // banco). Header real e canônica propostos são idênticos.
      coluna: 'E quantos alunos você tem atualmente?',
      canonica: 'E quantos alunos você tem atualmente?',
    },
  ],
  pontuacao: 'Pontuação',
  data: 'Data',
  id: 'ID',
}

// Nome de uma coluna de controle opcional, já existente na planilha, pra
// registrar sucesso/erro desta linha. Deixe '' se a planilha não tiver
// (ou não quiser) essa coluna — o script simplesmente não escreve nada.
var COLUNA_STATUS = 'Status CRM'

function aoReceberResposta(e) {
  processarLinha(e.range.getSheet(), e.range.getRow())
}

/**
 * Reenvio manual e seguro de uma linha específica (número da linha na
 * planilha, igual ao número que o Sheets mostra à esquerda) — por exemplo
 * depois de ver "erro" na coluna de status. Rodar: abrir o editor do Apps
 * Script, escolher esta função na barra de ferramentas e clicar em
 * Executar (ajuste o número abaixo antes, ou transforme num prompt se
 * preferir reenviar várias linhas sem editar código a cada vez).
 *
 * Sempre seguro, mesmo repetido: `external_id` é a coluna `ID` da própria
 * linha (nunca muda) e `ingerir_lead_formulario` no banco faz upsert — o
 * mesmo cliente/negociação é atualizado, nunca duplicado.
 */
function reenviarLinha(linha) {
  var planilha = SpreadsheetApp.getActiveSheet()
  processarLinha(planilha, linha)
}

/**
 * Lógica compartilhada entre o trigger automático (`aoReceberResposta`) e o
 * reenvio manual (`reenviarLinha`) — mesmo comportamento nos dois casos,
 * nunca duas implementações divergindo.
 */
function processarLinha(planilha, linha) {
  var headers = planilha.getRange(1, 1, 1, planilha.getLastColumn()).getValues()[0]
  var valores = planilha.getRange(linha, 1, 1, planilha.getLastColumn()).getValues()[0]

  function celula(indice) {
    var valor = valores[indice]
    return valor === null || valor === undefined ? '' : String(valor).trim()
  }

  function valorDe(headerProcurado) {
    var indice = headers.indexOf(headerProcurado)
    return indice === -1 ? '' : celula(indice)
  }

  /** `coluna` é o texto exato de um header, ou `{ posicao: N }` (1-based). */
  function valorDaColuna(coluna) {
    if (typeof coluna === 'string') return valorDe(coluna)
    return celula(coluna.posicao - 1)
  }

  // external_id = coluna "ID" da própria linha — nunca timestamp, nunca
  // sheetId+linha (isso só valia como fallback sem um identificador real).
  var externalId = valorDe(MAPA_COLUNAS.id)
  if (!externalId) {
    // Sem rede: não faz sentido chamar a Edge Function sem o identificador
    // de dedup. Nenhum dado do lead vai pro log — só o aviso técnico.
    marcarStatus(planilha, linha, headers, 'erro: coluna "ID" vazia — lead não enviado')
    return
  }

  var respostas = []
  for (var i = 0; i < MAPA_COLUNAS.perguntas.length; i++) {
    var item = MAPA_COLUNAS.perguntas[i]
    var resposta = valorDaColuna(item.coluna)
    // Resposta vazia nunca gera uma resposta falsa — simplesmente não entra no payload.
    if (resposta !== '') {
      respostas.push({ pergunta_externa: item.canonica, resposta: resposta })
    }
  }

  // Pontuação e Data: dados nativos do formulário, não são campanha — só
  // preservados se vierem, exatamente como a célula entrega. `celula()` já
  // usa `String(valor)`: se a coluna "Data" for um Date do Sheets, isso usa
  // a formatação padrão do fuso do próprio projeto Apps Script — nenhuma
  // conversão de timezone é feita aqui, nenhuma é inventada.
  var pontuacao = valorDe(MAPA_COLUNAS.pontuacao)
  var dataFormulario = valorDe(MAPA_COLUNAS.data)

  var payload = {
    external_id: externalId,
    formulario_slug: FORMULARIO_SLUG,
    nicho_slug: NICHO_SLUG,
    dados: {
      nome: valorDe(MAPA_COLUNAS.dados.nome),
      telefone: valorDe(MAPA_COLUNAS.dados.telefone),
      email: valorDe(MAPA_COLUNAS.dados.email),
      empresa: valorDe(MAPA_COLUNAS.dados.empresa),
      instagram: valorDe(MAPA_COLUNAS.dados.instagram),
    },
    respostas: respostas,
  }
  var atribuicao = {}
  if (pontuacao) atribuicao.pontuacao = pontuacao
  if (dataFormulario) atribuicao.data_formulario = dataFormulario
  if (Object.keys(atribuicao).length > 0) payload.atribuicao = atribuicao

  try {
    var resposta = UrlFetchApp.fetch(URL_INGESTAO, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Webhook-Secret': SEGREDO },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    })

    var codigo = resposta.getResponseCode()
    var corpo = resposta.getContentText()
    marcarStatus(planilha, linha, headers, codigo >= 200 && codigo < 300 ? 'ok' : 'erro ' + codigo + ': ' + corpo)
  } catch (erro) {
    // Nunca relança: um erro não tratado aqui faria o Apps Script tentar
    // reexecutar o trigger automaticamente mais tarde, reenviando a MESMA
    // linha sem controle — preferimos registrar o erro na própria planilha
    // e deixar o reenvio para `reenviarLinha`, explícito e sob controle.
    marcarStatus(planilha, linha, headers, 'erro: ' + erro.message)
  }
}

function marcarStatus(planilha, linha, headers, texto) {
  if (!COLUNA_STATUS) return
  var indice = headers.indexOf(COLUNA_STATUS)
  if (indice === -1) return // coluna não existe — não cria nada sozinho na planilha do usuário.
  // Nunca grava dado do lead aqui — só código HTTP/erro técnico e a hora.
  planilha.getRange(linha, indice + 1).setValue(texto + ' — ' + new Date().toISOString())
}
```

## Configurar URL e segredo no Apps Script

No editor do Apps Script: **Configurações do projeto → Propriedades do
script → Adicionar propriedade**, duas vezes:

| Propriedade | Valor |
|---|---|
| `INGESTAO_LEAD_URL` | `https://<project-ref>.supabase.co/functions/v1/ingestao-lead` (a URL real só existe depois do deploy) |
| `INGESTAO_LEAD_SECRET` | o mesmo valor configurado na Edge Function via `npx supabase secrets set INGESTAO_LEAD_SECRET=...` |

Nunca deixar nenhum dos dois escrito direto no código do script — o trecho
no topo do script (`PROPRIEDADES.getProperty(...)`) falha alto e explica o
que falta se alguma das duas não estiver configurada.

## Reenvio / correção manual

Use a função `reenviarLinha(linha)` (ver script acima) para reenviar uma
linha específica — pelo editor do Apps Script, selecione `reenviarLinha` na
barra de funções e clique em Executar.

Reenviar a mesma linha (mesmo `ID`/`external_id`, que nunca muda) é sempre
seguro, quantas vezes for preciso: `ingerir_lead_formulario` atualiza os
dados, a atribuição e as respostas em vez de criar um lead duplicado (ver
comentário da função nas migrations `20261008100000_leads_multinicho.sql` e
`20261008120000_negociacoes_atribuicao.sql`) — nunca um segundo cliente,
nunca uma segunda negociação.

## Fora do escopo deste arquivo

- Não cobre como obter a URL real da Edge Function após o deploy
  (`npx supabase functions deploy ingestao-lead --no-verify-jwt`).
- Não cobre nichos futuros (Clínica, Ótica): cada um precisa da própria
  configuração (nicho + formulário + perguntas, dado de configuração, sem
  migration) antes de ter um script equivalente a este.
- Não cobre campanhas/Meta Ads: a planilha real de hoje não tem nenhuma
  coluna disso (ver seção de atribuição acima).
