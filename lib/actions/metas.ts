'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { criarMeta, editarMeta, removerMeta, salvarMetasFunis, type ItemMetaFunil, type ResultadoMeta } from '@/lib/dal/metas'
import { obterProgressoReunioes, salvarMetasReunioes, type ItemMetaReunioes } from '@/lib/dal/metas-reunioes'
import { mesValido } from '@/lib/utils/periodo'
import { criarMetaSchema, editarMetaSchema, TIPOS_META, valorMetaFunil, type CampoMeta } from '@/lib/validations/meta'
import { quantidadeMetaReunioes } from '@/lib/validations/meta-reunioes'

export type EstadoFormMeta = {
  erro?: string
  campos?: Partial<Record<CampoMeta, string[]>>
  valores?: Partial<Record<CampoMeta, string>>
}

const uuid = z.uuid()

/** Volta para a tela de metas no mês em que se estava. */
function lista(mes?: string) {
  return mesValido(mes) ? `/metas?mes=${mes}` : '/metas'
}

function comoEstado(r: Extract<ResultadoMeta, { ok: false }>, valores: EstadoFormMeta['valores']) {
  return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
}

export async function criarMetaAction(
  _estado: EstadoFormMeta | undefined,
  formData: FormData,
): Promise<EstadoFormMeta> {
  const valores = {
    alvo: String(formData.get('alvo') ?? ''),
    tipo_meta: String(formData.get('tipo_meta') ?? ''),
    mes: String(formData.get('mes') ?? ''),
    valor_meta: String(formData.get('valor_meta') ?? ''),
  }
  const parsed = criarMetaSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarMeta(parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidatePath('/metas')
  redirect(lista(parsed.data.mes))
}

export async function editarMetaAction(
  id: string,
  mes: string,
  _estado: EstadoFormMeta | undefined,
  formData: FormData,
): Promise<EstadoFormMeta> {
  const valores = { valor_meta: String(formData.get('valor_meta') ?? '') }
  if (!uuid.safeParse(id).success) return { erro: 'Meta inválida.', valores }

  const parsed = editarMetaSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await editarMeta(id, parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidatePath('/metas')
  redirect(lista(mes))
}

/** Botão da lista. Falha volta com a mensagem na URL (funciona sem JS). */
export async function removerMetaAction(id: string, mes: string): Promise<void> {
  if (!uuid.safeParse(id).success) return

  const r = await removerMeta(id)
  revalidatePath('/metas')
  if (!r.ok) {
    const destino = lista(mes)
    redirect(`${destino}${destino.includes('?') ? '&' : '?'}erro=${encodeURIComponent(r.mensagem)}`)
  }
}

/**
 * Formulário único "Metas mensais por funil" — um campo TCV e um campo MRR
 * por funil (nomes `tcv_<funilId>`/`mrr_<funilId>`), UM botão, UMA operação
 * atômica: tudo salva ou nada salva, nunca parcial.
 *
 * Por isso a validação é toda feita AQUI, localmente, ANTES de qualquer
 * chamada ao banco: percorre os campos preenchidos, valida cada um, e só
 * chama `salvarMetasFunis` (⇒ UMA chamada à RPC `salvar_metas_funis`,
 * transação única) se TODOS os campos preenchidos forem válidos. Se
 * qualquer um for inválido, a função retorna sem tocar o banco — nenhum
 * campo é salvo, nem os que viriam antes dele no formulário.
 *
 * `funis` vem do Server Component (lista já carregada pela página,
 * `.bind(null, mes, funis)`), nunca da própria requisição — não dá para
 * confiar em "quais funis existem" vindo do cliente. Campo vazio = não
 * altera aquela meta (nunca zera/remove, nunca entra no payload da RPC).
 */
export async function salvarMetasFunisAction(
  mes: string,
  funis: { id: string; nome: string }[],
  formData: FormData,
): Promise<void> {
  if (!mesValido(mes)) redirect('/metas')

  const itens: ItemMetaFunil[] = []
  const mensagens: string[] = []

  for (const funil of funis) {
    for (const tipo of TIPOS_META) {
      const bruto = String(formData.get(`${tipo}_${funil.id}`) ?? '')
      const parsed = valorMetaFunil.safeParse(bruto)
      if (!parsed.success) {
        mensagens.push(`${funil.nome} (${tipo.toUpperCase()}): ${z.flattenError(parsed.error).formErrors[0] ?? 'valor inválido.'}`)
        continue
      }
      if (parsed.data === null) continue // campo vazio: não altera esta meta

      itens.push({ funilId: funil.id, tipoMeta: tipo, valorMeta: Number(parsed.data) })
    }
  }

  const destino = `/metas?mes=${mes}`

  // Qualquer campo inválido: aborta ANTES de chamar o banco. Nenhum item
  // (nem os válidos) é salvo — é exatamente o "tudo ou nada" do pedido.
  if (mensagens.length > 0) {
    redirect(`${destino}&erro=${encodeURIComponent(mensagens.join(' '))}`)
  }

  if (itens.length === 0) redirect(destino) // nada preenchido: não há o que salvar, não é erro.

  const r = await salvarMetasFunis(mes, itens)

  revalidatePath('/metas')
  if (!r.ok) {
    redirect(`${destino}&erro=${encodeURIComponent(r.mensagem)}`)
  }
  redirect(destino)
}

/**
 * Metas de reuniões dos SDRs no mês (só Gerente). A lista de SDRs e os
 * valores atuais vêm do servidor (`obterProgressoReunioes`), nunca do
 * formulário. Campo vazio = mantém o valor atual; tudo é gravado num único
 * upsert (tudo ou nada).
 */
export async function salvarMetasReunioesAction(mes: string, formData: FormData): Promise<void> {
  if (!mesValido(mes)) redirect('/metas')
  const destino = `/metas?mes=${mes}`

  const sdrs = await obterProgressoReunioes(mes)
  const itens: ItemMetaReunioes[] = []
  const mensagens: string[] = []

  for (const sdr of sdrs) {
    const ag = quantidadeMetaReunioes.safeParse(String(formData.get(`agendadas_${sdr.usuarioId}`) ?? ''))
    const re = quantidadeMetaReunioes.safeParse(String(formData.get(`realizadas_${sdr.usuarioId}`) ?? ''))
    if (!ag.success) mensagens.push(`${sdr.nome} (agendadas): ${ag.error.issues[0]?.message ?? 'valor inválido.'}`)
    if (!re.success) mensagens.push(`${sdr.nome} (realizadas): ${re.error.issues[0]?.message ?? 'valor inválido.'}`)
    if (!ag.success || !re.success) continue
    if (ag.data === null && re.data === null) continue // nada preenchido para este SDR

    itens.push({
      usuarioId: sdr.usuarioId,
      metaAgendadas: ag.data ?? sdr.agendadas.meta,
      metaRealizadas: re.data ?? sdr.realizadas.meta,
    })
  }

  if (mensagens.length > 0) redirect(`${destino}&erro=${encodeURIComponent(mensagens.join(' '))}`)
  if (itens.length === 0) redirect(destino)

  const r = await salvarMetasReunioes(mes, itens)
  revalidatePath('/metas')
  if (!r.ok) redirect(`${destino}&erro=${encodeURIComponent(r.mensagem)}`)
  redirect(destino)
}
