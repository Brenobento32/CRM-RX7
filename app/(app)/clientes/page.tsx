import type { Metadata } from 'next'
import Link from 'next/link'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { CLIENTES_POR_PAGINA, listarClientes } from '@/lib/dal/clientes'
import { formatarTelefone } from '@/lib/utils/documentos'
import { ROTULO_TIPO_CLIENTE } from '@/lib/validations/cliente'

export const metadata: Metadata = {
  title: 'Clientes',
}

export default async function ClientesPage({
  searchParams,
}: PageProps<'/clientes'>) {
  const usuario = await getUsuarioAtual()
  const params = await searchParams

  const busca = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const pagina = Math.max(1, Number.parseInt(String(params.pagina ?? '1'), 10) || 1)

  const { clientes, total } = await listarClientes({ busca, pagina })
  const totalPaginas = Math.max(1, Math.ceil(total / CLIENTES_POR_PAGINA))
  const gerente = usuario.role === 'gerente'

  const hrefPagina = (p: number) => {
    const qs = new URLSearchParams()
    if (busca) qs.set('q', busca)
    if (p > 1) qs.set('pagina', String(p))
    const s = qs.toString()
    return s ? `/clientes?${s}` : '/clientes'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {gerente ? 'Todos os clientes da equipe.' : 'Sua carteira de clientes.'}
          </p>
        </div>
        <Link
          href="/clientes/novo"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Novo cliente
        </Link>
      </div>

      <form action="/clientes" className="flex max-w-md gap-2" role="search">
        <input
          type="search"
          name="q"
          defaultValue={busca}
          placeholder="Buscar por nome, empresa, e-mail, CPF/CNPJ, telefone…"
          aria-label="Buscar clientes"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Buscar
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Contato</th>
              {gerente && <th className="px-4 py-3 font-medium">Carteira</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {clientes.map((c) => (
              <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <td className="px-4 py-3">
                  <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                    {c.nome}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {c.empresa ?? '—'}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {ROTULO_TIPO_CLIENTE[c.tipo_cliente]}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {c.whatsapp
                    ? formatarTelefone(c.whatsapp)
                    : c.telefone
                      ? formatarTelefone(c.telefone)
                      : (c.email ?? '—')}
                </td>
                {gerente && (
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {c.dono ?? '—'}
                  </td>
                )}
              </tr>
            ))}
            {clientes.length === 0 && (
              <tr>
                <td
                  colSpan={gerente ? 5 : 4}
                  className="px-4 py-10 text-center text-zinc-500"
                >
                  {busca
                    ? `Nenhum cliente encontrado para “${busca}”.`
                    : 'Nenhum cliente cadastrado ainda.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            {total} {total === 1 ? 'cliente' : 'clientes'}
          </span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-2">
              {pagina > 1 && (
                <Link href={hrefPagina(pagina - 1)} className="rounded-md px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Anterior
                </Link>
              )}
              <span>
                Página {pagina} de {totalPaginas}
              </span>
              {pagina < totalPaginas && (
                <Link href={hrefPagina(pagina + 1)} className="rounded-md px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Próxima
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
