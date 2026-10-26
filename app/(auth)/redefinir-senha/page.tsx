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
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-premium-texto">Definir nova senha</h1>
      </div>

      <RedefinirSenhaForm />
    </div>
  )
}
