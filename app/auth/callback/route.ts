import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { destinoPublico } from '@/lib/utils/origem-publica'
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
 *
 * O destino é montado no domínio PÚBLICO (`destinoPublico`), nunca na origem
 * interna da requisição: na Hostinger ela é `0.0.0.0:3000`.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const destino = caminhoInternoSeguro(searchParams.get('next'), '/')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return redirecionar(destino)
    }
  }

  const aviso = new URLSearchParams({ erro: 'Link inválido ou expirado. Solicite uma nova recuperação de senha.' })
  return redirecionar(`/esqueci-senha?${aviso.toString()}`)
}

/** 307 para o destino público; relativo quando o domínio não está configurado. */
function redirecionar(caminho: string) {
  const alvo = destinoPublico(caminho)
  if (/^https?:\/\//.test(alvo)) return NextResponse.redirect(alvo)
  return new NextResponse(null, { status: 307, headers: { location: alvo } })
}
