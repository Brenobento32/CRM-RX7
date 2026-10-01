'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { salvarConfiguracaoWhatsapp } from '@/lib/dal/whatsapp'
import { configuracaoWhatsappSchema } from '@/lib/validations/whatsapp'

const PAGINA = '/configuracoes/whatsapp'

export type EstadoConfiguracaoWhatsapp = {
  erro?: string
  campos?: Record<string, string[] | undefined>
  valores?: Record<string, unknown>
}

export async function salvarConfiguracaoWhatsappAction(
  _estado: EstadoConfiguracaoWhatsapp | undefined,
  formData: FormData,
): Promise<EstadoConfiguracaoWhatsapp> {
  const valores = {
    funilId: String(formData.get('funil_id') ?? ''),
    responsavelPadraoId: String(formData.get('responsavel_padrao_id') ?? ''),
  }
  const parsed = configuracaoWhatsappSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await salvarConfiguracaoWhatsapp(parsed.data)
  if (!r.ok) return { erro: r.mensagem, valores }

  revalidatePath(PAGINA)
  redirect(`${PAGINA}?salvo=1`)
}
