import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'

/** Vem do enum do banco: um valor novo lá aparece aqui ao rodar `db:types`. */
export const TEMPERATURAS = Constants.public.Enums.temperatura_negociacao

export type Temperatura = Database['public']['Enums']['temperatura_negociacao']

export const ROTULO_TEMPERATURA: Record<Temperatura, string> = {
  quente: 'Quente',
  morno: 'Morno',
  frio: 'Frio',
}

/** Campo opcional de formulário: vazio vira `null`. */
const vazioParaNull = (v: string) => (v.trim() === '' ? null : v.trim())

/**
 * Valor em reais. Aceita "15000", "15000.50", "15.000", "15.000,50" e
 * "R$ 15.000,50".
 * Devolve string com duas casas ("15000.50"): o Postgres grava em
 * numeric(14,2) e o valor não passa por float no caminho.
 */
const valorEmReais = z
  .string()
  .transform((v, ctx) => {
    const limpo = v.replace(/R\$|\s/g, '')
    if (limpo === '') return null

    // Com vírgula, o formato é brasileiro: ponto é separador de milhar.
    // Sem vírgula, "15.000" também é milhar; "15.5" é decimal.
    const normalizado = limpo.includes(',')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : /^\d{1,3}(\.\d{3})+$/.test(limpo)
        ? limpo.replace(/\./g, '')
        : limpo

    if (!/^\d{1,12}(\.\d{1,2})?$/.test(normalizado)) {
      ctx.addIssue({ code: 'custom', message: 'Valor inválido.' })
      return z.NEVER
    }

    const [inteiro, centavos = ''] = normalizado.split('.')
    return `${inteiro}.${centavos.padEnd(2, '0')}`
  })

/** Data de `<input type="date">` (AAAA-MM-DD). */
const dataOpcional = z
  .string()
  .transform(vazioParaNull)
  .pipe(z.iso.date('Data inválida.').nullable())

/**
 * Dados de qualificação da negociação.
 *
 * Etapa, posição e motivo de perda ficam de fora: mudam pelo Kanban, com
 * regras próprias (modal de fechamento, motivo obrigatório para perdido).
 */
export const qualificacaoNegociacaoSchema = z
  .object({
    valor_estimado: valorEmReais,
    temperatura: z
      .string()
      .transform(vazioParaNull)
      .pipe(z.enum(TEMPERATURAS, 'Temperatura inválida.').nullable()),
    data_primeira_reuniao: dataOpcional,
    data_proposta: dataOpcional,
    objecao_principal: z
      .string()
      .max(2000, 'Máximo de 2000 caracteres.')
      .transform(vazioParaNull),
  })
  .superRefine((n, ctx) => {
    // Espelho da constraint negociacoes_datas_ordem. Datas ISO comparam como texto.
    if (
      n.data_primeira_reuniao &&
      n.data_proposta &&
      n.data_proposta < n.data_primeira_reuniao
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['data_proposta'],
        message: 'A proposta não pode ser anterior à primeira reunião.',
      })
    }
  })

export type QualificacaoNegociacaoInput = z.output<typeof qualificacaoNegociacaoSchema>
