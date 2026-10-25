import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ROTULO_CARGO } from '@/lib/validations/usuario'
import { logout } from '@/lib/actions/auth'
import { listarMinhasEmpresas, papelComercial, resolverEnderecoAntigo } from '@/lib/dal/empresa'
import { isSuperAdmin } from '@/lib/dal/super-admin'
import { caminhoDaEmpresa, separarPrefixo } from '@/lib/empresa/rota'

export const metadata: Metadata = {
  title: 'Escolher empresa',
}

/** Destino interno seguro para depois da escolha (nunca externo, nunca outra empresa). */
function destinoSeguro(next: string | string[] | undefined): string {
  const valor = Array.isArray(next) ? next[0] : next
  if (!valor || !valor.startsWith('/') || valor.startsWith('//') || valor.includes('\\')) return '/'
  if (separarPrefixo(valor.split('?')[0])) return '/'
  return valor
}

/**
 * Escolha da empresa ativa. Lista só as empresas em que o usuário tem vínculo
 * ativo (RLS). A escolha vira a URL `/<slug>/...` — cada aba fica na sua
 * empresa e o banco revalida o vínculo em toda consulta. Os links são <a>:
 * trocar de empresa recarrega a página inteira.
 */
export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; de?: string | string[] }>
}) {
  const [empresas, { next, de }, superAdmin] = await Promise.all([listarMinhasEmpresas(), searchParams, isSuperAdmin()])
  const destino = destinoSeguro(next)

  // Veio de um endereço antigo (a empresa trocou de slug): vai para o novo,
  // na mesma tela. Quem não é membro não descobre nada e segue a escolha normal.
  const novoEndereco = await resolverEnderecoAntigo(Array.isArray(de) ? de[0] : de)
  if (novoEndereco) redirect(caminhoDaEmpresa(novoEndereco, destino))

  const ativas = empresas.filter((e) => !e.somenteLeitura)
  // Super Admin sempre vê a lista (e o link do painel), mesmo com uma empresa só.
  if (!superAdmin && (empresas.length === 1 || (ativas.length === 1 && destino !== '/'))) {
    redirect(caminhoDaEmpresa((ativas[0] ?? empresas[0]).slug, destino))
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-xl font-semibold">Escolha a empresa</h1>

      {empresas.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Seu usuário ainda não foi vinculado a nenhuma empresa. Fale com o
          administrador responsável.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {empresas.map((empresa) => (
            <li key={empresa.slug}>
              <a
                href={caminhoDaEmpresa(empresa.slug, destino)}
                className="block rounded-md border border-zinc-300 px-4 py-3 transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <span className="block text-sm font-medium">{empresa.nome}</span>
                <span className="block text-xs text-zinc-500">
                  {ROTULO_CARGO[papelComercial(empresa.papel)]}
                  {empresa.somenteLeitura ? ' · somente leitura' : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {superAdmin && (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- painel fora das empresas, navegação completa
        <a href="/admin" className="mt-6 block rounded-md border border-zinc-300 px-4 py-2.5 text-center text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Painel Super Admin
        </a>
      )}

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
