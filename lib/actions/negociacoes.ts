'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { atualizarFechamento } from '@/lib/dal/funil'
import {
  NEGOCIACAO_ENCERRADA,
  negociacaoEncerrada,
  obterNegociacaoParaEdicao,
  salvarEMoverNegociacao,
  salvarNegociacao,
  type NegociacaoEdicao,
} from '@/lib/dal/negociacoes'
import { obterRegrasComerciais } from '@/lib/dal/regras-comerciais'
import { itensJaConfirmados, obterRegrasEtapas } from '@/lib/dal/regras-etapas'
import {
  CAMPO_FORMULARIO,
  camposFaltando,
  camposVisiveis,
  descreverRequisitos,
  preservarOcultos,
  type RequisitosEtapa,
} from '@/lib/utils/regras-etapas'
import { criarAtualizarFechamentoSchema } from '@/lib/validations/funil'
import { edicaoNegociacaoSchema, type CampoEdicaoNegociacao, type EdicaoNegociacaoInput } from '@/lib/validations/negociacao'

type CampoTexto = Exclude<CampoEdicaoNegociacao, 'servico_ids'>

export type EstadoFormNegociacao = {
  erro?: string
  /** `checklist` = itens de confirmação da etapa de destino (ao mover). */
  campos?: Partial<Record<CampoEdicaoNegociacao | 'checklist', string[]>>
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

/** Valores gravados no formato do formulário já validado (para manter os campos "Não usar"). */
function valoresGravados(a: NegociacaoEdicao) {
  return {
    valor_estimado: a.valorEstimado === null ? null : a.valorEstimado.toFixed(2),
    temperatura: a.temperatura,
    data_primeira_reuniao: a.dataPrimeiraReuniao,
    data_proposta: a.dataProposta,
    valor_proposta: a.valorProposta === null ? null : a.valorProposta.toFixed(2),
    forma_pagamento: a.formaPagamento,
    objecao_principal: a.objecaoPrincipal,
    servico_ids: a.servicos.map((s) => s.id),
  }
}

/** Campos que a etapa atual não usa não aparecem no formulário: ficam como estão gravados. */
async function semApagarOcultos(dados: EdicaoNegociacaoInput, atual: NegociacaoEdicao): Promise<EdicaoNegociacaoInput> {
  const regras = await obterRegrasEtapas()
  return preservarOcultos(dados, valoresGravados(atual), camposVisiveis(regras[atual.etapaId]))
}

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

  const r = await salvarNegociacao(id, await semApagarOcultos(parsed.data, atual))
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
  | 'tipo_venda'

const CAMPOS_FECHAMENTO_TEXTO: CampoFechamentoTexto[] = [
  'valor_vendido',
  'data_fechamento',
  'contrato_enviado',
  'contrato_assinado',
  'link_contrato',
  'status_pagamento',
  'status_onboarding',
  'observacoes',
  'tipo_venda',
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

  // Mesmas regras do formulário, conferidas no servidor (e de novo no banco).
  const parsed = criarAtualizarFechamentoSchema(await obterRegrasComerciais()).safeParse({ negociacao_id: id, ...valores })
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await atualizarFechamento(parsed.data)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidatePath('/', 'layout')
  redirect(`/clientes/${clienteId}`)
}

// ---------------------------------------------------------------------------
// Edição rápida (modal do lápis, no Kanban) — mesmas regras de negócio das
// ações acima, mas sem `redirect`: o modal fecha sozinho (`ok: true`) e o
// Kanban resincroniza pelos `cards` que `revalidatePath('/funil')` renova.
// As ações com redirect acima continuam intocadas para a página /negociacoes/[id]/editar.
// ---------------------------------------------------------------------------

/** Dados da negociação pro modal — mesma DAL da página de edição, chamável do client. */
export async function obterNegociacaoEdicaoAction(id: string): Promise<NegociacaoEdicao | null> {
  if (!uuid.safeParse(id).success) return null
  return obterNegociacaoParaEdicao(id)
}

export type EstadoEdicaoRapidaNegociacao = EstadoFormNegociacao & { ok?: boolean }

export async function salvarNegociacaoRapidaAction(
  id: string,
  _estado: EstadoEdicaoRapidaNegociacao | undefined,
  formData: FormData,
): Promise<EstadoEdicaoRapidaNegociacao> {
  const valores = {
    ...Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, String(formData.get(c) ?? '')])),
    servico_ids: formData.getAll('servico_ids').map(String),
  } as Record<CampoTexto, string> & { servico_ids: string[] }

  if (!uuid.safeParse(id).success) {
    return { erro: 'Negociação inválida.', valores }
  }

  const atual = await obterNegociacaoParaEdicao(id)
  if (!atual) return { erro: 'Negociação não encontrada.', valores }
  if (negociacaoEncerrada(atual)) return { erro: NEGOCIACAO_ENCERRADA, valores }

  const parsed = edicaoNegociacaoSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await salvarNegociacao(id, await semApagarOcultos(parsed.data, atual))
  if (!r.ok) {
    return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
  }

  revalidatePath('/funil')
  return { ok: true, valores }
}

export type EstadoSalvarEMover = EstadoEdicaoRapidaNegociacao & {
  /** O banco recusou por exigências (de novo): o que falta agora. */
  requisitos?: RequisitosEtapa
  /** Itens do checklist marcados (devolvidos ao formulário quando falha). */
  confirmados?: string[]
}

const destinoSchema = z.object({ etapaId: z.uuid(), posicao: z.number().finite() })
const OBRIGATORIO_NA_ETAPA = 'Obrigatório para entrar nesta etapa.'
const CONFIRME_O_CHECKLIST = 'Confirme todos os itens para entrar nesta etapa.'

/**
 * Kanban: a etapa de destino tem exigências. Valida no servidor (obrigatórios
 * da etapa, checklist), salva e move numa transação só — o banco confere tudo
 * de novo (gatilho da etapa). Se algo faltar, nada é gravado e o formulário
 * continua com o que foi digitado.
 */
export async function salvarEMoverNegociacaoAction(
  id: string,
  destino: { etapaId: string; posicao: number },
  _estado: EstadoSalvarEMover | undefined,
  formData: FormData,
): Promise<EstadoSalvarEMover> {
  const valores = {
    ...Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, String(formData.get(c) ?? '')])),
    servico_ids: formData.getAll('servico_ids').map(String),
  } as Record<CampoTexto, string> & { servico_ids: string[] }
  const confirmados = formData.getAll('confirmacao').map(String)

  const d = destinoSchema.safeParse(destino)
  if (!uuid.safeParse(id).success || !d.success) return { erro: 'Negociação inválida.', valores, confirmados }

  const atual = await obterNegociacaoParaEdicao(id)
  if (!atual) return { erro: 'Negociação não encontrada.', valores, confirmados }
  if (negociacaoEncerrada(atual)) return { erro: NEGOCIACAO_ENCERRADA, valores, confirmados }

  const parsed = edicaoNegociacaoSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores, confirmados }

  const regras = await obterRegrasEtapas()
  const regraDestino = regras[d.data.etapaId]
  // O formulário mostrou os campos conforme a etapa de DESTINO; os demais ficam como estão.
  const dados = preservarOcultos(parsed.data, valoresGravados(atual), camposVisiveis(regras[atual.etapaId], regraDestino))

  const campos: Partial<Record<CampoEdicaoNegociacao | 'checklist', string[]>> = {}
  for (const c of camposFaltando(regraDestino, dados)) campos[CAMPO_FORMULARIO[c] as CampoEdicaoNegociacao] = [OBRIGATORIO_NA_ETAPA]
  const jaConfirmados = regraDestino?.checklist.length ? await itensJaConfirmados(id, d.data.etapaId) : []
  const faltaConfirmar = (regraDestino?.checklist ?? []).filter((i) => !confirmados.includes(i.id) && !jaConfirmados.includes(i.id))
  if (faltaConfirmar.length > 0) campos.checklist = [CONFIRME_O_CHECKLIST]
  if (Object.keys(campos).length > 0) return { campos, valores, confirmados }

  const r = await salvarEMoverNegociacao(id, dados, { ...d.data, confirmados })
  if (!r.ok) {
    if (r.requisitos) {
      // O banco é a última palavra (a regra pode ter mudado com o formulário aberto).
      const doBanco: typeof campos = {}
      for (const c of r.requisitos.campos) doBanco[CAMPO_FORMULARIO[c] as CampoEdicaoNegociacao] = [OBRIGATORIO_NA_ETAPA]
      if (r.requisitos.checklist.length > 0) doBanco.checklist = [CONFIRME_O_CHECKLIST]
      return { campos: doBanco, erro: descreverRequisitos(r.requisitos), requisitos: r.requisitos, valores, confirmados }
    }
    return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores, confirmados } : { erro: r.mensagem, valores, confirmados }
  }

  revalidatePath('/funil')
  return { ok: true, valores, confirmados }
}

export type EstadoEdicaoRapidaFechamento = EstadoFormFechamento & { ok?: boolean }

export async function atualizarFechamentoRapidoAction(
  id: string,
  _estado: EstadoEdicaoRapidaFechamento | undefined,
  formData: FormData,
): Promise<EstadoEdicaoRapidaFechamento> {
  const valores = {
    ...Object.fromEntries(CAMPOS_FECHAMENTO_TEXTO.map((c) => [c, String(formData.get(c) ?? '')])),
    servico_ids: formData.getAll('servico_ids').map(String),
  } as Record<CampoFechamentoTexto, string> & { servico_ids: string[] }

  if (!uuid.safeParse(id).success) {
    return { erro: 'Negociação inválida.', valores }
  }

  // Mesmas regras do formulário, conferidas no servidor (e de novo no banco).
  const parsed = criarAtualizarFechamentoSchema(await obterRegrasComerciais()).safeParse({ negociacao_id: id, ...valores })
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await atualizarFechamento(parsed.data)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidatePath('/funil')
  return { ok: true, valores }
}
