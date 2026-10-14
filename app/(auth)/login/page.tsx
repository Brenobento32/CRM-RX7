import type { Metadata } from 'next'

import { caminhoInternoSeguro } from '@/lib/utils/redirect'

import { LoginForm } from './_components/login-form'

export const metadata: Metadata = {
  title: 'Entrar',
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next, senha_redefinida: senhaRedefinida } = await searchParams

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Scorpion
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Entrar no CRM</h1>
      </div>

      {senhaRedefinida === '1' && (
        <p
          role="status"
          className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          Senha atualizada. Entre com sua nova senha.
        </p>
      )}

      <LoginForm next={caminhoInternoSeguro(next)} />
    </div>
  )
}
