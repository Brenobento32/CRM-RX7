import type { Metadata } from 'next'

import { logout } from '@/lib/actions/auth'

export const metadata: Metadata = {
  title: 'Acesso indisponível',
}

/**
 * Destino de quem tem sessão válida no Supabase mas não pode usar o CRM
 * (profile desativado ou inexistente). Fica fora da área interna para não
 * entrar em loop com o redirect do layout autenticado.
 */
export default function SemAcessoPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-premium-texto">Acesso indisponível</h1>
      <p className="mt-2 text-sm text-premium-secundario">
        Seu usuário está desativado ou ainda não foi configurado no CRM. Fale
        com o gerente responsável.
      </p>

      <form action={logout} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-md border border-premium-borda px-4 py-2.5 text-sm font-medium transition hover:bg-premium-bg"
        >
          Sair
        </button>
      </form>
    </div>
  )
}
