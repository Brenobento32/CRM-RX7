import type { Metadata } from 'next'

import { caminhoInternoSeguro } from '@/lib/utils/redirect'

import { LoginForm } from './_components/login-form'

export const metadata: Metadata = {
  title: 'Entrar',
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next } = await searchParams

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Scorpion
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Entrar no CRM</h1>
      </div>

      <LoginForm next={caminhoInternoSeguro(next)} />
    </div>
  )
}
