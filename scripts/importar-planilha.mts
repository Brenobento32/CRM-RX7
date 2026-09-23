/**
 * OBSOLETO — já executado (importação da carteira inicial, set/2026).
 * O SQL que ele gera usa a coluna `negociacoes.etapa` (enum), removida na
 * Fase 8B em favor de `etapa_id` → `etapas_funil`. Não rode de novo sem
 * adaptar a geração do SQL.
 *
 * Migração única da planilha "Atendimento Clientes - Scorpion.xlsx" para o CRM.
 *
 * O script NUNCA grava no banco. Ele:
 *   1. lê a planilha e mostra a análise (linhas, mapeamento, problemas);
 *   2. com --dono e --sql, gera um arquivo SQL para revisão.
 * A importação acontece só quando esse SQL é executado, à parte:
 *   npx supabase db query --linked -f <arquivo.sql>
 *
 * Uso:
 *   node scripts/importar-planilha.mts <planilha.xlsx>
 *   node scripts/importar-planilha.mts <planilha.xlsx> --dono <email ou uuid> --sql scripts/.saida/importacao.sql
 *   ... --simular   (gera um SQL que valida tudo no banco e desfaz no final)
 *
 * Mapeamento completo e decisões: docs/IMPORTACAO-PLANILHA.md
 *
 * Sem dependências: o .xlsx é um zip de XMLs, lido com node:zlib.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

// ---------------------------------------------------------------------------
// Leitura do .xlsx
// ---------------------------------------------------------------------------

/** Extrai os arquivos de um zip (só "stored" e "deflate", o que o Excel usa). */
function lerZip(buffer: Buffer): Map<string, Buffer> {
  let fimDiretorio = -1
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      fimDiretorio = i
      break
    }
  }
  if (fimDiretorio < 0) throw new Error('Arquivo não é um .xlsx válido (zip sem diretório central).')

  const total = buffer.readUInt16LE(fimDiretorio + 10)
  let p = buffer.readUInt32LE(fimDiretorio + 16)
  const arquivos = new Map<string, Buffer>()

  for (let n = 0; n < total; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Zip corrompido.')
    const metodo = buffer.readUInt16LE(p + 10)
    const tamanhoComprimido = buffer.readUInt32LE(p + 20)
    const tamNome = buffer.readUInt16LE(p + 28)
    const tamExtra = buffer.readUInt16LE(p + 30)
    const tamComentario = buffer.readUInt16LE(p + 32)
    const offsetLocal = buffer.readUInt32LE(p + 42)
    const nome = buffer.toString('utf8', p + 46, p + 46 + tamNome)

    const inicioDados =
      offsetLocal + 30 + buffer.readUInt16LE(offsetLocal + 26) + buffer.readUInt16LE(offsetLocal + 28)
    const dados = buffer.subarray(inicioDados, inicioDados + tamanhoComprimido)
    if (metodo === 0) arquivos.set(nome, dados)
    else if (metodo === 8) arquivos.set(nome, inflateRawSync(dados))

    p += 46 + tamNome + tamExtra + tamComentario
  }
  return arquivos
}

function decodificarXml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function textosDe(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodificarXml(m[1])).join('')
}

type Celula = string | number | { data: string } | null

/** Número de série do Excel (sistema 1900) → AAAA-MM-DD. */
function serialParaData(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function indiceColuna(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  return [...letras].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

/** Primeira aba da planilha como matriz [linha da planilha, células]. */
function lerPrimeiraAba(caminho: string): { aba: string; linhas: [number, Celula[]][] } {
  const zip = lerZip(readFileSync(caminho))
  const texto = (nome: string) => zip.get(nome)?.toString('utf8') ?? ''

  const workbook = texto('xl/workbook.xml')
  if (/date1904="(1|true)"/.test(workbook)) {
    throw new Error('Planilha usa o sistema de datas 1904; ajuste serialParaData antes de importar.')
  }
  const primeira = /<sheet\s[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/.exec(workbook)
  if (!primeira) throw new Error('Nenhuma aba encontrada.')
  const [, aba, rid] = primeira
  const rels = texto('xl/_rels/workbook.xml.rels')
  const alvo = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1]
  if (!alvo) throw new Error('Aba sem arquivo correspondente.')
  const caminhoAba = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`

  const compartilhadas = [...texto('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    textosDe(m[1]),
  )

  // Estilos de data: formatos embutidos 14–22 e 45–47, ou personalizados com d/m/y.
  const estilos = texto('xl/styles.xml')
  const formatos = new Map(
    [...estilos.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [
      Number(m[1]),
      decodificarXml(m[2]),
    ]),
  )
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilos)?.[1] ?? ''
  const estiloEhData = [...cellXfs.matchAll(/<xf\s([^>]*)/g)].map((m) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0)
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true
    const codigo = formatos.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, '') ?? ''
    return /[dmy]/i.test(codigo)
  })

  const linhas: [number, Celula[]][] = []
  for (const linha of texto(caminhoAba).matchAll(/<row\s[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas: Celula[] = []
    for (const c of linha[2].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]
      if (!ref) continue
      const tipo = /\st="([^"]+)"/.exec(` ${attrs}`)?.[1]
      const estilo = Number(/\ss="(\d+)"/.exec(` ${attrs}`)?.[1] ?? -1)
      const corpo = c[2] ?? ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1]

      let valor: Celula = null
      if (tipo === 's' && v !== undefined) valor = compartilhadas[Number(v)] ?? null
      else if (tipo === 'inlineStr') valor = textosDe(corpo)
      else if (tipo === 'str' || tipo === 'e') valor = v === undefined ? null : decodificarXml(v)
      else if (tipo === 'b') valor = v === '1' ? 'VERDADEIRO' : 'FALSO'
      else if (v !== undefined) {
        const numero = Number(v)
        valor = estiloEhData[estilo] ? { data: serialParaData(numero) } : numero
      }
      celulas[indiceColuna(ref)] = valor
    }
    linhas.push([Number(linha[1]), celulas])
  }
  return { aba, linhas }
}

// ---------------------------------------------------------------------------
// Mapeamento
// ---------------------------------------------------------------------------

/** Cabeçalho normalizado: sem acento, minúsculo, sem º/°. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const COLUNAS = {
  nome: 'nome do cliente',
  responsavel: 'responsavel',
  primeiraReuniao: '1 reuniao',
  status1: 'status 1',
  reuniaoProposta: 'reuniao de proposta',
  statusProposta: 'status da proposta',
  termometro: 'termometro',
  valor: 'valor da proposta',
  tempoProposta: 'tempo da proposta',
  proximoContato: 'proximo contato',
  follow1: 'follow 1',
  follow2: 'follow 2',
  follow3: 'follow 3',
  objecao: 'objecao',
} as const

type Chave = keyof typeof COLUNAS

type Etapa = 'reuniao_agendada' | 'reuniao_realizada' | 'proposta_enviada'
type Temperatura = 'quente' | 'morno' | 'frio'

type Evento = {
  titulo: string
  tipo: 'reuniao' | 'apresentacao'
  status: 'agendado' | 'realizado'
  dia: string
  horaInicio: string
  horaFim: string
}

type Atividade = { tipo: 'reuniao' | 'nota'; descricao: string; dia: string; hora: string }

type Registro = {
  linha: number
  cliente: { nome: string; responsavel: string | null }
  negociacao: {
    titulo: string | null
    etapa: Etapa
    temperatura: Temperatura | null
    valorEstimado: number | null
    dataPrimeiraReuniao: string | null
    dataProposta: string | null
    objecao: string | null
    /** Dia em que a negociação entrou na etapa atual (aproximado pela planilha). */
    desde: string | null
  }
  eventos: Evento[]
  atividades: Atividade[]
  proximoContato: string | null
}

type Aviso = { linha: number | null; texto: string }

const HORA_1A_REUNIAO = ['10:00', '11:00'] as const
const HORA_REUNIAO_PROPOSTA = ['14:00', '15:00'] as const

function texto(c: Celula | undefined): string | null {
  if (c === null || c === undefined) return null
  if (typeof c === 'object') return c.data
  const s = String(c).trim()
  return s === '' ? null : s
}

function data(c: Celula | undefined): string | null {
  return c && typeof c === 'object' ? c.data : null
}

function mapear(
  linhas: [number, Celula[]][],
  hoje: string,
): { registros: Registro[]; avisos: Aviso[]; comDados: number; ignoradas: number } {
  const avisos: Aviso[] = []
  const [, cabecalho] = linhas[0] ?? [0, []]
  const indice = {} as Record<Chave, number>
  for (const [chave, rotulo] of Object.entries(COLUNAS) as [Chave, string][]) {
    const i = cabecalho.findIndex((c) => typeof c === 'string' && normalizar(c) === rotulo)
    if (i < 0) throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho.`)
    indice[chave] = i
  }

  avisos.push({
    linha: null,
    texto:
      'A planilha não tem telefone, WhatsApp nem e-mail: os clientes entram sem contato, e o ' +
      'formulário do CRM vai pedir um ao editar cada um.',
  })

  const conhecidas = new Set(Object.values(indice))
  cabecalho.forEach((c, i) => {
    if (texto(c) && !conhecidas.has(i)) {
      avisos.push({ linha: null, texto: `Coluna "${c}" não faz parte do mapeamento e será ignorada.` })
    }
  })

  const registros: Registro[] = []
  let ignoradas = 0
  let comDados = 0
  const nomesVistos = new Map<string, number>()

  for (const [linha, celulas] of linhas.slice(1)) {
    const col = (k: Chave) => celulas[indice[k]]
    if (!celulas.some((c) => texto(c))) {
      ignoradas++
      continue
    }
    comDados++

    const aviso = (t: string) => avisos.push({ linha, texto: t })
    const nome = texto(col('nome'))
    if (!nome) {
      aviso('Sem "Nome do Cliente" — linha não será importada.')
      continue
    }
    const chaveNome = nome.toLowerCase()
    if (nomesVistos.has(chaveNome)) {
      aviso(`Nome repetido (também na linha ${nomesVistos.get(chaveNome)}) — linha não será importada.`)
      continue
    }
    nomesVistos.set(chaveNome, linha)

    for (const [k, rotulo] of [
      ['primeiraReuniao', '1° reunião'],
      ['reuniaoProposta', 'Reunião de Proposta'],
      ['proximoContato', 'Próximo Contato'],
    ] as const) {
      const c = col(k)
      if (texto(c) && !data(c)) aviso(`"${rotulo}" não é uma data (${texto(c)}) — ignorada.`)
    }

    const status1 = texto(col('status1'))
    const statusProposta = texto(col('statusProposta'))
    const primeiraReuniao = data(col('primeiraReuniao'))
    const reuniaoProposta = data(col('reuniaoProposta'))
    const proximoContato = data(col('proximoContato'))

    // --- Etapa -------------------------------------------------------------
    const reuniaoFeita = normalizar(status1 ?? '') === 'feita'
    let etapa: Etapa = reuniaoFeita ? 'reuniao_realizada' : 'reuniao_agendada'
    let dataProposta: string | null = null
    const sp = normalizar(statusProposta ?? '')

    if (status1 && !['feita', 'agendada'].includes(normalizar(status1))) {
      aviso(`"Status 1" com valor desconhecido: "${status1}".`)
    }
    if (sp === 'feita') {
      etapa = 'proposta_enviada'
      dataProposta = reuniaoProposta
      if (!reuniaoProposta) aviso('Proposta "Feita" sem data da Reunião de Proposta.')
    } else if (statusProposta && !['agendada', 'aguardando'].includes(sp)) {
      aviso(`"Status da Proposta" com valor desconhecido: "${statusProposta}".`)
    }
    if (!statusProposta) aviso('Sem "Status da Proposta" — fica em Reunião realizada.')

    if (dataProposta && primeiraReuniao && dataProposta < primeiraReuniao) {
      aviso('Reunião de Proposta anterior à 1ª reunião — data da proposta descartada.')
      dataProposta = null
    }

    // --- Temperatura e valor -----------------------------------------------
    const termometro = normalizar(texto(col('termometro')) ?? '')
    const temperatura = (['quente', 'morno', 'frio'] as const).find((t) => t === termometro) ?? null
    if (termometro && !temperatura) aviso(`"Termometro" desconhecido: "${texto(col('termometro'))}".`)

    const bruto = col('valor')
    let valorEstimado: number | null = null
    if (typeof bruto === 'number') valorEstimado = Math.round(bruto * 100) / 100
    else if (texto(bruto)) aviso(`"Valor da Proposta" não numérico: "${texto(bruto)}" — ignorado.`)
    if (valorEstimado !== null && valorEstimado < 0) {
      aviso('Valor da Proposta negativo — ignorado.')
      valorEstimado = null
    }
    if (valorEstimado === null) aviso('Sem "Valor da Proposta".')

    const tempoProposta = texto(col('tempoProposta'))

    // --- Eventos e atividades ----------------------------------------------
    const eventos: Evento[] = []
    const atividades: Atividade[] = []

    if (primeiraReuniao) {
      eventos.push({
        titulo: '1ª reunião',
        tipo: 'reuniao',
        status: reuniaoFeita ? 'realizado' : 'agendado',
        dia: primeiraReuniao,
        horaInicio: HORA_1A_REUNIAO[0],
        horaFim: HORA_1A_REUNIAO[1],
      })
      if (reuniaoFeita) {
        atividades.push({
          tipo: 'reuniao',
          descricao: 'Realizado: 1ª reunião',
          dia: primeiraReuniao,
          hora: HORA_1A_REUNIAO[0],
        })
      }
    } else {
      aviso('Sem data da 1ª reunião.')
    }

    if (reuniaoProposta && (sp === 'feita' || sp === 'agendada')) {
      const feita = sp === 'feita'
      eventos.push({
        titulo: 'Reunião de proposta',
        tipo: 'apresentacao',
        status: feita ? 'realizado' : 'agendado',
        dia: reuniaoProposta,
        horaInicio: HORA_REUNIAO_PROPOSTA[0],
        horaFim: HORA_REUNIAO_PROPOSTA[1],
      })
      if (feita) {
        atividades.push({
          tipo: 'reuniao',
          descricao: 'Realizado: Reunião de proposta',
          dia: reuniaoProposta,
          hora: HORA_REUNIAO_PROPOSTA[0],
        })
      } else if (reuniaoProposta < hoje) {
        aviso(
          `Reunião de proposta "Agendada" para ${reuniaoProposta}, que já passou — entra na agenda como "aguardando status".`,
        )
      }
    } else if (reuniaoProposta) {
      aviso(`Reunião de Proposta com data mas status "${statusProposta ?? 'vazio'}" — data ignorada.`)
    }

    // Follows não têm data: vão para o último dia conhecido de reunião.
    const ultimoDia = [primeiraReuniao, dataProposta].filter(Boolean).sort().at(-1) ?? null
    ;(['follow1', 'follow2', 'follow3'] as const).forEach((k, i) => {
      const valor = texto(col(k))
      if (!valor) return
      if (!ultimoDia) {
        aviso(`Follow ${i + 1} sem nenhuma data de referência — ignorado.`)
        return
      }
      const resultado = normalizar(valor) === 'feito' ? 'feito' : valor.toLowerCase()
      atividades.push({
        tipo: 'nota',
        descricao: `Follow-up ${i + 1}: ${resultado} (importado da planilha, sem data original)`,
        dia: ultimoDia,
        hora: `18:0${i}`,
      })
    })

    if (proximoContato && proximoContato < hoje) {
      aviso(`Próximo contato em ${proximoContato}, que já passou — entra como próxima ação atrasada.`)
    }

    const objecao = texto(col('objecao'))
    const responsavel = texto(col('responsavel'))
    if (responsavel && /\([^)]*$/.test(responsavel)) {
      aviso(`"Responsavel" parece cortado: "${responsavel}".`)
    }

    registros.push({
      linha,
      cliente: { nome, responsavel },
      negociacao: {
        titulo: tempoProposta ? `Proposta · ${tempoProposta}` : null,
        etapa,
        temperatura,
        valorEstimado,
        dataPrimeiraReuniao: primeiraReuniao,
        dataProposta,
        objecao,
        desde:
          etapa === 'proposta_enviada' ? dataProposta : etapa === 'reuniao_realizada' ? primeiraReuniao : null,
      },
      eventos,
      atividades,
      proximoContato,
    })
  }

  return { registros, avisos, comDados, ignoradas }
}

// ---------------------------------------------------------------------------
// Geração do SQL
// ---------------------------------------------------------------------------

/** `--dono` aceita o e-mail ou o UUID do usuário. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function lit(v: string | number | null): string {
  if (v === null) return 'null'
  if (typeof v === 'number') return String(v)
  // O bloco usa o delimitador $importacao$; um texto que o contenha fecharia o bloco.
  if (v.includes('$importacao$')) throw new Error(`Texto com delimitador reservado: ${v}`)
  return `'${v.replace(/'/g, "''")}'`
}

/** "dia às hora" no horário de São Paulo, resolvido pelo Postgres. */
function instante(dia: string, hora: string): string {
  return `(${lit(`${dia} ${hora}`)}::timestamp at time zone 'America/Sao_Paulo')`
}

function gerarSql(
  registros: Registro[],
  dono: string,
  origem: string,
  simular: boolean,
): string {
  const nomes = registros.map((r) => lit(r.cliente.nome.toLowerCase())).join(', ')
  const partes: string[] = []

  partes.push(`-- ===========================================================================
-- Importação da planilha "${origem.replace(/[\r\n]/g, ' ')}"
-- Gerado por scripts/importar-planilha.mts em ${new Date().toISOString()}
-- ${registros.length} clientes, dono da carteira: ${dono}
-- ${simular ? 'MODO SIMULAÇÃO: valida tudo contra o banco e desfaz no final.' : 'Executar com: npx supabase db query --linked -f <este arquivo>'}
--
-- Tudo roda num único bloco: ou importa tudo, ou nada.
-- ===========================================================================
do $importacao$
declare
  v_dono     uuid;
  v_cliente  uuid;
  v_neg      uuid;
  v_repetidos text;
begin
  select id into v_dono
  from public.profiles
  where ${UUID.test(dono) ? `id = ${lit(dono)}::uuid` : `lower(email) = lower(${lit(dono)})`}
    and ativo;

  if v_dono is null then
    raise exception 'Dono % não encontrado ou inativo em profiles.', ${lit(dono)};
  end if;

  -- Proteção contra rodar duas vezes: nenhum destes nomes pode existir.
  select string_agg(nome, ', ') into v_repetidos
  from public.clientes
  where deleted_at is null and lower(nome) in (${nomes});

  if v_repetidos is not null then
    raise exception 'Importação abortada: já existem clientes com estes nomes: %', v_repetidos;
  end if;
`)

  registros.forEach((r, i) => {
    const n = r.negociacao
    const criadoEm = n.dataPrimeiraReuniao ? instante(n.dataPrimeiraReuniao, '09:00') : 'now()'
    const desde = n.desde ? instante(n.desde, '09:00') : 'now()'

    partes.push(`
  -- Linha ${r.linha}: ${r.cliente.nome.replace(/[\r\n]/g, ' ')}
  insert into public.clientes
    (tipo_cliente, nome, empresa, responsavel, observacoes, owner_id, created_at)
  values
    ('empresa', ${lit(r.cliente.nome)}, ${lit(r.cliente.nome)}, ${lit(r.cliente.responsavel)},
     ${lit(`Importado da planilha "Atendimento Clientes - Scorpion", linha ${r.linha}.`)}, v_dono, ${criadoEm})
  returning id into v_cliente;

  insert into public.negociacoes
    (cliente_id, owner_id, titulo, etapa, posicao, valor_estimado, temperatura,
     data_primeira_reuniao, data_proposta, objecao_principal, data_entrada_etapa, created_at)
  values
    (v_cliente, v_dono, ${lit(n.titulo)}, ${lit(n.etapa)}, ${(i + 1) * 1000}, ${lit(n.valorEstimado)},
     ${n.temperatura ? lit(n.temperatura) : 'null'}, ${lit(n.dataPrimeiraReuniao)}, ${lit(n.dataProposta)},
     ${lit(n.objecao)}, ${desde}, ${criadoEm})
  returning id into v_neg;

  -- O histórico nasce com a data da importação; ajusta para a data da planilha.
  update public.historico_etapas set created_at = ${desde} where negociacao_id = v_neg;`)

    for (const e of r.eventos) {
      partes.push(`
  insert into public.eventos (titulo, tipo, status, inicio, fim, cliente_id, negociacao_id, usuario_id)
  values (${lit(e.titulo)}, ${lit(e.tipo)}, ${lit(e.status)}, ${instante(e.dia, e.horaInicio)},
          ${instante(e.dia, e.horaFim)}, v_cliente, v_neg, v_dono);`)
    }
    for (const a of r.atividades) {
      partes.push(`
  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, data, usuario_id)
  values (v_cliente, v_neg, ${lit(a.tipo)}, ${lit(a.descricao)}, ${instante(a.dia, a.hora)}, v_dono);`)
    }
    if (r.proximoContato) {
      partes.push(`
  insert into public.proximas_acoes (cliente_id, negociacao_id, titulo, data, usuario_id)
  values (v_cliente, v_neg, 'Próximo contato', ${lit(r.proximoContato)}, v_dono);`)
    }
  })

  partes.push(
    simular
      ? `

  raise exception 'SIMULAÇÃO OK: % clientes seriam importados. Nada foi gravado.', ${registros.length};
end
$importacao$;
`
      : `

  raise notice 'Importação concluída: % clientes.', ${registros.length};
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

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function principal() {
  const arquivo = process.argv[2]
  if (!arquivo || arquivo.startsWith('--')) {
    console.error('Uso: node scripts/importar-planilha.mts <planilha.xlsx> [--dono email] [--sql saida.sql] [--simular]')
    process.exit(1)
  }

  const hoje = hojeSaoPaulo()
  const { aba, linhas } = lerPrimeiraAba(arquivo)
  const { registros, avisos, comDados, ignoradas } = mapear(linhas, hoje)

  const contar = <T,>(itens: T[], f: (t: T) => string) =>
    itens.reduce<Record<string, number>>((acc, t) => ({ ...acc, [f(t)]: (acc[f(t)] ?? 0) + 1 }), {})

  console.log(`\nPlanilha: ${arquivo}`)
  console.log(`Aba: "${aba}" · referência de "hoje": ${hoje}`)
  console.log(`Linhas com dados: ${comDados}`)
  console.log(`Linhas vazias ignoradas: ${ignoradas}`)
  console.log(`\nSerão importados:`)
  console.log(`  clientes:        ${registros.length}`)
  console.log(`  negociações:     ${registros.length}`)
  console.log(`  eventos:         ${registros.reduce((s, r) => s + r.eventos.length, 0)}`)
  console.log(`  atividades:      ${registros.reduce((s, r) => s + r.atividades.length, 0)}`)
  console.log(`  próximas ações:  ${registros.filter((r) => r.proximoContato).length}`)
  console.log(`\nPor etapa:`, contar(registros, (r) => r.negociacao.etapa))
  console.log(`Por temperatura:`, contar(registros, (r) => r.negociacao.temperatura ?? 'sem'))
  console.log(
    `Valor estimado total: R$ ${registros
      .reduce((s, r) => s + (r.negociacao.valorEstimado ?? 0), 0)
      .toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
  )

  console.log('\nLinha | Cliente | Etapa | Temp. | Valor | Eventos | Atividades | Próx. contato')
  for (const r of registros) {
    const n = r.negociacao
    console.log(
      [
        r.linha,
        r.cliente.nome,
        n.etapa,
        n.temperatura ?? '—',
        n.valorEstimado ?? '—',
        r.eventos.map((e) => `${e.titulo} ${e.dia} (${e.status})`).join('; ') || '—',
        r.atividades.length,
        r.proximoContato ?? '—',
      ].join(' | '),
    )
  }

  console.log(`\nPossíveis problemas (${avisos.length}):`)
  for (const a of avisos) console.log(`  ${a.linha === null ? 'geral' : `linha ${a.linha}`}: ${a.texto}`)

  const dono = argumento('--dono')
  const saida = argumento('--sql')
  if (!dono || !saida) {
    console.log('\nNada foi gerado. Para gerar o SQL de importação: --dono <e-mail ou UUID do closer> --sql <arquivo.sql>')
    return
  }
  if (!UUID.test(dono) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dono)) {
    console.error(`\n--dono inválido: ${dono}`)
    process.exit(1)
  }

  const simular = process.argv.includes('--simular')
  mkdirSync(dirname(saida), { recursive: true })
  writeFileSync(saida, gerarSql(registros, dono, arquivo, simular), 'utf8')
  console.log(`\nSQL ${simular ? 'de SIMULAÇÃO ' : ''}gerado em ${saida}. Nada foi gravado no banco.`)
  console.log(`Revise e execute com: npx supabase db query --linked -f ${saida}`)
}

principal()
