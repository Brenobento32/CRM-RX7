import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarUsuarioAction } from '@/lib/actions/usuarios'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { coresEmUso } from '@/lib/dal/usuarios'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

import { UsuarioForm } from '../_components/usuario-form'

export const metadata: Metadata = {
  title: 'Novo usuário',
}

export default async function NovoUsuarioPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const cores = await coresEmUso()

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium titulo="Novo usuário" subtitulo="O acesso é liberado na hora, sem e-mail de confirmação."
        voltar={{ href: '/configuracoes/usuarios', rotulo: 'Usuários' }}
      />

      <Secao>
        <UsuarioForm modo="criar" action={criarUsuarioAction} valoresIniciais={{ role: 'closer' }} coresEmUso={cores} />
      </Secao>
    </div>
  )
}
