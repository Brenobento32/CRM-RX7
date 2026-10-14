import type { Metadata } from 'next'

import { EsqueciSenhaForm } from './_components/esqueci-senha-form'

export const metadata: Metadata = {
  title: 'Esqueci minha senha',
}

export default async function EsqueciSenhaPage({ searchParams }: PageProps<'/esqueci-senha'>) {
  const { erro } = await searchParams

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">Scorpion</p>
        <h1 className="mt-1 text-2xl font-semibold">Esqueci minha senha</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Informe o e-mail cadastrado. Se ele existir no CRM, você recebe um link para redefinir a senha.
        </p>
      </div>

      {typeof erro === 'string' && (
        <p
          role="alert"
          className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      <EsqueciSenhaForm />
    </div>
  )
}
