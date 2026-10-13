/**
 * Importação histórica de leads do Respondi (CSV exportado da plataforma,
 * nicho "Instituição de Ensino") — preparação, sem gravar nada no banco.
 *
 * O script NUNCA escreve no banco por si só:
 *   1. Modo padrão: lê o CSV e mostra a análise (dry run). Não toca disco
 *      nem rede.
 *   2. `--gerar-sql-verificacao <arquivo.sql>`: escreve um SELECT (só
 *      leitura) que lista quais `external_id` deste CSV já existem em
 *      `negociacoes`. Rode-o você mesmo:
 *        npx supabase db query --linked -f <arquivo.sql>
 *      e salve a saída (uma coluna `external_id`) num arquivo de texto.
 *   3. `--existentes <arquivo.txt>`: reusa esse arquivo (um external_id por
 *      linha) para classificar cada linha do CSV em novo/atualizaria, sem
 *      nenhuma consulta ao banco nesta execução.
 *   4. `--sql <arquivo.sql> [--simular]`: escreve o SQL de importação de
 *      verdade — um bloco `do $importacao$ ... end $importacao$` que chama
 *      `public.ingerir_lead_formulario` (a MESMA função que o webhook já
 *      usa) uma vez por linha válida. Escrever este arquivo não importa
 *      nada; a importação só aconteceria se alguém rodasse
 *      `npx supabase db query --linked -f <arquivo.sql>` à parte — o que
 *      este script nunca faz por conta própria. Com `--simular`, o bloco
 *      termina em `raise exception`, então mesmo rodando o SQL gerado nada
 *      fica gravado (mesmo padrão de scripts/importar-planilha.mts).
 *
 * MAPEAMENTO DE COLUNAS E LÓGICA DE QUALIFICAÇÃO SÃO UM ESPELHO DELIBERADO
 * de supabase/functions/ingestao-lead/index.ts (`MAPA_DADOS_RESPONDI`,
 * `PERGUNTA_COLABORADORES`/`PERGUNTA_DESAFIO`/`PERGUNTA_META_ALUNOS`/
 * `SUFIXO_META_ALUNOS`/`PERGUNTA_ALUNOS_ATUALMENTE`, `CHAVES_UTM_RESPONDI`,
 * normalização de telefone). Qualquer mudança lá precisa ser replicada
 * aqui — e vice-versa — pra nunca ter duas fontes de verdade divergentes
 * sobre quais perguntas existem e como casam com o texto cadastrado em
 * `perguntas.texto`. As 4 perguntas de qualificação são independentes entre
 * si (confirmado por leitura real do banco em 2026-10-13: `perguntas` tem 4
 * linhas ativas, ordem 1000/2000/3000/4000) — nenhuma é tratada como
 * variante de outra.
 *
 * `COLUNA_ID` = `respondent_id`: confirmado manualmente em 2026-10-13 (o
 * respondent_id de um lead real, visto no painel do Respondi, bate com o
 * valor da coluna `ID` na mesma linha do CSV). Não é mais suposição.
 *
 * Uso:
 *   node scripts/importar-respondi.mts <arquivo.csv>
 *   node scripts/importar-respondi.mts <arquivo.csv> --gerar-sql-verificacao scripts/.saida/verificar.sql
 *   node scripts/importar-respondi.mts <arquivo.csv> --existentes scripts/.saida/existentes.txt
 *   node scripts/importar-respondi.mts <arquivo.csv> --sql scripts/.saida/importacao-respondi.sql [--simular]
 *
 * Sem dependências externas: CSV lido à mão (RFC4180 simplificado).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// ---------------------------------------------------------------------------
// Constantes de negócio — formulário/nicho fixos (o único hoje para o
// Respondi, ver `construirPayloadDoRespondi` na Edge Function) e a coluna
// usada como identificador externo/idempotente (confirmado = respondent_id, ver topo do arquivo).
// ---------------------------------------------------------------------------
const FORMULARIO_SLUG = 'instituicao-ensino-captacao'
const NICHO_SLUG = 'instituicao-ensino'
/** Nome da coluna tratada como respondent_id/external_id — confirmado manualmente, ver topo do arquivo. */
const COLUNA_ID = 'ID'

// ---------------------------------------------------------------------------
// CSV — parser mínimo (aspas, campo com delimitador/quebra de linha dentro,
// "" como aspas escapada). Delimitador detectado pela 1ª linha (vírgula ou
// ponto-e-vírgula) — exportações de planilha em pt-BR costumam usar `;`.
// ---------------------------------------------------------------------------
export function detectarDelimitador(texto: string): string {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? ''
  const semAspas = primeiraLinha.replace(/"[^"]*"/g, '')
  const virgulas = semAspas.split(',').length - 1
  const pontoEVirgulas = semAspas.split(';').length - 1
  return pontoEVirgulas > virgulas ? ';' : ','
}

export function parseCsv(texto: string): string[][] {
  const delimitador = detectarDelimitador(texto)
  const linhas: string[][] = []
  let campo = ''
  let linha: string[] = []
  let dentroAspas = false

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]

    if (dentroAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          dentroAspas = false
        }
      } else {
        campo += ch
      }
      continue
    }

    if (ch === '"') {
      dentroAspas = true
    } else if (ch === delimitador) {
      linha.push(campo)
      campo = ''
    } else if (ch === '\r') {
      continue
    } else if (ch === '\n') {
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ''
    } else {
      campo += ch
    }
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo)
    linhas.push(linha)
  }

  // Remove linhas 100% vazias (ex.: linha final em branco do arquivo).
  return linhas.filter((l) => l.some((c) => c.trim() !== ''))
}

/** trim + minúsculo + espaços colapsados + `_`/`-` tratados como espaço — acha "UTM Source" e "utm_source" com a mesma chave. */
function normalizarCabecalho(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Índice da coluna cujo header bate com QUALQUER um dos títulos candidatos (ordem de preferência). */
function buscarColuna(headers: string[], candidatos: readonly string[]): number {
  const normalizados = candidatos.map(normalizarCabecalho)
  return headers.findIndex((h) => normalizados.includes(normalizarCabecalho(h)))
}

/** Índice da coluna cujo header TERMINA com o sufixo dado — pra headers com prefixo variável (nome/placeholder). */
function buscarColunaPorSufixo(headers: string[], sufixo: string): number {
  const alvo = normalizarCabecalho(sufixo)
  return headers.findIndex((h) => normalizarCabecalho(h).endsWith(alvo))
}

function texto(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

function buscarValorPorTitulo(headers: string[], celulas: string[], titulo: string): string | null {
  const idx = buscarColuna(headers, [titulo])
  return idx === -1 ? null : texto(celulas[idx])
}

// ---------------------------------------------------------------------------
// Mapeamento — espelho de MAPA_DADOS_RESPONDI / MAPA_PERGUNTAS_RESPONDI /
// CHAVES_UTM_RESPONDI em supabase/functions/ingestao-lead/index.ts.
// ---------------------------------------------------------------------------
const COLUNAS_DADOS = [
  { titulos: ['Qual seu nome e sobrenome?'], campo: 'nome' as const },
  { titulos: ['Digite o número do seu WhatsApp para contato'], campo: 'telefone' as const },
  { titulos: ['Digite o seu melhor E-mail'], campo: 'email' as const },
  { titulos: ['Qual o nome da empresa?'], campo: 'empresa' as const },
  { titulos: ['Qual o Instagram da sua Instituição de Ensino?'], campo: 'instagram' as const },
]

const PERGUNTA_COLABORADORES = 'Quantos colaboradores você possui?'
const PERGUNTA_DESAFIO = 'Atualmente, qual é o maior desafio da sua Instituição?'
/** Texto EXATO já cadastrado em `perguntas.texto` — enviado como `pergunta_externa`, nunca o header da coluna. */
const CANONICA_META_ALUNOS = 'Breno, qual é a sua meta de alunos na sua instituição de ensino?'
/**
 * No CSV real exportado em 13/10/2026 esse header chegou como
 * `"___, qual é a sua meta de alunos na sua instituição de ensino?"` — um
 * placeholder de nome não resolvido pelo Respondi, não "Breno" como a Edge
 * Function assume para o payload do webhook (ver pendência documentada lá:
 * "texto exato do header 8"). Por isso a coluna é localizada pelo SUFIXO da
 * pergunta (tudo depois da primeira vírgula), não pelo texto completo —
 * funciona com "___," ou com qualquer nome, sem adivinhar qual.
 */
const SUFIXO_META_ALUNOS = ', qual é a sua meta de alunos na sua instituição de ensino?'
const TITULO_ATUALMENTE = 'E quantos alunos você tem atualmente?'

const COLUNAS_UTM = [
  { titulos: ['utm_source', 'UTM Source'], chave: 'utm_source' as const },
  { titulos: ['utm_medium', 'UTM Medium'], chave: 'utm_medium' as const },
  { titulos: ['utm_campaign', 'UTM Campaign'], chave: 'utm_campaign' as const },
  { titulos: ['utm_term', 'UTM Term'], chave: 'utm_term' as const },
  { titulos: ['utm_content', 'UTM Content'], chave: 'utm_content' as const },
  { titulos: ['gclid', 'GCLID'], chave: 'gclid' as const },
  { titulos: ['fbclid', 'FBCLID'], chave: 'fbclid' as const },
]

type Atribuicao = Partial<Record<(typeof COLUNAS_UTM)[number]['chave'] | 'pontuacao' | 'data_formulario' | 'respondent_id', string>>

export type LinhaValida = {
  linha: number
  externalId: string
  nome: string
  telefone: string | null
  email: string | null
  empresa: string | null
  instagram: string | null
  respostas: { pergunta_externa: string; resposta: string }[]
  atribuicao: Atribuicao
}

export type LinhaInvalida = { linha: number; motivos: string[] }

export type ResultadoLinha = { ok: true; dado: LinhaValida } | { ok: false; dado: LinhaInvalida }

/** Mesma normalização usada hoje no webhook (`replace(/\D/g, '')`) — nunca adiciona/remove DDI. */
export function normalizarTelefone(v: string | null): string | null {
  if (!v) return null
  const limpo = v.replace(/\D/g, '')
  return limpo === '' ? null : limpo
}

/**
 * Uma linha do CSV → payload (mesmo formato que `ingerir_lead_formulario`
 * espera). Validação mínima mirror da Edge Function + da própria função SQL:
 * `external_id` e `nome` obrigatórios; pelo menos telefone OU e-mail.
 */
export function processarLinha(headers: string[], celulas: string[], numeroLinha: number): ResultadoLinha {
  const motivos: string[] = []

  const idxId = buscarColuna(headers, [COLUNA_ID])
  const externalId = idxId === -1 ? null : texto(celulas[idxId])
  if (!externalId) motivos.push(`coluna "${COLUNA_ID}" vazia ou não encontrada`)

  const dados: Record<string, string | null> = {}
  for (const { titulos, campo } of COLUNAS_DADOS) {
    const idx = buscarColuna(headers, titulos)
    dados[campo] = idx === -1 ? null : texto(celulas[idx])
  }

  if (!dados.nome) motivos.push('sem nome')

  const telefone = normalizarTelefone(dados.telefone ?? null)
  const email = dados.email ?? null
  if (!telefone && !email) motivos.push('sem telefone e sem e-mail (pelo menos um é obrigatório)')

  if (motivos.length > 0) {
    return { ok: false, dado: { linha: numeroLinha, motivos } }
  }

  const respostas: { pergunta_externa: string; resposta: string }[] = []

  const colaboradores = buscarValorPorTitulo(headers, celulas, PERGUNTA_COLABORADORES)
  if (colaboradores) respostas.push({ pergunta_externa: PERGUNTA_COLABORADORES, resposta: colaboradores })

  const desafio = buscarValorPorTitulo(headers, celulas, PERGUNTA_DESAFIO)
  if (desafio) respostas.push({ pergunta_externa: PERGUNTA_DESAFIO, resposta: desafio })

  // Pergunta 3 — "meta de alunos" (por título exato OU pelo sufixo, ver
  // SUFIXO_META_ALUNOS).
  const idxMetaExata = buscarColuna(headers, [CANONICA_META_ALUNOS])
  const idxMeta = idxMetaExata !== -1 ? idxMetaExata : buscarColunaPorSufixo(headers, SUFIXO_META_ALUNOS)
  const meta = idxMeta === -1 ? null : texto(celulas[idxMeta])
  if (meta) respostas.push({ pergunta_externa: CANONICA_META_ALUNOS, resposta: meta })

  // Pergunta 4 — independente da pergunta 3, nunca sua variante (bug
  // corrigido em 2026-10-13: as duas eram mescladas numa só, descartando a
  // resposta desta sempre que a pergunta 3 também viesse preenchida — o que
  // acontecia em 18/20 linhas do CSV real, com valores diferentes em 17).
  const atualmente = buscarValorPorTitulo(headers, celulas, TITULO_ATUALMENTE)
  if (atualmente) respostas.push({ pergunta_externa: TITULO_ATUALMENTE, resposta: atualmente })

  const atribuicao: Atribuicao = {}
  const pontuacao = buscarValorPorTitulo(headers, celulas, 'Pontuação')
  if (pontuacao) atribuicao.pontuacao = pontuacao

  const dataFormulario = buscarValorPorTitulo(headers, celulas, 'Data')
  if (dataFormulario) atribuicao.data_formulario = dataFormulario

  // respondent_id = coluna ID (confirmado manualmente, ver topo do arquivo).
  atribuicao.respondent_id = externalId as string

  for (const { titulos, chave } of COLUNAS_UTM) {
    const idx = buscarColuna(headers, titulos)
    const valor = idx === -1 ? null : texto(celulas[idx])
    if (valor) atribuicao[chave] = valor
  }

  return {
    ok: true,
    dado: {
      linha: numeroLinha,
      externalId: externalId as string,
      nome: dados.nome as string,
      telefone,
      email,
      empresa: dados.empresa ?? null,
      instagram: dados.instagram ?? null,
      respostas,
      atribuicao,
    },
  }
}

/** "teste"/"test" em nome/e-mail/empresa — heurística simples, nunca decide sozinha, só sinaliza para revisão humana. */
export function pareceTeste(l: LinhaValida): boolean {
  const alvo = `${l.nome} ${l.email ?? ''} ${l.empresa ?? ''}`.toLowerCase()
  return /\bteste\b|\btest\b/.test(alvo)
}

/** "João Teste" → "J*** T*****" — nunca o nome completo em claro no relatório. */
export function mascarar(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .map((p) => p[0] + '*'.repeat(Math.max(p.length - 1, 1)))
    .join(' ')
}

// ---------------------------------------------------------------------------
// Relatório (dry run) — nunca grava nada, só console.log.
// ---------------------------------------------------------------------------
function relatar(caminho: string, headers: string[], linhasDados: string[][], existentes: Set<string> | null) {
  const resultados = linhasDados.map((celulas, i) => processarLinha(headers, celulas, i + 2))
  const validas = resultados.flatMap((r) => (r.ok ? [r.dado] : []))
  const invalidas = resultados.flatMap((r) => (r.ok ? [] : [r.dado]))

  const contagemIds = new Map<string, number[]>()
  for (const v of validas) {
    contagemIds.set(v.externalId, [...(contagemIds.get(v.externalId) ?? []), v.linha])
  }
  const duplicados = [...contagemIds.entries()].filter(([, linhas]) => linhas.length > 1)

  const possiveisTestes = validas.filter(pareceTeste)

  console.log(`\nArquivo: ${caminho}`)
  console.log(`Delimitador detectado: "${detectarDelimitador(readFileSync(caminho, 'utf8'))}"`)
  console.log(`Colunas no cabeçalho: ${headers.length}`)
  console.log(`Total de linhas de dados: ${linhasDados.length}`)
  console.log(`Linhas válidas: ${validas.length}`)
  console.log(`Linhas incompletas: ${invalidas.length}`)

  if (invalidas.length > 0) {
    console.log('\nLinhas incompletas (sem PII, só o motivo):')
    for (const i of invalidas) console.log(`  linha ${i.linha}: ${i.motivos.join('; ')}`)
  }

  console.log(`\nIDs (${COLUNA_ID}) duplicados dentro do arquivo: ${duplicados.length}`)
  for (const [id, linhas] of duplicados) {
    console.log(`  "${id}" aparece nas linhas ${linhas.join(', ')} — só a última seria mantida (upsert por external_id).`)
  }

  console.log(`\nPossíveis testes (nome/e-mail/empresa contém "teste"/"test"): ${possiveisTestes.length}`)
  for (const t of possiveisTestes) console.log(`  linha ${t.linha}: ${mascarar(t.nome)} (mascarado)`)

  const comQualificacao = validas.filter((v) => v.respostas.length > 0)
  console.log(`\nLinhas com ao menos 1 resposta de qualificação: ${comQualificacao.length}`)
  const comAtribuicao = validas.filter((v) => Object.keys(v.atribuicao).length > 1) // > 1 porque respondent_id sempre entra
  console.log(`Linhas com algum dado de campanha/UTM: ${comAtribuicao.length}`)

  if (existentes) {
    const novos = validas.filter((v) => !existentes.has(v.externalId))
    const jaExistem = validas.filter((v) => existentes.has(v.externalId))
    console.log(`\nComparado com o banco (arquivo de existentes fornecido):`)
    console.log(`  já existem no CRM (seriam ATUALIZADOS, nunca duplicados): ${jaExistem.length}`)
    console.log(`  seriam NOVOS (cliente + negociação criados): ${novos.length}`)
  } else {
    console.log(
      `\nQuantos já existem no CRM / seriam novos / atualizados: NÃO VERIFICADO.\n` +
        `  Gere a consulta com --gerar-sql-verificacao <arquivo.sql>, rode-a você mesmo\n` +
        `  (npx supabase db query --linked -f <arquivo.sql>) e reaproveite a saída com\n` +
        `  --existentes <arquivo.txt> para completar esta contagem sem este script tocar o banco.`,
    )
  }

  return { validas, invalidas, duplicados }
}

// ---------------------------------------------------------------------------
// Geração de SQL — nunca executado por este script.
// ---------------------------------------------------------------------------
function lit(v: string | null): string {
  if (v === null) return 'null'
  if (v.includes('$importacao$') || v.includes('$verificacao$')) {
    throw new Error(`Texto com delimitador reservado: ${v}`)
  }
  return `'${v.replace(/'/g, "''")}'`
}

function litJsonb(v: unknown): string {
  return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
}

function gerarSqlVerificacao(validas: LinhaValida[]): string {
  const ids = validas.map((v) => lit(v.externalId)).join(', ')
  return `-- ===========================================================================
-- Verificação (SÓ LEITURA) de quais external_id deste CSV já existem no CRM.
-- Gerado por scripts/importar-respondi.mts em ${new Date().toISOString()}
-- Rodar com: npx supabase db query --linked -f <este arquivo>
-- Depois: salve a coluna "external_id" da saída num arquivo de texto (um id
-- por linha) e reaproveite com --existentes <arquivo.txt>.
-- ===========================================================================
select n.external_id
from public.negociacoes n
where n.origem = 'formulario'
  and n.external_id in (${ids});
`
}

function gerarSqlImportacao(validas: LinhaValida[], simular: boolean): string {
  const partes: string[] = []
  partes.push(`-- ===========================================================================
-- Importação histórica de leads do Respondi (${validas.length} linhas válidas).
-- Gerado por scripts/importar-respondi.mts em ${new Date().toISOString()}
-- ${simular ? 'MODO SIMULAÇÃO: roda tudo e desfaz no final (raise exception).' : 'Executar com: npx supabase db query --linked -f <este arquivo>'}
--
-- Idempotente: cada linha chama public.ingerir_lead_formulario, a MESMA
-- função que o webhook do Respondi já usa — o dedup por (origem, external_id)
-- é feito inteiramente DENTRO dela (nunca duplica cliente nem negociação,
-- mesmo rodando este arquivo mais de uma vez).
-- ===========================================================================
do $importacao$
declare
  v_cliente_id    uuid;
  v_negociacao_id uuid;
  v_criado        boolean;
  v_criados       int := 0;
  v_atualizados   int := 0;
begin
`)

  for (const v of validas) {
    partes.push(`
  -- Linha ${v.linha} (external_id ${lit(v.externalId)})
  begin
    select cliente_id, negociacao_id, criado into v_cliente_id, v_negociacao_id, v_criado
    from public.ingerir_lead_formulario(
      p_external_id     := ${lit(v.externalId)},
      p_formulario_slug := ${lit(FORMULARIO_SLUG)},
      p_nicho_slug      := ${lit(NICHO_SLUG)},
      p_nome            := ${lit(v.nome)},
      p_telefone        := ${lit(v.telefone)},
      p_email           := ${lit(v.email)},
      p_empresa         := ${lit(v.empresa)},
      p_instagram       := ${lit(v.instagram)},
      p_respostas       := ${litJsonb(v.respostas)},
      p_atribuicao      := ${litJsonb(v.atribuicao)}
    );
    if v_criado then v_criados := v_criados + 1; else v_atualizados := v_atualizados + 1; end if;
  exception when others then
    raise exception 'Falha na linha ${v.linha} (sem expor PII): %', sqlerrm;
  end;`)
  }

  partes.push(
    simular
      ? `

  raise exception 'SIMULAÇÃO OK: % criados, % atualizados. Nada foi gravado.', v_criados, v_atualizados;
end
$importacao$;
`
      : `

  raise notice 'Importação concluída: % criados, % atualizados.', v_criados, v_atualizados;
end
$importacao$;
`,
  )
  return partes.join('')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function principal() {
  const caminho = process.argv[2]
  if (!caminho || caminho.startsWith('--')) {
    console.error(
      'Uso: node scripts/importar-respondi.mts <arquivo.csv> ' +
        '[--gerar-sql-verificacao <arquivo.sql>] [--existentes <arquivo.txt>] ' +
        '[--sql <arquivo.sql> [--simular]]',
    )
    process.exit(1)
  }

  const texto = readFileSync(caminho, 'utf8')
  const linhas = parseCsv(texto)
  if (linhas.length === 0) {
    console.error('Arquivo vazio ou ilegível.')
    process.exit(1)
  }
  const [headers, ...linhasDados] = linhas

  const arquivoExistentes = argumento('--existentes')
  const existentes = arquivoExistentes
    ? new Set(
        readFileSync(arquivoExistentes, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      )
    : null

  const { validas } = relatar(caminho, headers, linhasDados, existentes)

  const somenteReais = process.argv.includes('--somente-reais')
  const selecionadas = somenteReais ? validas.filter((v) => !pareceTeste(v)) : validas
  if (somenteReais) {
    console.log(`\n--somente-reais: ${validas.length - selecionadas.length} possível(is) teste(s) excluído(s) da geração de SQL. Restam ${selecionadas.length}.`)
  }

  const saidaVerificacao = argumento('--gerar-sql-verificacao')
  if (saidaVerificacao) {
    mkdirSync(dirname(saidaVerificacao), { recursive: true })
    writeFileSync(saidaVerificacao, gerarSqlVerificacao(selecionadas), 'utf8')
    console.log(`\nSQL de verificação (só leitura) gerado em ${saidaVerificacao}. Nada foi consultado ainda.`)
    console.log(`Rode você mesmo: npx supabase db query --linked -f ${saidaVerificacao}`)
  }

  const saidaSql = argumento('--sql')
  if (saidaSql) {
    const simular = process.argv.includes('--simular')
    mkdirSync(dirname(saidaSql), { recursive: true })
    writeFileSync(saidaSql, gerarSqlImportacao(selecionadas, simular), 'utf8')
    console.log(`\nSQL de importação ${simular ? '(SIMULAÇÃO) ' : ''}gerado em ${saidaSql}. Nada foi gravado no banco.`)
    console.log(`Revise e, só quando decidir importar de fato, execute: npx supabase db query --linked -f ${saidaSql}`)
  }
}

// Só executa o CLI quando chamado diretamente (`node scripts/importar-respondi.mts ...`),
// nunca quando importado pelos testes (`import { ... } from './importar-respondi.mts'`).
if (process.argv[1] && process.argv[1].endsWith('importar-respondi.mts')) {
  principal()
}
