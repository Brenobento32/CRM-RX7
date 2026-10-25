'use server'

import { redirect } from 'next/navigation'

/**
 * Integração com o Google Calendar desligada (agenda nativa). As actions
 * continuam exportadas para que um formulário antigo aberto no navegador
 * não quebre, mas recusam no servidor — nada é conectado nem desconectado.
 * Conexão, tokens e histórico ficam intactos no banco.
 */
export async function conectarGoogleAction(): Promise<void> {
  redirect('/agenda?erro=' + encodeURIComponent('A integração com o Google Calendar está desativada.'))
}

export async function desconectarGoogleAction(): Promise<void> {
  redirect('/agenda?erro=' + encodeURIComponent('A integração com o Google Calendar está desativada.'))
}
