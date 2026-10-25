import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'
import { somenteDigitos } from '@/lib/utils/documentos'
import { CORES_ETAPA } from '@/lib/utils/etapas'

export type Papel = Database['public']['Enums']['user_role']

export const PAPEIS = Constants.public.Enums.user_role

/**
 * Os cinco cargos operacionais, cada um com regras PRÓPRIAS (Vendedor não é
 * Closer, Atendente não é SDR) — ver docs/MATRIZ-CARGOS.md. O banco decide;
 * as telas só refletem. Super Admin não é cargo: é privilégio global da Rio X7.
 */
export const ROTULO_PAPEL: Record<Papel, string> = {
  gerente: 'Gerente',
  vendedor: 'Vendedor',
  atendente: 'Atendente',
  sdr: 'SDR',
  closer: 'Closer',
}

/** Mesmo tipo de `Papel` (nome usado pelas telas). */
export type Cargo = Papel
export const ROTULO_CARGO = ROTULO_PAPEL

/** Ordem de exibição no cadastro de usuários. */
export const CARGOS_EM_ORDEM: readonly Papel[] = ['gerente', 'vendedor', 'atendente', 'sdr', 'closer']

/** Quem agenda reuniões para um Closer da empresa (além do Gerente). */
export const CARGOS_QUE_AGENDAM_PARA_CLOSER: readonly Papel[] = ['sdr', 'atendente']

/**
 * Áreas da matriz que nem todo cargo usa (menu e guarda de cada página). O
 * banco nega o acesso aos dados de qualquer forma; aqui é a experiência.
 */
export const CARGOS_POR_AREA = {
  propostas: ['gerente', 'vendedor', 'closer'],
  metas: ['gerente', 'vendedor', 'sdr', 'closer'],
  relatorios: ['gerente', 'vendedor', 'sdr', 'closer'],
} as const satisfies Record<string, readonly Papel[]>

/** Igual ao bucket `avatares` (migration de usuários). */
export const FOTO_TIPOS = ['image/jpeg', 'image/png', 'image/webp'] as const
export const FOTO_TAMANHO_MAXIMO = 2 * 1024 * 1024

const nome = z.string().trim().min(1, 'Informe o nome.').max(120, 'Máximo de 120 caracteres.')

const telefone = z
  .string()
  .transform(somenteDigitos)
  .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), {
    message: 'Informe o telefone com DDD.',
  })
  .transform((v) => (v === '' ? null : v))

const papel = z.enum(PAPEIS, 'Selecione o perfil.')

/** Cor na agenda (mesma paleta das etapas). Vazio = sem cor. */
const corAgenda = z
  .string()
  .default('')
  .transform((v) => (v === '' ? null : v))
  .pipe(z.enum(CORES_ETAPA, 'Escolha uma cor da paleta.').nullable())

export const criarUsuarioSchema = z.object({
  nome,
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.')),
  // 72 é o limite do bcrypt usado pelo Supabase Auth.
  senha: z
    .string()
    .min(8, 'A senha inicial precisa ter ao menos 8 caracteres.')
    .max(72, 'Máximo de 72 caracteres.'),
  telefone,
  role: papel,
  cor_agenda: corAgenda,
})

export type CriarUsuarioInput = z.output<typeof criarUsuarioSchema>

export const editarUsuarioSchema = z.object({
  nome,
  telefone,
  role: papel,
  cor_agenda: corAgenda,
  ativo: z.enum(['sim', 'nao'], 'Informe o status.').transform((v) => v === 'sim'),
  remover_foto: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
})

export type EditarUsuarioInput = z.output<typeof editarUsuarioSchema>

/** "Editar perfil" do próprio usuário: nunca papel, status nem e-mail. */
export const meuPerfilSchema = z.object({
  nome,
  telefone,
  cor_agenda: corAgenda,
})

export type MeuPerfilInput = z.output<typeof meuPerfilSchema>

/** `null` = sem foto enviada; string = mensagem de erro. */
export function validarFoto(arquivo: FormDataEntryValue | null): File | null | string {
  if (!(arquivo instanceof File) || arquivo.size === 0) return null
  if (!(FOTO_TIPOS as readonly string[]).includes(arquivo.type)) {
    return 'Use uma imagem JPG, PNG ou WebP.'
  }
  if (arquivo.size > FOTO_TAMANHO_MAXIMO) return 'A foto pode ter no máximo 2 MB.'
  return arquivo
}

export const CAMPOS_USUARIO = [
  'nome',
  'email',
  'senha',
  'telefone',
  'role',
  'cor_agenda',
  'ativo',
  'foto',
  'remover_foto',
] as const

export type CampoUsuario = (typeof CAMPOS_USUARIO)[number]
