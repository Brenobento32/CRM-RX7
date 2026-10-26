import type { Metadata } from 'next'

import { destinoAdminSeguro } from '@/lib/auth/portal'
import { acessoAdmin } from '@/lib/dal/super-admin'

import { ListaEmpresas } from './_components/lista-empresas'
import { PainelAdmin } from './_components/painel-admin'
import { AcessoRestritoAdmin, LoginAdminTela } from './_components/portal-admin'

export async function generateMetadata(): Promise<Metadata> {
  const acesso = await acessoAdmin()
  return { title: acesso === 'admin' ? 'Empresas' : acesso === 'negado' ? 'Acesso restrito' : 'Entrar' }
}

type Busca = Promise<Record<string, string | string[] | undefined>>

/**
 * Entrada do portal da administração. A decisão vem do banco
 * (`acessoAdmin` → `is_super_admin`), nunca da URL:
 * - sem sessão: login administrativo (com o destino `next` só dentro de /admin);
 * - logado sem o privilégio global (inclusive Gerente): acesso restrito;
 * - Super Admin: painel global, começando pelas empresas.
 */
export default async function AdminPage({ searchParams }: { searchParams: Busca }) {
  const [acesso, params] = await Promise.all([acessoAdmin(), searchParams])

  if (acesso === 'anonimo') {
    return <LoginAdminTela next={destinoAdminSeguro(params.next)} senhaRedefinida={params.senha_redefinida === '1'} />
  }
  if (acesso === 'negado') return <AcessoRestritoAdmin />

  return (
    <PainelAdmin>
      <ListaEmpresas params={params} />
    </PainelAdmin>
  )
}
