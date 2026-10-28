import { z } from 'zod'

import { slugDeEmpresa } from '@/lib/empresa/rota'
import { Constants } from '@/lib/types/database'
import { somenteDigitos } from '@/lib/utils/documentos'

/** Validação dos formulários do Super Admin. O banco revalida tudo (permissão, arquivo, limites). */

export const RECURSOS = ['funis_multiplos', 'metas', 'agenda_google', 'ingestao_leads', 'whatsapp', 'relatorios', 'meta_conversoes'] as const
export type Recurso = (typeof RECURSOS)[number]

export const ROTULO_RECURSO: Record<Recurso, string> = {
  funis_multiplos: 'Vários funis',
  metas: 'Metas',
  agenda_google: 'Agenda Google',
  ingestao_leads: 'Webhook de leads',
  whatsapp: 'WhatsApp',
  relatorios: 'Relatórios',
  meta_conversoes: 'Conversões Meta Ads (CRM)',
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

/** Dados de cadastro da empresa (todos opcionais, exceto o nome). */
/** Campo opcional: ausente ou vazio é a mesma coisa. */
const opcional = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim())

const telefoneEmpresa = opcional
  .transform(somenteDigitos)
  .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'Informe o telefone com DDD.')
  .transform((v) => (v === '' ? null : v))
const emailEmpresa = opcional
  .transform((v) => v.toLowerCase())
  .refine((v) => v === '' || z.email().safeParse(v).success, 'E-mail da empresa inválido.')
  .transform((v) => (v === '' ? null : v))
const responsavelEmpresa = opcional
  .refine((v) => v.length <= 120, 'Nome do responsável: no máximo 120 caracteres.')
  .transform((v) => (v === '' ? null : v))

const camposCadastroEmpresa = {
  nome: z.string().trim().min(2, 'Informe o nome da empresa.').max(120),
  telefone: telefoneEmpresa,
  email: emailEmpresa,
  responsavel_nome: responsavelEmpresa,
}

/** Edição dos dados de cadastro (Super Admin, ou admin da própria empresa no banco). */
export const dadosEmpresaSchema = z.object(camposCadastroEmpresa)
export type DadosEmpresaInput = z.infer<typeof dadosEmpresaSchema>

/**
 * Cadastro completo, SÓ pelo Super Admin: além dos dados acima, o nome
 * comercial (visível à empresa) e as observações internas da plataforma
 * (nunca visíveis à empresa).
 */
export const cadastroEmpresaAdminSchema = z.object({
  ...camposCadastroEmpresa,
  nome_comercial: opcional
    .refine((v) => v.length <= 120, 'Nome comercial: no máximo 120 caracteres.')
    .transform((v) => (v === '' ? null : v)),
  observacoes: opcional
    .refine((v) => v.length <= 4000, 'Observações: no máximo 4.000 caracteres.')
    .transform((v) => (v === '' ? null : v)),
})
export type CadastroEmpresaAdminInput = z.infer<typeof cadastroEmpresaAdminSchema>

/** Logo do AVANTE CRM (identidade global): fundo claro ou escuro. */
export const VARIANTES_LOGO = ['claro', 'escuro'] as const

/** Logo: mesmas regras do bucket `empresa-logos` (sem SVG, que pode carregar script). */
export const LOGO_TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const
export const LOGO_TAMANHO_MAXIMO = 2 * 1024 * 1024

export function validarLogo(arquivo: FormDataEntryValue | null): File | null | string {
  if (!(arquivo instanceof File) || arquivo.size === 0) return null
  if (!(arquivo.type in LOGO_TIPOS)) return 'Use uma imagem PNG, JPG ou WebP para o logotipo.'
  if (arquivo.size > LOGO_TAMANHO_MAXIMO) return 'O logotipo pode ter no máximo 2 MB.'
  return arquivo
}

export const novaEmpresaSchema = z.object({
  ...camposCadastroEmpresa,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(63)
    .regex(SLUG, 'Use letras minúsculas, números e hífens (ex.: minha-empresa).')
    .refine((v) => slugDeEmpresa(v), 'Esse endereço é reservado pelo sistema. Escolha outro.'),
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

/** O que o Gerente pode mudar nos dados da própria empresa (nunca nome, endereço, plano). */
export const contatoEmpresaSchema = z.object({
  telefone: telefoneEmpresa,
  email: emailEmpresa,
  responsavel_nome: responsavelEmpresa,
})
export type ContatoEmpresaInput = z.infer<typeof contatoEmpresaSchema>
