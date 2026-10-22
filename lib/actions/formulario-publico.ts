'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

/**
 * Envio do formulário público RX7 (sem login). A empresa, o funil e a etapa
 * vêm da fonte no banco (`enviar_formulario_rx7`); o visitante só manda os
 * dados. `envio` é gerado na renderização: reenviar a mesma página não
 * duplica o lead. A isca (campo invisível) e o limite por minuto ficam no banco.
 */

const schema = z.object({
  fonte: z.uuid(),
  envio: z.uuid(),
  nome: z.string().trim().min(2, 'Informe seu nome.').max(200),
  telefone: z.string().trim().max(40),
  email: z.string().trim().max(200),
  empresa: z.string().trim().max(200),
  mensagem: z.string().trim().max(2000),
  site: z.string().max(500), // isca
})

function campo(formData: FormData, nome: string) {
  const v = formData.get(nome)
  return typeof v === 'string' ? v : ''
}

export async function enviarFormularioPublicoAction(formData: FormData): Promise<void> {
  const fonte = campo(formData, 'fonte')
  const destino = `/f/${encodeURIComponent(fonte)}`
  const parsed = schema.safeParse({
    fonte,
    envio: campo(formData, 'envio'),
    nome: campo(formData, 'nome'),
    telefone: campo(formData, 'telefone'),
    email: campo(formData, 'email'),
    empresa: campo(formData, 'empresa'),
    mensagem: campo(formData, 'mensagem'),
    site: campo(formData, 'site'),
  })
  if (!parsed.success) redirect(`${destino}?erro=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Dados inválidos.')}`)
  const d = parsed.data
  if (!d.telefone && !d.email) redirect(`${destino}?erro=${encodeURIComponent('Informe telefone ou e-mail.')}`)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('enviar_formulario_rx7', {
    p_fonte: d.fonte,
    p_envio: d.envio,
    p_nome: d.nome,
    p_telefone: d.telefone || null,
    p_email: d.email || null,
    p_empresa: d.empresa || null,
    p_mensagem: d.mensagem || null,
    p_isca: d.site || null,
  })
  if (error || data !== true) {
    redirect(`${destino}?erro=${encodeURIComponent('Não foi possível enviar agora. Confira telefone/e-mail e tente de novo.')}`)
  }
  redirect(`${destino}?enviado=1`)
}
