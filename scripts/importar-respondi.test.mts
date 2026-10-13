import { describe, expect, it } from 'vitest'

import {
  mascarar,
  normalizarTelefone,
  parseCsv,
  pareceTeste,
  processarLinha,
  type LinhaValida,
} from './importar-respondi.mts'

/** Quota campos com vírgula/aspas — os headers reais do Respondi têm vírgula (“Atualmente, qual é...”). */
function csvRow(campos: string[]): string {
  return campos.map((c) => (/[,"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')
}

const CABECALHO = [
  'Qual seu nome e sobrenome?',
  'Digite o número do seu WhatsApp para contato',
  'Digite o seu melhor E-mail',
  'Qual o nome da empresa?',
  'Qual o Instagram da sua Instituição de Ensino?',
  'Quantos colaboradores você possui?',
  'Atualmente, qual é o maior desafio da sua Instituição?',
  // Header real do CSV exportado em 13/10/2026: placeholder de nome não
  // resolvido pelo Respondi ("___,"), não "Breno," — ver SUFIXO_META_ALUNOS.
  '___, qual é a sua meta de alunos na sua instituição de ensino?',
  'E quantos alunos você tem atualmente?',
  'Pontuação',
  'Data',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ID',
]

/** Linha completa, válida, com todas as 19 colunas preenchidas — ponto de partida dos testes abaixo. */
function linhaCompleta(id: string): string[] {
  return [
    'Maria Silva',
    '+55 (91) 98338-0874',
    'maria@escola.com.br',
    'Escola Maria',
    '@escolamaria',
    '1 a 2',
    'Muitos leads e poucas vendas',
    '500',
    '300',
    '85',
    '2026-10-10',
    'google',
    'cpc',
    'campanha-outubro',
    'instituicao-ensino',
    'anuncio-1',
    'Cj0KCQjw...',
    'IwAR...',
    id,
  ]
}

/** 20 linhas, cada uma com ID único — fixture principal pra validar a estrutura do CSV real. */
function csv20Linhas(): string {
  const linhas = Array.from({ length: 20 }, (_, i) => csvRow(linhaCompleta(`resp_${i + 1}`)))
  return [csvRow(CABECALHO), ...linhas].join('\n')
}

describe('parseCsv', () => {
  it('lê cabeçalho + 20 linhas de dados', () => {
    const linhas = parseCsv(csv20Linhas())
    expect(linhas).toHaveLength(21)
    expect(linhas[0]).toEqual(CABECALHO)
  })

  it('respeita campos entre aspas com vírgula e aspas escapada dentro', () => {
    const csv = 'nome,obs\n"Silva, João","disse ""oi"""'
    const linhas = parseCsv(csv)
    expect(linhas).toEqual([
      ['nome', 'obs'],
      ['Silva, João', 'disse "oi"'],
    ])
  })
})

describe('processarLinha — 20 IDs únicos', () => {
  it('as 20 linhas da fixture têm IDs distintos e todas são válidas', () => {
    const [headers, ...linhasDados] = parseCsv(csv20Linhas())
    const resultados = linhasDados.map((c, i) => processarLinha(headers, c, i + 2))
    expect(resultados.every((r) => r.ok)).toBe(true)
    const ids = new Set(resultados.flatMap((r) => (r.ok ? [r.dado.externalId] : [])))
    expect(ids.size).toBe(20)
  })
})

describe('processarLinha — campos individuais', () => {
  const headers = CABECALHO

  it('telefone é formatado (só dígitos, sem adicionar/remover DDI)', () => {
    const r = processarLinha(headers, linhaCompleta('t1'), 2)
    expect(r.ok).toBe(true)
    expect((r as { ok: true; dado: LinhaValida }).dado.telefone).toBe('5591983380874')
  })

  it('telefone vazio + e-mail presente → linha válida, telefone null', () => {
    const celulas = linhaCompleta('t2')
    celulas[1] = ''
    const r = processarLinha(headers, celulas, 2)
    expect(r.ok).toBe(true)
    expect((r as { ok: true; dado: LinhaValida }).dado.telefone).toBeNull()
  })

  it('e-mail vazio + telefone presente → linha válida, email null', () => {
    const celulas = linhaCompleta('t3')
    celulas[2] = ''
    const r = processarLinha(headers, celulas, 2)
    expect(r.ok).toBe(true)
    expect((r as { ok: true; dado: LinhaValida }).dado.email).toBeNull()
  })

  it('telefone E e-mail vazios → linha inválida', () => {
    const celulas = linhaCompleta('t4')
    celulas[1] = ''
    celulas[2] = ''
    const r = processarLinha(headers, celulas, 2)
    expect(r.ok).toBe(false)
  })

  it('campos opcionais vazios (empresa/instagram) não invalidam a linha', () => {
    const celulas = linhaCompleta('t5')
    celulas[3] = ''
    celulas[4] = ''
    const r = processarLinha(headers, celulas, 2)
    expect(r.ok).toBe(true)
    const dado = (r as { ok: true; dado: LinhaValida }).dado
    expect(dado.empresa).toBeNull()
    expect(dado.instagram).toBeNull()
  })

  it('UTMs vazias não aparecem em atribuicao, mas respondent_id sempre entra', () => {
    const celulas = linhaCompleta('t6')
    for (const idx of [11, 12, 13, 14, 15, 16, 17]) celulas[idx] = ''
    const r = processarLinha(headers, celulas, 2)
    expect(r.ok).toBe(true)
    const atrib = (r as { ok: true; dado: LinhaValida }).dado.atribuicao
    expect(atrib.utm_source).toBeUndefined()
    expect(atrib.gclid).toBeUndefined()
    expect(atrib.fbclid).toBeUndefined()
    expect(atrib.respondent_id).toBe('t6')
  })

  it('as 4 perguntas de qualificação são mapeadas para o texto canônico — nenhuma mesclada', () => {
    const r = processarLinha(headers, linhaCompleta('t7'), 2)
    expect(r.ok).toBe(true)
    const respostas = (r as { ok: true; dado: LinhaValida }).dado.respostas
    expect(respostas.map((x) => x.pergunta_externa)).toEqual([
      'Quantos colaboradores você possui?',
      'Atualmente, qual é o maior desafio da sua Instituição?',
      'Breno, qual é a sua meta de alunos na sua instituição de ensino?',
      'E quantos alunos você tem atualmente?',
    ])
  })

  it('header "Breno, qual é..." (texto exato, formato do webhook) também é reconhecido pela pergunta 3', () => {
    const headersComNome = [...CABECALHO]
    headersComNome[7] = 'Breno, qual é a sua meta de alunos na sua instituição de ensino?'
    const r = processarLinha(headersComNome, linhaCompleta('t7b'), 2)
    expect(r.ok).toBe(true)
    const respostas = (r as { ok: true; dado: LinhaValida }).dado.respostas
    const meta = respostas.find((x) => x.pergunta_externa.startsWith('Breno, qual é'))
    expect(meta?.resposta).toBe('500')
  })

  it('quando só "quantos alunos tem atualmente" está preenchida, vai pra pergunta 4 (nunca pra 3)', () => {
    const celulas = linhaCompleta('t8')
    celulas[7] = '' // meta de alunos (pergunta 3) vazia
    const r = processarLinha(headers, celulas, 2)
    expect(r.ok).toBe(true)
    const respostas = (r as { ok: true; dado: LinhaValida }).dado.respostas
    expect(respostas.find((x) => x.pergunta_externa.startsWith('Breno, qual é'))).toBeUndefined()
    const atual = respostas.find((x) => x.pergunta_externa === 'E quantos alunos você tem atualmente?')
    expect(atual?.resposta).toBe('300')
  })

  describe('pergunta 3 e pergunta 4 são independentes (correção do bug de mesclagem, 2026-10-13)', () => {
    function respostasQualificacao(id: string, meta: string, atual: string) {
      const celulas = linhaCompleta(id)
      celulas[7] = meta
      celulas[8] = atual
      const r = processarLinha(headers, celulas, 2)
      expect(r.ok).toBe(true)
      return (r as { ok: true; dado: LinhaValida }).dado.respostas
    }

    it('pergunta 3 vai para a pergunta 3 do banco, pergunta 4 para a pergunta 4 — nenhuma é descartada', () => {
      const respostas = respostasQualificacao('sim1', '500', '300')
      const p3 = respostas.find((x) => x.pergunta_externa === 'Breno, qual é a sua meta de alunos na sua instituição de ensino?')
      const p4 = respostas.find((x) => x.pergunta_externa === 'E quantos alunos você tem atualmente?')
      expect(p3?.resposta).toBe('500')
      expect(p4?.resposta).toBe('300')
    })

    it('meta=500, atual=300 → pergunta 3 = 500, pergunta 4 = 300', () => {
      const respostas = respostasQualificacao('sim2', '500', '300')
      expect(respostas.find((x) => x.pergunta_externa.startsWith('Breno'))?.resposta).toBe('500')
      expect(respostas.find((x) => x.pergunta_externa === 'E quantos alunos você tem atualmente?')?.resposta).toBe(
        '300',
      )
    })

    it('meta=300, atual=500 (valores trocados) → pergunta 3 = 300, pergunta 4 = 500', () => {
      const respostas = respostasQualificacao('sim3', '300', '500')
      expect(respostas.find((x) => x.pergunta_externa.startsWith('Breno'))?.resposta).toBe('300')
      expect(respostas.find((x) => x.pergunta_externa === 'E quantos alunos você tem atualmente?')?.resposta).toBe(
        '500',
      )
    })

    it('as duas podem existir simultaneamente e permanecem com valores diferentes (nunca mescladas numa só)', () => {
      const respostas = respostasQualificacao('sim4', 'valor-A', 'valor-B')
      const qualificacao = respostas.filter((x) => x.pergunta_externa.startsWith('Breno') || x.pergunta_externa === 'E quantos alunos você tem atualmente?')
      expect(qualificacao).toHaveLength(2)
      expect(qualificacao.map((x) => x.resposta).sort()).toEqual(['valor-A', 'valor-B'])
    })
  })

  it('pontuação e data entram em atribuicao como texto, sem conversão', () => {
    const r = processarLinha(headers, linhaCompleta('t9'), 2)
    expect(r.ok).toBe(true)
    const atrib = (r as { ok: true; dado: LinhaValida }).dado.atribuicao
    expect(atrib.pontuacao).toBe('85')
    expect(atrib.data_formulario).toBe('2026-10-10')
  })

  it('respondent_id = coluna ID (confirmado manualmente, ver topo do script)', () => {
    const r = processarLinha(headers, linhaCompleta('resp_xyz'), 2)
    expect(r.ok).toBe(true)
    const dado = (r as { ok: true; dado: LinhaValida }).dado
    expect(dado.externalId).toBe('resp_xyz')
    expect(dado.atribuicao.respondent_id).toBe('resp_xyz')
  })

  it('ID vazio → linha inválida, nunca envia requisição/gera payload', () => {
    const celulas = linhaCompleta('')
    celulas[18] = ''
    const r = processarLinha(headers, celulas, 2)
    expect(r.ok).toBe(false)
  })
})

describe('normalizarTelefone', () => {
  it('remove tudo que não é dígito, sem adicionar nem remover 55', () => {
    expect(normalizarTelefone('+55 (91) 98338-0874')).toBe('5591983380874')
    expect(normalizarTelefone('91 98338-0874')).toBe('91983380874')
  })

  it('string vazia ou null vira null', () => {
    expect(normalizarTelefone('')).toBeNull()
    expect(normalizarTelefone(null)).toBeNull()
  })
})

describe('duplicação de ID dentro do arquivo', () => {
  it('a mesma linha enviada duas vezes gera o mesmo external_id (dedup fica a cargo de ingerir_lead_formulario)', () => {
    const [headers, ...linhasDados] = parseCsv(
      [csvRow(CABECALHO), csvRow(linhaCompleta('dup_1')), csvRow(linhaCompleta('dup_1'))].join('\n'),
    )
    const resultados = linhasDados.map((c, i) => processarLinha(headers, c, i + 2))
    expect(resultados.every((r) => r.ok)).toBe(true)
    const ids = resultados.flatMap((r) => (r.ok ? [r.dado.externalId] : []))
    expect(ids).toEqual(['dup_1', 'dup_1'])
  })
})

describe('pareceTeste / mascarar', () => {
  it('nome com "teste" é sinalizado; nome comum não é', () => {
    const base = (r: ReturnType<typeof processarLinha>) => (r as { ok: true; dado: LinhaValida }).dado

    const celulasTeste = linhaCompleta('m1')
    celulasTeste[0] = 'Lead Teste'
    const teste = base(processarLinha(CABECALHO, celulasTeste, 2))
    expect(pareceTeste(teste)).toBe(true)

    const normal = base(processarLinha(CABECALHO, linhaCompleta('m2'), 2))
    expect(pareceTeste(normal)).toBe(false)
  })

  it('mascarar nunca devolve o nome completo em claro', () => {
    expect(mascarar('Lead Teste')).toBe('L*** T****')
    expect(mascarar('Maria')).toBe('M****')
  })
})
