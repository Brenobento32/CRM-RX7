'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { atualizarFechamento } from '@/lib/dal/funil'
import {
  NEGOCIACAO_ENCERRADA,
  negociacaoEncerrada,
  obterNegociacaoParaEdicao,
  salvarNegociacao,
} from '@/lib/dal/negociacoes'
import { atualizarFechamentoSchema } from '@/lib/validations/funil'
import { edicaoNegociacaoSchema, type CampoEdicaoNegociacao } from '@/lib/validations/negociacao'

type CampoTexto = Exclude<CampoEdicaoNegociacao, 'servico_ids'>

export type EstadoFormNegociacao = {
  erro?: string
  campos?: Partial<Record<CampoEdicaoNegociacao, string[]>>
  /** Devolvidos ao formulário quando o salvamento falha. */
  valores?: Partial<Record<CampoTexto, string>> & { servico_ids?: string[] }
}

const uuid = z.uuid()

const CAMPOS_TEXTO: CampoTexto[] = [
  'valor_estimado',
  'temperatura',
  'data_primeira_reuniao',
  'data_proposta',
  'objecao_principal',
  'valor_proposta',
  'forma_pagamento',
]

export async function salvarNegociacaoAction(
  id: string,
  clienteId: string,
  _estado: EstadoFormNegociacao | undefined,
  formData: FormData,
): Promise<EstadoFormNegociacao> {
  const valores = {
    ...Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, String(formData.get(c) ?? '')])),
    servico_ids: formData.getAll('servico_ids').map(String),
  } as Record<CampoTexto, string> & { servico_ids: string[] }

  if (!uuid.safeParse(id).success || !uuid.safeParse(clienteId).success) {
    return { erro: 'Negociação inválida.', valores }
  }

  // O banco também recusa (salvar_negociacao e triggers); aqui a mensagem
  // sai antes de validar o formulário.
  const atual = await obterNegociacaoParaEdicao(id)
  if (!atual) return { erro: 'Negociação não encontrada.', valores }
  if (negociacaoEncerrada(atual)) return { erro: NEGOCIACAO_ENCERRADA, valores }

  const parsed = edicaoNegociacaoSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await salvarNegociacao(id, parsed.data)
  if (!r.ok) {
    return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
  }

  // Valor estimado e temperatura aparecem na ficha, no card do funil e no
  // pipeline do dashboard.
  revalidatePath('/', 'layout')
  redirect(`/clientes/${clienteId}`)
}

type CampoFechamentoTexto =
  | 'valor_vendido'
  | 'data_fechamento'
  | 'contrato_enviado'
  | 'contrato_assinado'
  | 'link_contrato'
  | 'status_pagamento'
  | 'status_onboarding'
  | 'observacoes'

const CAMPOS_FECHAMENTO_TEXTO: CampoFechamentoTexto[] = [
  'valor_vendido',
  'data_fechamento',
  'contrato_enviado',
  'contrato_assinado',
  'link_contrato',
  'status_pagamento',
  'status_onboarding',
  'observacoes',
]

export type EstadoFormFechamento = {
  erro?: string
  /** Índice solto (não só os campos conhecidos): mais simples pro form ler por nome, igual a EstadoModalFunil. */
  campos?: Record<string, string[] | undefined>
  valores?: Partial<Record<CampoFechamentoTexto, string>> & { servico_ids?: string[] }
}

/**
 * Editar um fechamento já existente. Diferente de `fecharNegociacaoAction`
 * (modal do Kanban, fica na mesma página): esta é uma página própria
 * (`/negociacoes/[id]/editar`), então redireciona ao terminar, igual a
 * `salvarNegociacaoAction`.
 */
export async function atualizarFechamentoAction(
  id: string,
  clienteId: string,
  _estado: EstadoFormFechamento | undefined,
  formData: FormData,
): Promise<EstadoFormFechamento> {
  const valores = {
    ...Object.fromEntries(CAMPOS_FECHAMENTO_TEXTO.map((c) => [c, String(formData.get(c) ?? '')])),
    servico_ids: formData.getAll('servico_ids').map(String),
  } as Record<CampoFechamentoTexto, string> & { servico_ids: string[] }

  if (!uuid.safeParse(id).success || !uuid.safeParse(clienteId).success) {
    return { erro: 'Negociação inválida.', valores }
  }

  const parsed = atualizarFechamentoSchema.safeParse({ negociacao_id: id, ...valores })
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await atualizarFechamento(parsed.data)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidatePath('/', 'layout')
  redirect(`/clientes/${clienteId}`)
}
