import type { Metadata } from 'next'

import { RedefinirSenhaForm } from './_components/redefinir-senha-form'

export const metadata: Metadata = {
  title: 'Redefinir senha',
}

/**
 * Só se chega aqui com uma sessão de recuperação válida (trocada pelo Route
 * Handler `app/auth/callback/route.ts`) — a rota não é pública no
 * `proxy.ts`, então sem essa sessão o próprio proxy já redireciona pro
 * login antes desta página renderizar.
 */
export default function RedefinirSenhaPage() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">Scorpion</p>
        <h1 className="mt-1 text-2xl font-semibold">Definir nova senha</h1>
      </div>

      <RedefinirSenhaForm />
    </div>
  )
}
