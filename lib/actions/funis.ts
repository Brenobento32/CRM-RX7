'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { criarNegociacao } from '@/lib/dal/funil'
import {
  criarFunil,
  definirAtivoFunil,
  duplicarFunil,
  editarFunil,
  excluirFunil,
  type ResultadoFunil,
} from '@/lib/dal/funis'
import {
  criarFunilSchema,
  duplicarFunilSchema,
  editarFunilSchema,
  novaNegociacaoSchema,
} from '@/lib/validations/funis'

const uuid = z.uuid()

/** Funis, etapas e o Kanban aparecem em várias telas. */
function revalidar() {
  revalidatePath('/', 'layout')
}

export type EstadoFormFunil = {
  erro?: string
  campos?: Record<string, string[] | undefined>
  valores?: Record<string, unknown>
}

function lerEtapasAbertas(formData: FormData): { nome: string; cor: string }[] {
  const nomes = formData.getAll('etapa_aberta_nome').map(String)
  const cores = formData.getAll('etapa_aberta_cor').map(String)
  return nomes.map((nome, i) => ({ nome, cor: cores[i] ?? '' })).filter((e) => e.nome.trim() !== '')
}

export async function criarFunilAction(
  _estado: EstadoFormFunil | undefined,
  formData: FormData,
): Promise<EstadoFormFunil> {
  const valores = {
    nome: String(formData.get('nome') ?? ''),
    etapaGanhaNome: String(formData.get('etapa_ganha_nome') ?? ''),
    etapaGanhaCor: String(formData.get('etapa_ganha_cor') ?? ''),
    etapaPerdidaNome: String(formData.get('etapa_perdida_nome') ?? ''),
    etapaPerdidaCor: String(formData.get('etapa_perdida_cor') ?? ''),
    etapasAbertas: lerEtapasAbertas(formData),
  }
  const parsed = criarFunilSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarFunil(parsed.data)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidar()
  redirect(`/configuracoes/funis/${r.id}`)
}

export async function editarFunilAction(
  id: string,
  _estado: EstadoFormFunil | undefined,
  formData: FormData,
): Promise<EstadoFormFunil> {
  const valores = {
    nome: String(formData.get('nome') ?? ''),
    descricao: String(formData.get('descricao') ?? ''),
    whatsappHabilitado: formData.get('whatsapp_habilitado') === 'on' ? 'on' : '',
  }
  if (!uuid.safeParse(id).success) return { erro: 'Funil inválido.', valores }

  const parsed = editarFunilSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await editarFunil(id, parsed.data)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidar()
  redirect(`/configuracoes/funis/${id}`)
}

export async function duplicarFunilAction(
  id: string,
  _estado: EstadoFormFunil | undefined,
  formData: FormData,
): Promise<EstadoFormFunil> {
  const valores = { nome: String(formData.get('nome') ?? '') }
  if (!uuid.safeParse(id).success) return { erro: 'Funil inválido.', valores }

  const parsed = duplicarFunilSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await duplicarFunil(id, parsed.data.nome)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidar()
  redirect(`/configuracoes/funis/${r.id}`)
}

/** Ações da lista (ativar/desativar, excluir) — falha volta com a mensagem na URL. */
async function concluir(r: ResultadoFunil) {
  revalidar()
  if (!r.ok) redirect(`/configuracoes/funis?erro=${encodeURIComponent(r.mensagem)}`)
}

export async function definirAtivoFunilAction(id: string, ativo: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(await definirAtivoFunil(id, ativo))
}

export async function excluirFunilAction(id: string): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(await excluirFunil(id))
}

export type EstadoNovaNegociacao = {
  erro?: string
  campos?: Record<string, string[] | undefined>
  valores?: Record<string, string>
}

/** Nova entrada do Kanban: negociação nova para um cliente já existente. */
export async function criarNegociacaoAction(
  _estado: EstadoNovaNegociacao | undefined,
  formData: FormData,
): Promise<EstadoNovaNegociacao> {
  const valores = {
    cliente_id: String(formData.get('cliente_id') ?? ''),
    funil_id: String(formData.get('funil_id') ?? ''),
    valor_estimado: String(formData.get('valor_estimado') ?? ''),
    temperatura: String(formData.get('temperatura') ?? ''),
  }
  const parsed = novaNegociacaoSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarNegociacao(parsed.data)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidatePath('/funil')
  revalidatePath(`/clientes/${parsed.data.cliente_id}`)
  redirect(`/funil?funil=${parsed.data.funil_id}`)
}
