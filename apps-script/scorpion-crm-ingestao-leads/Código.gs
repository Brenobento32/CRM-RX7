// ===========================================================================
// Scorpion CRM — Ingestão de Leads (projeto standalone do Apps Script).
// Fluxo documentado em docs/GOOGLE-APPS-SCRIPT-LEADS.md (este arquivo é a
// implementação standalone: usa SpreadsheetApp.openById em vez de um script
// vinculado à planilha, por isso não há getActiveSpreadsheet/getActiveSheet
// em lugar nenhum — não existe "planilha ativa" num projeto standalone).
//
// Duas entradas de lead neste projeto:
//   1. Trigger "Ao enviar formulário" (`aoReceberResposta`, seção de cima) —
//      só dispara pra envio nativo de Google Forms, por isso NUNCA disparou
//      pros leads do formulário real: ele é feito no Respondi, que só
//      escreve linhas na planilha (não é um "envio de formulário" do Sheets).
//   2. Webhook do Respondi (`doPost`, seção "Webhook Respondi" mais abaixo) —
//      a entrada real pra esses leads. Ainda NÃO publicado como Web App
//      nesta rodada; ver instruções de publicação perto de `doPost`.
//
// Instalar: colar este arquivo no editor do projeto "Scorpion CRM —
// Ingestão de Leads" (script.google.com, projeto standalone, NÃO vinculado
// à planilha). Antes de publicar o Web App, revisar com `testarConexao()`,
// `testarComparacaoConstante()`, `testarAutenticacaoWebhook()` e
// `testarParserRespondi()` — todos locais, nenhum envia rede.
// ===========================================================================

// ID real da planilha (Instituição de Ensino) — não é segredo, é só o
// identificador do arquivo; por isso pode ficar hardcoded aqui, diferente da
// URL da Edge Function e do segredo (esses dois nunca ficam no código, só em
// Propriedades do script — ver abaixo).
var PLANILHA_ID = '1gGum-PNO3aSMy1HduLW6Tx3hv5-Hcd26ow7SsHnFSo4'

// URL da Edge Function e os dois segredos — NUNCA escritos aqui no código
// (nem num repositório público, nem em nenhum log, nem em README/docs). Os
// três vivem só em Propriedades do script: Configurações do projeto →
// Propriedades do script → Adicionar propriedade. Lidos uma vez aqui (topo
// do arquivo é reavaliado a cada execução no Apps Script); a verificação de
// presença é feita só dentro das funções que realmente precisam enviar algo
// (ver `verificarPropriedades`), para que `testarConexao()` consiga rodar e
// reportar a ausência sem quebrar com um erro não tratado.
//
// Dois segredos DIFERENTES, nunca reaproveitados um pelo outro:
//   INGESTAO_LEAD_SECRET    Apps Script → Edge Function (já existia).
//   RESPONDI_WEBHOOK_TOKEN  Respondi → Apps Script (novo, só autentica o
//                           doPost; o Web App é público, então precisa de
//                           credencial própria — nunca a mesma que vai pra
//                           Edge Function, pra um comprometimento de um lado
//                           não comprometer o outro).
var PROPRIEDADES = PropertiesService.getScriptProperties()
var URL_INGESTAO = PROPRIEDADES.getProperty('INGESTAO_LEAD_URL')
var SEGREDO = PROPRIEDADES.getProperty('INGESTAO_LEAD_SECRET')
var RESPONDI_WEBHOOK_TOKEN = PROPRIEDADES.getProperty('RESPONDI_WEBHOOK_TOKEN')

var NICHO_SLUG = 'instituicao-ensino'
var FORMULARIO_SLUG = 'instituicao-ensino-captacao'

// Quantas tentativas no envio e intervalo base entre elas (ms). Só vale
// tentar de novo em falha transitória (rede, 429, 5xx) — reenviar o mesmo
// payload nunca duplica, porque a ingestão faz upsert por external_id.
var MAX_TENTATIVAS_ENVIO = 3
var ESPERA_BASE_MS = 1000

// Headers REAIS confirmados da planilha (ver docs/GOOGLE-APPS-SCRIPT-LEADS.md,
// seção "Headers reais da planilha"). `dados`/`pontuacao`/`data`/`id`: texto
// exato do header, usado tanto para achar a coluna quanto, quando for o
// caso, como o próprio valor enviado.
//
// `perguntas`: cada item tem `coluna` (como achar a célula: texto exato do
// header OU `{ posicao: N }` quando o texto do header não é conhecido com
// certeza — caso do header 8, mascarado pelo nome do criador do formulário)
// e `canonica` (o texto EXATO já cadastrado em `perguntas.texto` no banco,
// sempre enviado como `pergunta_externa` — nunca o header real, que pode ter
// grafia diferente da canônica, como a pergunta 2 abaixo).
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
      // Texto do header mascarado pelo nome do criador do formulário (não
      // confirmado byte a byte) — localiza pela posição: é a 8ª das 12
      // colunas reais (nome, telefone, email, empresa, instagram,
      // colaboradores, desafio, ESTA, alunos hoje, pontuação, data, id).
      // Revalide se a planilha for reorganizada.
      coluna: { posicao: 8 },
      canonica: 'Breno, qual é a sua meta de alunos na sua instituição de ensino?',
    },
    {
      coluna: 'E quantos alunos você tem atualmente?',
      canonica: 'E quantos alunos você tem atualmente?',
    },
  ],
  pontuacao: 'Pontuação',
  data: 'Data',
  id: 'ID',
}

// Nome de uma coluna de controle opcional, já existente na planilha, pra
// registrar sucesso/erro desta linha. Deixe '' se a planilha não tiver (ou
// não quiser) essa coluna — o script simplesmente não escreve nada.
var COLUNA_STATUS = 'Status CRM'

// ---------------------------------------------------------------------------
// Webhook do Respondi (nova entrada do CRM — ver seção "Webhook Respondi"
// mais abaixo). A integração Respondi → Google Sheets só adiciona linhas na
// planilha; não é um envio de Google Forms, então o trigger "Ao enviar
// formulário" (`aoReceberResposta`) nunca disparou pra esses leads. Por
// isso o Respondi chama o Apps Script direto, por HTTP (`doPost`), com o
// payload oficial dele — a planilha continua recebendo os leads normalmente,
// mas deixa de ser o gatilho do CRM.
//
// Mesmos títulos reais do formulário (iguais a MAPA_COLUNAS acima), mas
// agora usados pra achar a resposta dentro de `respondent.answers` do
// Respondi, por título normalizado (trim + minúsculas + espaços duplicados
// colapsados) — nunca por posição, porque o Respondi não garante ordem de
// colunas como a planilha. `canonica` continua sendo o texto EXATO já
// cadastrado em `perguntas.texto` no banco, sempre o que é enviado como
// `pergunta_externa`.
var MAPA_RESPOSTAS_RESPONDI = {
  dados: {
    nome: 'Qual seu nome e sobrenome?',
    telefone: 'Digite o número do seu WhatsApp para contato',
    email: 'Digite o seu melhor E-mail',
    empresa: 'Qual o nome da empresa?',
    instagram: 'Qual o Instagram da sua Instituição de Ensino?',
  },
  perguntas: [
    {
      titulo: 'Quantos colaboradores você possui?',
      canonica: 'Quantos colaboradores você possui?',
    },
    {
      // Mesma pegadinha de maiúscula/minúscula do fluxo da planilha — o
      // matching é normalizado, mas a canônica enviada mantém o "I"
      // maiúsculo, igual já está cadastrado no banco.
      titulo: 'Atualmente, qual é o maior desafio da sua instituição?',
      canonica: 'Atualmente, qual é o maior desafio da sua Instituição?',
    },
    {
      // No payload do Respondi o título vem completo (sem a máscara que
      // aparecia no header da planilha) — por isso aqui dá pra buscar pelo
      // título normalizado, sem precisar de posição.
      titulo: 'Breno, qual é a sua meta de alunos na sua instituição de ensino?',
      canonica: 'Breno, qual é a sua meta de alunos na sua instituição de ensino?',
    },
    {
      titulo: 'E quantos alunos você tem atualmente?',
      canonica: 'E quantos alunos você tem atualmente?',
    },
  ],
}

// Chaves aceitas dentro de `respondent.respondent_utms`: as 5 UTMs + gclid/
// fbclid, só se o Respondi mandar — nunca inventadas. Todas já aceitas pela
// Edge Function (ver CHAVES_ATRIBUICAO em supabase/functions/ingestao-lead).
var CHAVES_UTM_RESPONDI = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']

/** Falha alto e claro só quando a função que chama realmente for enviar algo. */
function verificarPropriedades() {
  if (!URL_INGESTAO || !SEGREDO) {
    throw new Error(
      'Configure INGESTAO_LEAD_URL e INGESTAO_LEAD_SECRET em Propriedades do script antes de usar.',
    )
  }
}

/** Projeto standalone: nunca getActiveSpreadsheet — sempre pelo ID real. */
function obterPlanilha() {
  return SpreadsheetApp.openById(PLANILHA_ID)
}

/**
 * A planilha pode ter mais de uma aba (ex.: respostas do formulário + outra
 * coisa) — acha a aba certa pelos headers conhecidos ("ID" e a pergunta do
 * nome), nunca por nome/posição de aba, que podem mudar.
 */
function obterAbaRespostas(planilha) {
  var abas = planilha.getSheets()
  for (var i = 0; i < abas.length; i++) {
    var ultimaColuna = abas[i].getLastColumn()
    if (ultimaColuna === 0) continue
    var cabecalho = abas[i].getRange(1, 1, 1, ultimaColuna).getValues()[0]
    if (cabecalho.indexOf(MAPA_COLUNAS.id) !== -1 && cabecalho.indexOf(MAPA_COLUNAS.dados.nome) !== -1) {
      return abas[i]
    }
  }
  throw new Error(
    'Nenhuma aba da planilha tem os headers esperados ("' + MAPA_COLUNAS.id + '" e "' + MAPA_COLUNAS.dados.nome + '").',
  )
}

/**
 * Handler do trigger instalável "Ao enviar formulário" (ver instalarTrigger).
 * `e.range` já aponta pra linha/aba reais da planilha — não precisa abrir
 * por ID aqui. Confere a origem só por segurança (evita processar evento de
 * outra planilha, se este projeto algum dia tiver mais de um trigger).
 */
function aoReceberResposta(e) {
  var aba = e.range.getSheet()
  if (aba.getParent().getId() !== PLANILHA_ID) return
  verificarPropriedades()
  processarLinha(aba, e.range.getRow())
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
  verificarPropriedades()
  var planilha = obterPlanilha()
  var aba = obterAbaRespostas(planilha)
  processarLinha(aba, linha)
}

/**
 * Lógica compartilhada entre o trigger automático (`aoReceberResposta`) e o
 * reenvio manual (`reenviarLinha`) — mesmo comportamento nos dois casos,
 * nunca duas implementações divergindo.
 */
function processarLinha(aba, linha) {
  var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
  var valores = aba.getRange(linha, 1, 1, aba.getLastColumn()).getValues()[0]

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
  // sheetId+linha.
  var externalId = valorDe(MAPA_COLUNAS.id)
  if (!externalId) {
    // Sem rede: não faz sentido chamar a Edge Function sem o identificador
    // de dedup. Nenhum dado do lead vai pro log — só o aviso técnico.
    marcarStatus(aba, linha, headers, 'erro: coluna "ID" vazia — lead não enviado')
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
  // preservados se vierem, exatamente como a célula entrega. Nenhuma
  // conversão de timezone é feita aqui, nenhuma é inventada.
  var pontuacao = valorDe(MAPA_COLUNAS.pontuacao)
  var dataFormulario = valorDe(MAPA_COLUNAS.data)

  // Sem `origem` — a Edge Function define origem=formulario.
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

  var resultado = enviarComRetry(payload)
  marcarStatus(aba, linha, headers, resultado.status)
}

/**
 * Envia o payload com retry seguro. Reenviar nunca duplica (upsert por
 * external_id), então só vale tentar de novo em falha transitória:
 * exceção de rede, 429 (rate limit) ou 5xx. Erros 4xx (exceto 429) são de
 * validação/autenticação — reenviar o mesmo payload não muda o resultado,
 * então não gasta tentativa.
 */
function enviarComRetry(payload) {
  var corpoJson = JSON.stringify(payload)

  for (var tentativa = 1; tentativa <= MAX_TENTATIVAS_ENVIO; tentativa++) {
    try {
      var resposta = UrlFetchApp.fetch(URL_INGESTAO, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-Webhook-Secret': SEGREDO },
        payload: corpoJson,
        muteHttpExceptions: true,
      })

      var codigo = resposta.getResponseCode()
      // DIAGNÓSTICO TEMPORÁRIO (remover depois de confirmar a causa das
      // execuções de 14:10:56 e 14:28:19) — só o código HTTP, nunca corpo da
      // resposta, payload, nome, telefone, email, respondent_id, token ou
      // URL. Logger.log não é visível nas Execuções já concluídas, então
      // também salvamos em Propriedades do script pra poder ler depois, sem
      // precisar reenviar o formulário.
      Logger.log('HTTP status da Edge Function: ' + codigo)
      PropertiesService.getScriptProperties().setProperty('ULTIMO_HTTP_INGESTAO', String(codigo))

      if (codigo >= 200 && codigo < 300) {
        return { status: 'ok' }
      }

      Logger.log('Edge Function rejeitou o lead: HTTP ' + codigo)

      var transitorio = codigo === 429 || codigo >= 500
      if (!transitorio || tentativa === MAX_TENTATIVAS_ENVIO) {
        return { status: 'erro ' + codigo + ': ' + resposta.getContentText() }
      }
    } catch (erroRede) {
      // Nunca relança: um erro não tratado faria o Apps Script tentar
      // reexecutar o trigger automaticamente mais tarde, reenviando a MESMA
      // linha sem controle — preferimos esgotar as tentativas aqui e
      // registrar o erro na própria planilha.
      if (tentativa === MAX_TENTATIVAS_ENVIO) {
        return { status: 'erro de rede (após ' + MAX_TENTATIVAS_ENVIO + ' tentativas): ' + erroRede.message }
      }
    }

    Utilities.sleep(ESPERA_BASE_MS * tentativa)
  }
}

/**
 * DIAGNÓSTICO TEMPORÁRIO — lê `ULTIMO_HTTP_INGESTAO` (salvo em
 * `enviarComRetry`, ver acima) e mostra/loga só o código HTTP, nunca corpo
 * da resposta, payload ou qualquer dado do lead. Rodar pelo editor (barra
 * de funções → `verUltimoStatusIngestao` → Executar) depois de uma
 * execução de `doPost` cujo Logger não ficou visível na tela de Execuções.
 * Remover junto com o resto da instrumentação temporária quando a causa
 * estiver confirmada.
 */
function verUltimoStatusIngestao() {
  var codigo = PropertiesService.getScriptProperties().getProperty('ULTIMO_HTTP_INGESTAO')
  var mensagem = codigo ? 'Último HTTP da Edge Function: ' + codigo : 'Nenhum status registrado.'
  Logger.log(mensagem)
  return mensagem
}

function marcarStatus(aba, linha, headers, texto) {
  if (!COLUNA_STATUS) return
  var indice = headers.indexOf(COLUNA_STATUS)
  if (indice === -1) return // coluna não existe — não cria nada sozinho na planilha do usuário.
  // Nunca grava dado do lead aqui — só código HTTP/erro técnico e a hora.
  aba.getRange(linha, indice + 1).setValue(texto + ' — ' + new Date().toISOString())
}

/**
 * Instala o trigger instalável "Ao enviar formulário" neste projeto
 * standalone, apontando pra planilha real (PLANILHA_ID). Idempotente: se já
 * existir um trigger com a mesma função/evento/origem, não cria outro —
 * só avisa. Não envia nenhum lead (não chama processarLinha nem
 * enviarComRetry).
 */
function instalarTrigger() {
  var existentes = ScriptApp.getProjectTriggers()
  for (var i = 0; i < existentes.length; i++) {
    var t = existentes[i]
    if (
      t.getHandlerFunction() === 'aoReceberResposta' &&
      t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT &&
      t.getTriggerSourceId() === PLANILHA_ID
    ) {
      Logger.log('Trigger já instalado (id: ' + t.getUniqueId() + ') — nada a fazer.')
      return
    }
  }

  var novo = ScriptApp.newTrigger('aoReceberResposta').forSpreadsheet(PLANILHA_ID).onFormSubmit().create()
  Logger.log('Trigger instalado (id: ' + novo.getUniqueId() + ').')
}

/** Lista os triggers deste projeto — nenhum dado sensível, só metadados. */
function listarTriggers() {
  var triggers = ScriptApp.getProjectTriggers()
  if (triggers.length === 0) {
    Logger.log('Nenhum trigger instalado neste projeto.')
    return
  }
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i]
    Logger.log(
      'id=' + t.getUniqueId() +
      ' funcao=' + t.getHandlerFunction() +
      ' evento=' + t.getEventType() +
      ' origem=' + t.getTriggerSourceId(),
    )
  }
}

/**
 * Diagnóstico sem efeito colateral: NÃO faz POST. Só confere se a planilha
 * está acessível, se a aba de respostas foi encontrada e se as três
 * propriedades do script estão presentes (nunca loga o valor delas — só se
 * existem ou não).
 */
function testarConexao() {
  var planilhaAcessivel = false
  var abaEncontrada = false

  try {
    var planilha = obterPlanilha()
    planilhaAcessivel = true
    try {
      obterAbaRespostas(planilha)
      abaEncontrada = true
    } catch (erroAba) {
      abaEncontrada = false
    }
  } catch (erroPlanilha) {
    planilhaAcessivel = false
  }

  var relatorio = {
    planilhaAcessivel: planilhaAcessivel,
    abaEncontrada: abaEncontrada,
    propriedadeUrlPresente: !!URL_INGESTAO,
    propriedadeSecretPresente: !!SEGREDO,
    propriedadeTokenRespondiPresente: !!RESPONDI_WEBHOOK_TOKEN,
  }

  Logger.log(
    'planilha acessível: ' + relatorio.planilhaAcessivel +
    ' | aba de respostas encontrada: ' + relatorio.abaEncontrada +
    ' | INGESTAO_LEAD_URL configurada: ' + relatorio.propriedadeUrlPresente +
    ' | INGESTAO_LEAD_SECRET configurado: ' + relatorio.propriedadeSecretPresente +
    ' | RESPONDI_WEBHOOK_TOKEN configurado: ' + relatorio.propriedadeTokenRespondiPresente,
  )

  return relatorio
}

/**
 * Pré-visualiza o mapeamento de uma linha SEM enviar nada (não chama
 * UrlFetchApp). Nunca loga nome/telefone/email/respostas — só presença
 * (true/false) e contagens, pra conferir o mapeamento sem expor dado de
 * lead no log. Útil pra validar colunas antes de confiar no trigger real.
 */
function testarLinha(linha) {
  var planilha = obterPlanilha()
  var aba = obterAbaRespostas(planilha)
  var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
  var valores = aba.getRange(linha, 1, 1, aba.getLastColumn()).getValues()[0]

  function celula(indice) {
    var valor = valores[indice]
    return valor === null || valor === undefined ? '' : String(valor).trim()
  }

  function valorDe(headerProcurado) {
    var indice = headers.indexOf(headerProcurado)
    return indice === -1 ? '' : celula(indice)
  }

  function valorDaColuna(coluna) {
    if (typeof coluna === 'string') return valorDe(coluna)
    return celula(coluna.posicao - 1)
  }

  var externalId = valorDe(MAPA_COLUNAS.id)
  var perguntasRespondidas = []
  for (var i = 0; i < MAPA_COLUNAS.perguntas.length; i++) {
    var resposta = valorDaColuna(MAPA_COLUNAS.perguntas[i].coluna)
    if (resposta !== '') perguntasRespondidas.push(MAPA_COLUNAS.perguntas[i].canonica)
  }

  Logger.log(
    'linha ' + linha +
    ' | external_id presente: ' + (externalId !== '') +
    ' | dados.nome presente: ' + (valorDe(MAPA_COLUNAS.dados.nome) !== '') +
    ' | dados.telefone presente: ' + (valorDe(MAPA_COLUNAS.dados.telefone) !== '') +
    ' | dados.email presente: ' + (valorDe(MAPA_COLUNAS.dados.email) !== '') +
    ' | dados.empresa presente: ' + (valorDe(MAPA_COLUNAS.dados.empresa) !== '') +
    ' | dados.instagram presente: ' + (valorDe(MAPA_COLUNAS.dados.instagram) !== '') +
    ' | pontuacao presente: ' + (valorDe(MAPA_COLUNAS.pontuacao) !== '') +
    ' | data presente: ' + (valorDe(MAPA_COLUNAS.data) !== '') +
    ' | perguntas mapeadas (' + perguntasRespondidas.length + '/' + MAPA_COLUNAS.perguntas.length + '): ' + perguntasRespondidas.join(' | '),
  )

  return {
    linha: linha,
    externalIdPresente: externalId !== '',
    perguntasMapeadas: perguntasRespondidas.length,
    totalPerguntas: MAPA_COLUNAS.perguntas.length,
  }
}

// ===========================================================================
// Webhook Respondi — nova entrada do CRM.
//
//   Respondi → Apps Script Web App (doPost) → Edge Function ingestao-lead → CRM
//
// A planilha continua recebendo os leads (integração própria do Respondi com
// o Google Sheets), mas deixa de ser o gatilho: o trigger `aoReceberResposta`
// nunca disparava pra esses leads porque quem escreve na planilha é o
// Respondi, não um envio nativo de Google Forms. O trigger antigo continua
// instalado por enquanto (ver nota antes de `instalarTrigger`) — só é
// removido depois que o webhook estiver comprovadamente funcionando.
// ===========================================================================

/** trim + minúsculas + espaços duplicados colapsados — nunca remove espaço sozinho (uniria palavras). */
function normalizar(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Comparação "tempo quase constante": percorre sempre o maior dos dois
 * comprimentos (nunca sai mais cedo por causa de diferença de tamanho) e
 * acumula a diferença bit a bit, em vez de um `===` direto que o V8 pode
 * decidir de forma antecipada. Pura (não lê Propriedades) — é o que deixa
 * isso testável com valores fictícios, sem precisar do segredo real.
 *
 * LIMITAÇÃO REGISTRADA (pedido explícito de não inventar biblioteca): o
 * Apps Script roda sobre V8, numa infra compartilhada do Google, sem
 * primitiva de comparação criptográfica constant-time nativa (diferente,
 * por exemplo, de `crypto.timingSafeEqual` do Node). Este laço reduz o
 * short-circuit óbvio de um `===`/`indexOf`, mas NÃO garante ausência de
 * side-channel de tempo em nível de rede/JIT — não é uma garantia
 * criptográfica forte, só uma mitigação razoável sem adicionar dependência
 * externa ao projeto.
 */
function compararConstante(esperado, recebido) {
  esperado = typeof esperado === 'string' ? esperado : ''
  recebido = typeof recebido === 'string' ? recebido : ''

  var tamanho = Math.max(esperado.length, recebido.length)
  var diferenca = esperado.length === recebido.length ? 0 : 1

  for (var i = 0; i < tamanho; i++) {
    var charEsperado = i < esperado.length ? esperado.charCodeAt(i) : 0
    var charRecebido = i < recebido.length ? recebido.charCodeAt(i) : 0
    diferenca |= charEsperado ^ charRecebido
  }

  return diferenca === 0
}

/**
 * Valida o token do webhook do Respondi contra RESPONDI_WEBHOOK_TOKEN.
 * Nunca loga o token recebido nem o configurado — só usado dentro de
 * `autenticarEValidarRespondi`, que também nunca loga.
 */
function tokenValido(recebido) {
  if (!RESPONDI_WEBHOOK_TOKEN) return false // sem propriedade configurada, nunca aceita nenhum token.
  return compararConstante(RESPONDI_WEBHOOK_TOKEN, recebido)
}

/**
 * Gera e salva RESPONDI_WEBHOOK_TOKEN diretamente em Propriedades do
 * script — elimina a necessidade de copiar/colar o token por fora do Apps
 * Script (ex.: área de transferência do Windows, que pode falhar). Rodar
 * pelo editor (barra de funções → `gerarTokenRespondi` → Executar).
 *
 * ROTAÇÃO: esta função SEMPRE gera um token novo e SOBRESCREVE o valor
 * atual em Propriedades do script, mesmo que já exista um configurado.
 * Isso é intencional — existe pra permitir invalidar rapidamente um token
 * comprometido (ex.: exposto em captura de tela) sem precisar apagar a
 * propriedade manualmente antes. Rodar esta função invalida IMEDIATAMENTE
 * qualquer token anterior: qualquer webhook do Respondi já configurado com
 * o valor antigo passa a ser rejeitado por `tokenValido()` até o Respondi
 * ser reconfigurado com o novo valor.
 *
 * Como gera o token: Apps Script não expõe um gerador de bytes aleatórios
 * direto (não existe equivalente a `crypto.randomBytes`). A única fonte de
 * aleatoriedade documentada é `Utilities.getUuid()` — um UUID v4, com 122
 * bits de entropia por chamada. Para chegar a 256 bits (pedido como
 * preferência, acima do mínimo de 128), combinamos 3 UUIDs independentes
 * (366 bits de entropia bruta) e condensamos num digest SHA-256 de 256 bits
 * via `Utilities.computeDigest` — API nativa do Apps Script (classe
 * `Utilities`), nunca uma biblioteca externa. A segurança efetiva do token
 * final é limitada por min(366, 256) = 256 bits.
 *
 * Nunca loga nem retorna o valor gerado — só confirma que foi configurado.
 */
function gerarTokenRespondi() {
  var entropiaBruta = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, entropiaBruta)
  var token = digest
    .map(function (byte) {
      var hex = (byte & 0xff).toString(16)
      return hex.length === 1 ? '0' + hex : hex
    })
    .join('')

  PROPRIEDADES.setProperty('RESPONDI_WEBHOOK_TOKEN', token)

  // Nunca logado, nunca retornado — só solta a referência local depois de
  // salvo (não existe "apagar da memória" garantido no V8, mas evita manter
  // a variável viva mais do que o necessário dentro desta execução).
  token = null
  entropiaBruta = null

  Logger.log('RESPONDI_WEBHOOK_TOKEN configurado.')
}

/**
 * Só confere se RESPONDI_WEBHOOK_TOKEN existe — nunca mostra o valor. Útil
 * pra validar depois de `gerarTokenRespondi()` sem precisar abrir a tela de
 * Propriedades do script.
 */
function verificarTokenRespondi() {
  var configurado = !!RESPONDI_WEBHOOK_TOKEN
  Logger.log('RESPONDI_WEBHOOK_TOKEN configurado: ' + configurado)
  return configurado
}

/**
 * Extrai um valor primitivo de uma resposta do Respondi. A estrutura oficial
 * documentada traz `answers` como texto simples por título; esta função só
 * cobre defensivamente o caso de vir embrulhado em `{ value: ... }` (comum
 * em outras integrações de webhook) — nunca inventa um campo novo, só lê
 * `.value` se existir.
 */
function valorDaResposta(valor) {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'object') {
    if (Array.isArray(valor)) {
      return valor
        .map(valorDaResposta)
        .filter(function (v) {
          return v !== ''
        })
        .join(', ')
    }
    if ('value' in valor) return valorDaResposta(valor.value)
    return ''
  }
  return String(valor).trim()
}

/** Acha a resposta em `answers` pelo título, comparando normalizado (case/espaço-insensível). */
function obterRespostaPorTitulo(answers, tituloProcurado) {
  if (!answers || typeof answers !== 'object') return ''
  var alvo = normalizar(tituloProcurado)
  var chaves = Object.keys(answers)
  for (var i = 0; i < chaves.length; i++) {
    if (normalizar(chaves[i]) === alvo) return valorDaResposta(answers[chaves[i]])
  }
  return ''
}

/**
 * Transforma o payload oficial do Respondi no payload interno que a Edge
 * Function `ingestao-lead` já espera (ver supabase/functions/ingestao-lead) —
 * a Edge Function NÃO foi alterada nesta rodada. Lança erro e para se faltar
 * alguma chave necessária; as mensagens de erro nunca incluem valor de
 * nome/telefone/email, só o nome do campo que faltou.
 */
function construirPayloadDoRespondi(corpoRespondi) {
  if (!corpoRespondi || typeof corpoRespondi !== 'object') {
    throw new Error('Payload do Respondi inválido: corpo vazio ou não é um objeto.')
  }

  var respondent = corpoRespondi.respondent
  if (!respondent || typeof respondent !== 'object') {
    throw new Error('Payload do Respondi inválido: falta "respondent".')
  }

  var externalId = valorDaResposta(respondent.respondent_id)
  if (!externalId) {
    throw new Error('Payload do Respondi inválido: falta "respondent.respondent_id".')
  }

  var answers = respondent.answers
  if (!answers || typeof answers !== 'object') {
    throw new Error('Payload do Respondi inválido: falta "respondent.answers".')
  }

  var nome = obterRespostaPorTitulo(answers, MAPA_RESPOSTAS_RESPONDI.dados.nome)
  if (!nome) {
    throw new Error('Payload do Respondi inválido: resposta de nome não encontrada em "respondent.answers".')
  }

  var respostas = []
  for (var i = 0; i < MAPA_RESPOSTAS_RESPONDI.perguntas.length; i++) {
    var item = MAPA_RESPOSTAS_RESPONDI.perguntas[i]
    var resposta = obterRespostaPorTitulo(answers, item.titulo)
    // Resposta vazia nunca gera uma resposta falsa — simplesmente não entra no payload.
    if (resposta !== '') respostas.push({ pergunta_externa: item.canonica, resposta: resposta })
  }

  var utmsRecebidos =
    respondent.respondent_utms && typeof respondent.respondent_utms === 'object' ? respondent.respondent_utms : {}

  // Pontuação e data: dados nativos do Respondi, nunca transformados —
  // `score` nunca é convertido em temperatura, `date` nunca tem timezone
  // reinterpretado e nunca substitui negociacoes.created_at (preenchido
  // pelo banco no INSERT).
  var pontuacao = valorDaResposta(respondent.score)
  var dataFormulario = valorDaResposta(respondent.date)

  var atribuicao = {}
  if (pontuacao) atribuicao.pontuacao = pontuacao
  if (dataFormulario) atribuicao.data_formulario = dataFormulario

  for (var j = 0; j < CHAVES_UTM_RESPONDI.length; j++) {
    var chaveUtm = CHAVES_UTM_RESPONDI[j]
    var valorUtm = valorDaResposta(utmsRecebidos[chaveUtm])
    if (valorUtm) atribuicao[chaveUtm] = valorUtm
  }

  // Preservados só se vierem, nunca inventados. `respondent_id`/`form_id`/
  // `form_name` estão em CHAVES_ATRIBUICAO na Edge Function
  // (supabase/functions/ingestao-lead/index.ts), então chegam até o banco
  // dentro de negociacoes.atribuicao (JSONB, sem precisar de migration).
  if (externalId) atribuicao.respondent_id = externalId
  var formId = corpoRespondi.form ? valorDaResposta(corpoRespondi.form.form_id) : ''
  if (formId) atribuicao.form_id = formId
  var formName = corpoRespondi.form ? valorDaResposta(corpoRespondi.form.form_name) : ''
  if (formName) atribuicao.form_name = formName

  var payload = {
    external_id: externalId,
    formulario_slug: FORMULARIO_SLUG,
    nicho_slug: NICHO_SLUG,
    dados: {
      nome: nome,
      telefone: obterRespostaPorTitulo(answers, MAPA_RESPOSTAS_RESPONDI.dados.telefone),
      email: obterRespostaPorTitulo(answers, MAPA_RESPOSTAS_RESPONDI.dados.email),
      empresa: obterRespostaPorTitulo(answers, MAPA_RESPOSTAS_RESPONDI.dados.empresa),
      instagram: obterRespostaPorTitulo(answers, MAPA_RESPOSTAS_RESPONDI.dados.instagram),
    },
    respostas: respostas,
  }
  if (Object.keys(atribuicao).length > 0) payload.atribuicao = atribuicao

  return payload
}

/**
 * Autentica e valida uma chamada do webhook, SEM nunca chamar UrlFetchApp —
 * por isso é pura/testável (ver `testarAutenticacaoWebhook`), e é nela que
 * `doPost` decide se chega a enviar algo pra Edge Function. Nunca loga nada
 * (quem loga é `processarRespondi`, que decide o que é seguro logar) e
 * nunca olha `e.queryString`/`e.parameter` como um todo — só o campo
 * específico `e.parameter.token` (que é exatamente onde o token mora; não
 * existe outro lugar no evento que precise ser lido aqui).
 *
 * Motivos possíveis em `motivo`: 'sem_evento', 'token_invalido', 'sem_corpo',
 * 'json_invalido', 'payload_invalido', 'valido'. O chamador (`processarRespondi`)
 * sempre responde `{ ok: false }` pra qualquer motivo diferente de 'valido' —
 * a API pública nunca distingue QUAL motivo foi, pra não dar pista pra quem
 * está tentando adivinhar o token (token ausente e token incorreto resultam
 * exatamente na mesma resposta HTTP).
 */
function autenticarEValidarRespondi(e) {
  if (!e) return { ok: false, motivo: 'sem_evento', payload: null, erro: null }

  var tokenRecebido = e.parameter && typeof e.parameter.token === 'string' ? e.parameter.token : ''
  if (!tokenValido(tokenRecebido)) {
    return { ok: false, motivo: 'token_invalido', payload: null, erro: null }
  }

  if (!e.postData || !e.postData.contents) {
    return { ok: false, motivo: 'sem_corpo', payload: null, erro: null }
  }

  var corpoBruto
  try {
    corpoBruto = JSON.parse(e.postData.contents)
  } catch (erroJson) {
    return { ok: false, motivo: 'json_invalido', payload: null, erro: null }
  }

  try {
    var payload = construirPayloadDoRespondi(corpoBruto)
    return { ok: true, motivo: 'valido', payload: payload, erro: null }
  } catch (erroMapeamento) {
    return { ok: false, motivo: 'payload_invalido', payload: null, erro: erroMapeamento.message }
  }
}

/**
 * Lógica compartilhada por `doPost`: autentica/valida/transforma (via
 * `autenticarEValidarRespondi`, sem rede) e só então envia pra Edge
 * Function. Separada do `doPost` só pra ficar testável sem precisar de um
 * `e` real do Apps Script. Nunca loga nome/telefone/email/token/secret/
 * payload completo/URL completa (a URL do Web App, quando chamada com
 * `?token=...`, contém o token — por isso nunca logamos `e` nem nada
 * derivado da URL, só os campos específicos abaixo).
 */
function processarRespondi(e) {
  try {
    var resultado = autenticarEValidarRespondi(e)
    if (!resultado.ok) {
      if (resultado.motivo === 'token_invalido') {
        // Nunca diferencia "ausente" de "incorreto" no log (nem na
        // resposta) — e nunca loga o valor recebido.
        Logger.log('doPost: autenticação do webhook falhou.')
      } else if (resultado.erro) {
        // Mensagem de `construirPayloadDoRespondi`: por construção, só cita
        // nome de campo faltante, nunca valor de dado do lead.
        Logger.log('doPost: payload do Respondi inválido — ' + resultado.erro)
      } else {
        Logger.log('doPost: ' + resultado.motivo)
      }
      return { ok: false }
    }

    verificarPropriedades()
    var resultadoEnvio = enviarComRetry(resultado.payload)
    if (resultadoEnvio.status !== 'ok') {
      // Só o código, nunca o corpo completo da resposta de erro no log
      // (a Edge Function nunca ecoa PII nos erros, mas mantemos o log do
      // Apps Script enxuto mesmo assim).
      Logger.log('doPost: falha ao enviar pra Edge Function — ' + resultadoEnvio.status.split(':')[0])
      return { ok: false }
    }

    return { ok: true }
  } catch (erroInesperado) {
    Logger.log('doPost: erro inesperado — ' + erroInesperado.message)
    return { ok: false }
  }
}

/**
 * Entrada HTTP do Web App. Exige `?token=...` (query string) batendo com
 * RESPONDI_WEBHOOK_TOKEN — configurar essa URL completa (com o token) como
 * webhook no Respondi é o único lugar onde o token aparece por fora deste
 * script; nunca aparece em log. Publicar como Web App (Executar como: Eu;
 * Quem tem acesso: qualquer pessoa) é um passo manual separado — ver
 * instruções no final, ainda NÃO publicado nesta rodada.
 *
 * Limitações da plataforma (registradas, não contornadas por invenção):
 * 1. Um Web App do Apps Script sempre responde HTTP 200 na camada de
 *    transporte (não dá pra setar outro status via ContentService) — por
 *    isso o "erro apropriado" fica só no corpo JSON (`{ ok: false }`).
 * 2. Comparação do token é "tempo quase constante" (ver `compararConstante`),
 *    não uma garantia criptográfica forte — Apps Script não expõe primitiva
 *    de comparação constant-time nativa.
 */
function doPost(e) {
  var resultado = processarRespondi(e)
  return ContentService.createTextOutput(JSON.stringify({ ok: resultado.ok })).setMimeType(ContentService.MimeType.JSON)
}

/**
 * Monta um payload de exemplo do Respondi (dado fictício, nunca um lead
 * real) — reaproveitado por `testarParserRespondi` e
 * `testarAutenticacaoWebhook`, pra não ter dois exemplos divergindo.
 * `opcoes.comUtms === false` omite `respondent_utms` (cenário G: UTMs
 * ausentes). `opcoes.respondentId` troca o `respondent_id` (útil pra
 * variar o `external_id` em diferentes chamadas de teste).
 */
function exemploPayloadRespondi(opcoes) {
  opcoes = opcoes || {}
  return {
    form: {
      form_name: 'Instituição de Ensino — Captação',
      form_id: 'exemplo-form-id',
    },
    respondent: {
      date: '2026-10-09T12:00:00-03:00',
      respondent_id: opcoes.respondentId || 'exemplo-respondent-id-123',
      score: '80',
      status: 'completed',
      respondent_utms:
        opcoes.comUtms === false
          ? {}
          : {
              utm_source: 'meta',
              utm_medium: 'cpc',
              utm_campaign: 'captacao-outubro',
              utm_term: 'instituicao-ensino',
              utm_content: 'criativo-1',
              gclid: 'gclid-exemplo-123',
              fbclid: 'fbclid-exemplo-456',
            },
      answers: {
        'Qual seu nome e sobrenome?': 'Lead de Teste',
        'Digite o número do seu WhatsApp para contato': '11999999999',
        'Digite o seu melhor E-mail': 'lead.teste@example.com',
        'Qual o nome da empresa?': 'Escola Exemplo',
        'Qual o Instagram da sua Instituição de Ensino?': '@escolaexemplo',
        'Quantos colaboradores você possui?': '11 a 50',
        'Atualmente, qual é o maior desafio da sua instituição?': 'Captação de alunos',
        'Breno, qual é a sua meta de alunos na sua instituição de ensino?': '500 alunos',
        'E quantos alunos você tem atualmente?': '320 alunos',
      },
      raw_answers: [],
    },
  }
}

/**
 * Teste LOCAL do parser — NUNCA chama UrlFetchApp (não envia nada, nem pra
 * Edge Function nem pra produção). Cobre: D) payload válido; E) payload
 * inválido; F) UTMs presentes; G) UTMs ausentes (nunca inventa valor); H)
 * gclid/fbclid presentes; I) respondent_id; J) form_id; K) form_name.
 * Mesma regra de log das outras funções de teste: nunca Logger.log nome/
 * telefone/email/payload completo — só presença, contagens e booleans.
 */
function testarParserRespondi() {
  var resultados = []

  // D) payload válido + F) UTMs presentes + H) gclid/fbclid + I/J/K
  var comUtms = construirPayloadDoRespondi(exemploPayloadRespondi())
  var chavesUtmPresentes = CHAVES_UTM_RESPONDI.filter(function (chave) {
    return comUtms.atribuicao && !!comUtms.atribuicao[chave]
  }).length

  resultados.push(
    'D) payload válido | external_id correto: ' + (comUtms.external_id === 'exemplo-respondent-id-123') +
      ' | nome presente: ' + !!comUtms.dados.nome +
      ' | telefone presente: ' + !!comUtms.dados.telefone +
      ' | email presente: ' + !!comUtms.dados.email +
      ' | empresa presente: ' + !!comUtms.dados.empresa +
      ' | instagram presente: ' + !!comUtms.dados.instagram +
      ' | respostas mapeadas: ' + comUtms.respostas.length + '/' + MAPA_RESPOSTAS_RESPONDI.perguntas.length +
      ' | pontuacao presente: ' + !!(comUtms.atribuicao && comUtms.atribuicao.pontuacao) +
      ' | data presente: ' + !!(comUtms.atribuicao && comUtms.atribuicao.data_formulario),
  )
  resultados.push(
    'F+H) utms+gclid+fbclid presentes: ' + chavesUtmPresentes + '/' + CHAVES_UTM_RESPONDI.length +
      ' | I) respondent_id em atribuicao: ' + !!(comUtms.atribuicao && comUtms.atribuicao.respondent_id) +
      ' | J) form_id em atribuicao: ' + !!(comUtms.atribuicao && comUtms.atribuicao.form_id) +
      ' | K) form_name em atribuicao: ' + !!(comUtms.atribuicao && comUtms.atribuicao.form_name),
  )

  // G) UTMs ausentes — nunca inventa valor pras 7 chaves (5 UTMs + gclid/fbclid)
  var semUtms = construirPayloadDoRespondi(exemploPayloadRespondi({ comUtms: false }))
  var nenhumaChaveUtmInventada = CHAVES_UTM_RESPONDI.every(function (chave) {
    return !semUtms.atribuicao || !semUtms.atribuicao[chave]
  })
  resultados.push('G) payload sem UTMs | nenhuma chave de utm/gclid/fbclid inventada: ' + nenhumaChaveUtmInventada)

  // E) payload inválido — sem resposta de nome em "answers"
  try {
    construirPayloadDoRespondi({ respondent: { respondent_id: 'exemplo-invalido', answers: {} } })
    resultados.push('E) payload inválido (sem nome): FALHOU — deveria ter lançado erro')
  } catch (erroEsperado) {
    resultados.push('E) payload inválido (sem nome): OK — rejeitado com "' + erroEsperado.message + '"')
  }

  for (var i = 0; i < resultados.length; i++) Logger.log(resultados[i])

  // Retornado só pra inspeção manual no editor (painel de execução) — nunca
  // Logger.log isso direto: mesmo sendo dado fictício aqui, a regra de não
  // logar payload completo vale sempre, pra não criar o hábito.
  return { comUtms: comUtms, semUtms: semUtms }
}

/**
 * Teste LOCAL e puro da comparação constant-time — nunca lê
 * RESPONDI_WEBHOOK_TOKEN nem qualquer segredo real, só valores fictícios,
 * então pode logar os próprios valores de teste sem risco (não são
 * segredos, são literais do teste).
 */
function testarComparacaoConstante() {
  var casos = [
    { esperado: 'abc123', recebido: 'abc123', esperadoResultado: true, descricao: 'iguais' },
    { esperado: 'abc123', recebido: 'abc124', esperadoResultado: false, descricao: 'mesmo tamanho, 1 char diferente' },
    { esperado: 'abc123', recebido: 'abc12', esperadoResultado: false, descricao: 'recebido mais curto' },
    { esperado: 'abc123', recebido: 'abc1234', esperadoResultado: false, descricao: 'recebido mais longo' },
    { esperado: 'abc123', recebido: '', esperadoResultado: false, descricao: 'recebido vazio' },
    // compararConstante é um comparador genérico: duas strings vazias SÃO
    // iguais. A regra "nunca aceitar token vazio" não é dela — é de
    // `tokenValido`, que recusa de cara quando RESPONDI_WEBHOOK_TOKEN não
    // está configurado (string vazia), antes de chegar aqui.
    { esperado: '', recebido: '', esperadoResultado: true, descricao: 'ambos vazios (comparador genérico — tokenValido recusa isso separadamente)' },
  ]

  var resultados = []
  for (var i = 0; i < casos.length; i++) {
    var caso = casos[i]
    var resultado = compararConstante(caso.esperado, caso.recebido)
    var passou = resultado === caso.esperadoResultado
    resultados.push(
      caso.descricao + ': ' + (passou ? 'OK' : 'FALHOU (esperado ' + caso.esperadoResultado + ', obtido ' + resultado + ')'),
    )
  }

  for (var j = 0; j < resultados.length; j++) Logger.log(resultados[j])
  return resultados
}

/**
 * Teste LOCAL da autenticação + validação do webhook — chama só
 * `autenticarEValidarRespondi` (nunca `processarRespondi`/`doPost`), que por
 * construção NUNCA chama UrlFetchApp. Cobre: A) token ausente; B) token
 * incorreto; C) token correto (combinado com D, payload válido); E) payload
 * inválido com token correto. Lê RESPONDI_WEBHOOK_TOKEN só para montar o
 * cenário "token correto" com o valor já configurado — nunca loga esse
 * valor, nunca o hardcoda.
 */
function testarAutenticacaoWebhook() {
  var resultados = []
  var corpoValido = JSON.stringify(exemploPayloadRespondi())

  function verificar(descricao, eSimulado, motivoEsperado) {
    var resultado = autenticarEValidarRespondi(eSimulado)
    var passou = resultado.motivo === motivoEsperado
    resultados.push(descricao + ': ' + (passou ? 'OK' : 'FALHOU (motivo=' + resultado.motivo + ')'))
  }

  // A) token ausente
  verificar('A) token ausente', { parameter: {}, postData: { contents: corpoValido } }, 'token_invalido')

  // B) token incorreto
  verificar(
    'B) token incorreto',
    { parameter: { token: 'token-de-teste-incorreto' }, postData: { contents: corpoValido } },
    'token_invalido',
  )

  if (RESPONDI_WEBHOOK_TOKEN) {
    // C) token correto + D) payload válido
    verificar(
      'C+D) token correto, payload válido',
      { parameter: { token: RESPONDI_WEBHOOK_TOKEN }, postData: { contents: corpoValido } },
      'valido',
    )

    // E) token correto, payload inválido
    var corpoInvalido = JSON.stringify({ respondent: { respondent_id: 'exemplo-invalido', answers: {} } })
    verificar(
      'E) token correto, payload inválido',
      { parameter: { token: RESPONDI_WEBHOOK_TOKEN }, postData: { contents: corpoInvalido } },
      'payload_invalido',
    )
  } else {
    resultados.push(
      'C/D/E) PULADO — RESPONDI_WEBHOOK_TOKEN ainda não configurado em Propriedades do script.',
    )
  }

  for (var i = 0; i < resultados.length; i++) Logger.log(resultados[i])
  return resultados
}
