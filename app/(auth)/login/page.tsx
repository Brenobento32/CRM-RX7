import type { Metadata } from 'next'

import { Aviso } from '@/components/ui/aviso'
import { caminhoInternoSeguro } from '@/lib/utils/redirect'

import { LoginForm } from './_components/login-form'

export const metadata: Metadata = {
  title: 'Entrar',
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next, senha_redefinida: senhaRedefinida } = await searchParams

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-premium-texto">Entrar no AVANTE</h1>
        <p className="mt-1.5 text-sm text-premium-secundario">Use o e-mail e a senha cadastrados pela sua empresa.</p>
      </div>

      {senhaRedefinida === '1' && (
        <div className="mb-5">
          <Aviso tom="sucesso">Senha atualizada. Entre com sua nova senha.</Aviso>
        </div>
      )}

      <LoginForm next={caminhoInternoSeguro(next)} />
    </div>
  )
}
