import { z } from 'zod'

import { Constants } from '@/lib/types/database'

/** Validação dos formulários do Super Admin. O banco revalida tudo (permissão, arquivo, limites). */

export const RECURSOS = ['funis_multiplos', 'metas', 'agenda_google', 'ingestao_leads', 'whatsapp', 'relatorios'] as const
export type Recurso = (typeof RECURSOS)[number]

export const ROTULO_RECURSO: Record<Recurso, string> = {
  funis_multiplos: 'Vários funis',
  metas: 'Metas',
  agenda_google: 'Agenda Google',
  ingestao_leads: 'Webhook de leads',
  whatsapp: 'WhatsApp',
  relatorios: 'Relatórios',
}

/**
 * Recursos ainda válidos no banco, mas desligados no produto: não aparecem em
 * nenhuma tela. A agenda agora é nativa (Google Calendar desativado). O valor
 * continua aceito para não reprovar planos já salvos com ele.
 */
export const RECURSOS_OCULTOS: readonly Recurso[] = ['agenda_google']

/** Recursos que as telas mostram (planos, assinatura). */
export const RECURSOS_VISIVEIS = RECURSOS.filter((r) => !RECURSOS_OCULTOS.includes(r))

export const STATUS_ASSINATURA = Constants.public.Enums.assinatura_status
export const CICLOS = Constants.public.Enums.assinatura_ciclo
export const STATUS_PLANO = Constants.public.Enums.plano_status

export const ROTULO_STATUS_ASSINATURA: Record<(typeof STATUS_ASSINATURA)[number], string> = {
  teste: 'Teste',
  ativa: 'Ativa',
  vencida: 'Vencida',
  suspensa: 'Suspensa',
  cancelada: 'Cancelada',
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DIA = /^\d{4}-\d{2}-\d{2}$/

/** Campo vazio = null (preço/limite ainda não definido). */
const numeroOpcional = (rotulo: string, inteiro: boolean, minimo: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(',', '.'))
    .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= minimo && (!inteiro || Number.isInteger(Number(v)))), {
      message: `${rotulo} inválido.`,
    })
    .transform((v) => (v === '' ? null : Number(v)))

const diaOpcional = z
  .string()
  .trim()
  .refine((v) => v === '' || DIA.test(v), 'Data inválida.')
  .transform((v) => (v === '' ? null : `${v}T12:00:00-03:00`))

export const novaEmpresaSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da empresa.').max(120),
  slug: z.string().trim().toLowerCase().max(63).regex(SLUG, 'Use letras minúsculas, números e hífens (ex.: minha-empresa).'),
  admin_nome: z.string().trim().min(2, 'Informe o nome do administrador.').max(120),
  admin_email: z.email('E-mail inválido.').trim().toLowerCase(),
  admin_senha: z
    .string()
    .refine((v) => v === '' || v.length >= 8, 'A senha inicial precisa ter ao menos 8 caracteres (ou deixe vazio para convite).')
    .transform((v) => (v === '' ? null : v)),
})
export type NovaEmpresaInput = z.infer<typeof novaEmpresaSchema>

export const planoSchema = z.object({
  codigo: z.string().trim().regex(SLUG, 'Código inválido.'),
  nome: z.string().trim().min(2, 'Informe o nome do plano.').max(60),
  preco_mensal: numeroOpcional('Preço mensal', false, 0),
  preco_anual: numeroOpcional('Preço anual', false, 0),
  limite_usuarios: numeroOpcional('Limite de usuários', true, 1),
  limite_integracoes: numeroOpcional('Limite de integrações', true, 0),
  dias_teste: numeroOpcional('Dias de teste', true, 0),
  recursos: z.array(z.enum(RECURSOS)),
  status: z.enum(STATUS_PLANO),
})
export type PlanoInput = z.infer<typeof planoSchema>

export const assinaturaSchema = z.object({
  plano_codigo: z.string().trim().regex(SLUG, 'Escolha um plano.'),
  status: z.enum(STATUS_ASSINATURA),
  ciclo: z.enum(CICLOS),
  renovacao_em: diaOpcional,
  teste_ate: diaOpcional,
  motivo: z.string().trim().min(3, 'Informe o motivo da alteração.').max(500),
  provedor: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === '' || /^[a-z0-9_]+$/.test(v), 'Provedor inválido.')
    .transform((v) => v || null),
  provedor_assinatura_id: z.string().trim().max(200).transform((v) => v || null),
})
export type AssinaturaInput = z.infer<typeof assinaturaSchema>

export const motivoSchema = z.string().trim().min(3, 'Informe o motivo.').max(500)
