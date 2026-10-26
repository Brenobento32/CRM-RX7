import type { Metadata } from 'next'

import { caixaErroClass } from '@/components/ui/estilos'
import { portalValido } from '@/lib/auth/portal'
import { EsqueciSenhaForm } from './_components/esqueci-senha-form'

export const metadata: Metadata = {
  title: 'Esqueci minha senha',
}

export default async function EsqueciSenhaPage({ searchParams }: PageProps<'/esqueci-senha'>) {
  const { erro, portal: portalBruto } = await searchParams
  const portal = portalValido(portalBruto)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-premium-texto">
          {portal === 'admin' ? 'Recuperar acesso da administração' : 'Esqueci minha senha'}
        </h1>
        <p className="mt-2 text-sm text-premium-secundario">
          Informe o e-mail cadastrado. Se ele existir no CRM, você recebe um link para redefinir a senha.
        </p>
      </div>

      {typeof erro === 'string' && (
        <p
          role="alert"
          className={`${caixaErroClass} mb-5`}
        >
          {erro}
        </p>
      )}

      <EsqueciSenhaForm portal={portal} />
    </div>
  )
}
