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
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-xl font-semibold">Acesso indisponível</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Seu usuário está desativado ou ainda não foi configurado no CRM. Fale
        com o gerente responsável.
      </p>

      <form action={logout} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Sair
        </button>
      </form>
    </div>
  )
}
