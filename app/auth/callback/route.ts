import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { caminhoInternoSeguro } from '@/lib/utils/redirect'

/**
 * Troca o `code` do link de recuperação de senha (ou de qualquer outro fluxo
 * de e-mail do Supabase Auth) por uma sessão de verdade, gravada em cookies.
 *
 * Nenhum token passa pela aplicação: `exchangeCodeForSession` fala direto com
 * o Supabase Auth e devolve só a confirmação (erro ou sessão). Depois disso,
 * `next` (sempre `/redefinir-senha` neste fluxo, mas validado do mesmo jeito
 * que o `?next=` do login — a URL pode ser forjada) decide onde a pessoa cai
 * com a sessão já ativa.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const destino = caminhoInternoSeguro(searchParams.get('next'), '/')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(destino, origin))
    }
  }

  const erro = new URL('/esqueci-senha', origin)
  erro.searchParams.set('erro', 'Link inválido ou expirado. Solicite uma nova recuperação de senha.')
  return NextResponse.redirect(erro)
}
