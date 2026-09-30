import { z } from 'zod'

import { CORES_ETAPA } from '@/lib/utils/etapas'
import { TEMPERATURAS, valorEmReais } from '@/lib/validations/negociacao'

const nome = (mensagem: string) => z.string().trim().min(1, mensagem).max(80, 'Máximo de 80 caracteres.')
const nomeEtapa = z.string().trim().min(1, 'Informe o nome da etapa.').max(60, 'Máximo de 60 caracteres.')
const cor = z.enum(CORES_ETAPA, 'Escolha uma cor da paleta.')

const etapaAbertaSchema = z.object({ nome: nomeEtapa, cor })

/**
 * Criação de funil: nome + etapa ganha + etapa perdida (obrigatórias) +
 * abertas opcionais, na ordem em que aparecem no formulário. Espelha os
 * parâmetros de `criar_funil()` — o banco garante que o funil nunca existe
 * sem as duas etapas de fechamento.
 */
export const criarFunilSchema = z.object({
  nome: nome('Informe o nome do funil.'),
  etapaGanhaNome: nomeEtapa,
  etapaGanhaCor: cor,
  etapaPerdidaNome: nomeEtapa,
  etapaPerdidaCor: cor,
  etapasAbertas: z.array(etapaAbertaSchema).max(20, 'Máximo de 20 etapas abertas.').default([]),
})

export type CriarFunilInput = z.output<typeof criarFunilSchema>

export const editarFunilSchema = z.object({
  nome: nome('Informe o nome do funil.'),
  descricao: z
    .string()
    .trim()
    .max(500, 'Máximo de 500 caracteres.')
    .transform((v) => (v === '' ? null : v)),
  whatsappHabilitado: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
})

export type EditarFunilInput = z.output<typeof editarFunilSchema>

export const duplicarFunilSchema = z.object({
  nome: nome('Informe o nome do novo funil.'),
})

/** Nova entrada: negociação nova para um cliente já existente. */
export const novaNegociacaoSchema = z.object({
  cliente_id: z.uuid('Selecione o cliente.'),
  funil_id: z.uuid('Funil inválido.'),
  valor_estimado: valorEmReais,
  temperatura: z
    .string()
    .transform((v) => (v.trim() === '' ? null : v.trim()))
    .pipe(z.enum(TEMPERATURAS, 'Temperatura inválida.').nullable()),
})

export type NovaNegociacaoInput = z.output<typeof novaNegociacaoSchema>
