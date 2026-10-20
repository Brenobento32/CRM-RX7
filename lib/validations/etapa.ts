import { z } from 'zod'

import { CORES_ETAPA } from '@/lib/utils/etapas'

const nome = z
  .string()
  .trim()
  .min(1, 'Informe o nome da etapa.')
  .max(60, 'Máximo de 60 caracteres.')

const cor = z.enum(CORES_ETAPA, 'Escolha uma cor da paleta.')

/** Valor cru do checkbox "Participa do funil de conversão" — normalização de negócio (ganha/perdida/recuperação) fica no DAL (`criarEtapa`/`editarEtapa`), que é quem conhece tipo/zona reais da etapa. */
const participaConversao = z
  .string()
  .optional()
  .transform((v) => v === 'on')

/**
 * Zona da etapa nova. "Fluxo comercial" (padrão) entra antes do fechamento;
 * "Recuperação pós-perda" entra depois — sem conversão entre zonas nesta fase.
 */
export const criarEtapaSchema = z.object({
  nome,
  cor,
  posFechamento: z
    .enum(['pipeline', 'recuperacao'])
    .default('pipeline')
    .transform((v) => v === 'recuperacao'),
  participaConversao,
})

/** Em etapa de sistema o nome é ignorado no servidor (só a cor muda). */
export const editarEtapaSchema = z.object({
  nome: nome.optional(),
  cor,
  participaConversao,
})

export type CriarEtapaInput = z.output<typeof criarEtapaSchema>
export type EditarEtapaInput = z.output<typeof editarEtapaSchema>

export const direcaoSchema = z.enum(['cima', 'baixo'])
export type Direcao = z.output<typeof direcaoSchema>
