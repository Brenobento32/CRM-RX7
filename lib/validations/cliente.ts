import { z } from 'zod'

import { cnpjValido, cpfValido, somenteDigitos } from '@/lib/utils/documentos'

/** Campo de texto opcional: vazio vira `null`. */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .transform((v) => (v === '' ? null : v))

const telefoneOpcional = z
  .string()
  .transform(somenteDigitos)
  .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), {
    message: 'Informe o número com DDD.',
  })
  .transform((v) => (v === '' ? null : v))

const documentoOpcional = (
  tamanho: number,
  valido: (v: string) => boolean,
  nome: string,
) =>
  z
    .string()
    .transform(somenteDigitos)
    .refine((v) => v === '' || (v.length === tamanho && valido(v)), {
      message: `${nome} inválido.`,
    })
    .transform((v) => (v === '' ? null : v))

export const TIPOS_CLIENTE = ['pessoa_fisica', 'empresa'] as const

export const ROTULO_TIPO_CLIENTE: Record<(typeof TIPOS_CLIENTE)[number], string> = {
  pessoa_fisica: 'Pessoa física',
  empresa: 'Empresa',
}

/**
 * Cadastro do cliente. Apenas dados cadastrais: nada de valor de proposta,
 * etapa, follow-up ou reunião — isso é da negociação.
 *
 * Regras:
 * - `nome` sempre obrigatório (nome da pessoa ou do contato principal).
 * - Empresa exige `empresa`; CPF só vale para pessoa física, CNPJ só para
 *   empresa, e `responsavel` / `cargo` só para empresa. Os campos que não se
 *   aplicam ao tipo são descartados (viram `null`), igual à constraint do banco.
 * - Pelo menos um meio de contato: telefone, WhatsApp ou e-mail.
 */
export const clienteSchema = z
  .object({
    tipo_cliente: z.enum(TIPOS_CLIENTE, 'Selecione o tipo de cliente.'),
    nome: z.string().trim().min(1, 'Informe o nome.').max(200, 'Máximo de 200 caracteres.'),
    empresa: textoOpcional(200),
    cpf: documentoOpcional(11, cpfValido, 'CPF'),
    cnpj: documentoOpcional(14, cnpjValido, 'CNPJ'),
    telefone: telefoneOpcional,
    whatsapp: telefoneOpcional,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === '' || z.email().safeParse(v).success, {
        message: 'E-mail inválido.',
      })
      .transform((v) => (v === '' ? null : v)),
    responsavel: textoOpcional(200),
    cargo: textoOpcional(120),
    instagram: textoOpcional(120),
    observacoes: textoOpcional(5000),
    owner_id: z
      .string()
      .transform((v) => (v === '' ? null : v))
      .pipe(z.uuid('Responsável pela carteira inválido.').nullable()),
  })
  .transform((c) =>
    c.tipo_cliente === 'pessoa_fisica'
      ? { ...c, cnpj: null, responsavel: null, cargo: null }
      : { ...c, cpf: null },
  )
  .superRefine((c, ctx) => {
    if (c.tipo_cliente === 'empresa' && !c.empresa) {
      ctx.addIssue({
        code: 'custom',
        path: ['empresa'],
        message: 'Informe o nome da empresa.',
      })
    }
    if (!c.telefone && !c.whatsapp && !c.email) {
      ctx.addIssue({
        code: 'custom',
        path: ['telefone'],
        message: 'Informe ao menos telefone, WhatsApp ou e-mail.',
      })
    }
  })

export type ClienteInput = z.output<typeof clienteSchema>

export const CAMPOS_CLIENTE = [
  'tipo_cliente',
  'nome',
  'empresa',
  'cpf',
  'cnpj',
  'telefone',
  'whatsapp',
  'email',
  'responsavel',
  'cargo',
  'instagram',
  'observacoes',
  'owner_id',
] as const

export type CampoCliente = (typeof CAMPOS_CLIENTE)[number]
