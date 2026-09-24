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
 * Devolve string com duas casas ("15000.50"), sem aritmética de float. O
 * limite de 12 dígitos inteiros cabe em numeric(14,2) e também converte para
 * `number` sem perda de centavos, que é como o supabase-js envia numeric.
 */
export const valorEmReais = z
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
const camposQualificacao = {
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
}

/** Espelho da constraint negociacoes_datas_ordem. Datas ISO comparam como texto. */
function datasEmOrdem(
  n: { data_primeira_reuniao: string | null; data_proposta: string | null },
  ctx: z.RefinementCtx,
) {
  if (n.data_primeira_reuniao && n.data_proposta && n.data_proposta < n.data_primeira_reuniao) {
    ctx.addIssue({
      code: 'custom',
      path: ['data_proposta'],
      message: 'A proposta não pode ser anterior à primeira reunião.',
    })
  }
}

export const qualificacaoNegociacaoSchema = z.object(camposQualificacao).superRefine(datasEmOrdem)

export type QualificacaoNegociacaoInput = z.output<typeof qualificacaoNegociacaoSchema>

// ---------------------------------------------------------------------------
// Proposta e edição completa.
// ---------------------------------------------------------------------------

export const FORMAS_PAGAMENTO = Constants.public.Enums.forma_pagamento

export type FormaPagamento = Database['public']['Enums']['forma_pagamento']

export const ROTULO_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  avista: 'À vista',
  boleto_3x: 'Boleto 3x',
  cartao_12x: 'Cartão 12x',
}

/**
 * Tela de edição da negociação: qualificação, proposta e serviços.
 * Etapa, dono e motivo de perda não existem aqui — mudam só pelo funil.
 * Salva o estado completo (campo vazio vira `null`).
 */
export const edicaoNegociacaoSchema = z
  .object({
    ...camposQualificacao,
    valor_proposta: valorEmReais.refine(
      (v) => v === null || Number(v) > 0,
      'O valor da proposta deve ser maior que zero.',
    ),
    forma_pagamento: z
      .string()
      .transform(vazioParaNull)
      .pipe(z.enum(FORMAS_PAGAMENTO, 'Forma de pagamento inválida.').nullable()),
    servico_ids: z
      .array(z.uuid('Serviço inválido.'))
      .transform((ids) => [...new Set(ids)]),
  })
  .superRefine(datasEmOrdem)

export type EdicaoNegociacaoInput = z.output<typeof edicaoNegociacaoSchema>
export type CampoEdicaoNegociacao = keyof z.input<typeof edicaoNegociacaoSchema>
