import type { Metadata } from 'next'
import Link from 'next/link'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import {
  excluirClienteAction,
  restaurarClienteAction,
  restaurarClienteExcluidoAction,
} from '@/lib/actions/clientes'
import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  CLIENTES_POR_PAGINA,
  listarClientes,
  type OrigemFiltroCliente,
  type StatusCliente,
} from '@/lib/dal/clientes'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { formatarTelefone } from '@/lib/utils/documentos'
import { ROTULO_TIPO_CLIENTE } from '@/lib/validations/cliente'

import { BuscaClientes } from './_components/busca-clientes'

export const metadata: Metadata = {
  title: 'Clientes',
}

const ABAS: { valor: StatusCliente; rotulo: string }[] = [
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'arquivados', rotulo: 'Arquivados' },
  { valor: 'excluidos', rotulo: 'Excluídos' },
]

/**
 * "Outbound", nesta arquitetura, É `origem = 'manual'` — não existe um
 * valor de enum "outbound" à parte (`origem_negociacao` só tem
 * `formulario`/`whatsapp`/`manual`, confirmado no banco). WhatsApp não
 * ganha aba própria ainda, só aparece no resumo de origem de cada linha.
 */
const ABAS_ORIGEM: { valor: OrigemFiltroCliente; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'inbound', rotulo: 'Inbound' },
  { valor: 'outbound', rotulo: 'Outbound' },
]

export default async function ClientesPage({
  searchParams,
}: PageProps<'/clientes'>) {
  const [usuario, empresa] = await Promise.all([getUsuarioAtual(), getEmpresaAtual()])
  const params = await searchParams

  const busca = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const pagina = Math.max(1, Number.parseInt(String(params.pagina ?? '1'), 10) || 1)
  const aba: StatusCliente =
    params.aba === 'arquivados' ? 'arquivados' : params.aba === 'excluidos' ? 'excluidos' : 'ativos'
  const origemFiltro: OrigemFiltroCliente =
    params.origem === 'inbound' ? 'inbound' : params.origem === 'outbound' ? 'outbound' : 'todos'

  const { clientes, total } = await listarClientes({ busca, pagina, status: aba, origemFiltro })
  const totalPaginas = Math.max(1, Math.ceil(total / CLIENTES_POR_PAGINA))
  const gerente = usuario.role === 'gerente'
  const arquivados = aba === 'arquivados'
  const excluidos = aba === 'excluidos'
  const temAcoes = arquivados || excluidos
  // Nem arquivado nem excluído abre a página do cliente: obterCliente só enxerga ativos.
  const nomeAbrePagina = aba === 'ativos'

  const hrefPagina = (p: number) => {
    const qs = new URLSearchParams()
    if (busca) qs.set('q', busca)
    if (aba !== 'ativos') qs.set('aba', aba)
    if (origemFiltro !== 'todos') qs.set('origem', origemFiltro)
    if (p > 1) qs.set('pagina', String(p))
    const s = qs.toString()
    return s ? `/clientes?${s}` : '/clientes'
  }

  const hrefAba = (valor: StatusCliente) => {
    const qs = new URLSearchParams()
    if (busca) qs.set('q', busca)
    if (valor !== 'ativos') qs.set('aba', valor)
    if (origemFiltro !== 'todos') qs.set('origem', origemFiltro)
    const s = qs.toString()
    return s ? `/clientes?${s}` : '/clientes'
  }

  const hrefOrigem = (valor: OrigemFiltroCliente) => {
    const qs = new URLSearchParams()
    if (busca) qs.set('q', busca)
    if (aba !== 'ativos') qs.set('aba', aba)
    if (valor !== 'todos') qs.set('origem', valor)
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
        {/* Empresa somente leitura (arquivo): o banco recusa a gravação; a tela nem oferece. */}
        {empresa.somenteLeitura ? null : (
          <Link
            href="/clientes/novo"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-premium-acento px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-950"
          >
            Novo cliente
          </Link>
        )}
      </div>

      <nav className="flex gap-1" aria-label="Origem">
        {ABAS_ORIGEM.map((a) => (
          <Link
            key={a.valor}
            href={hrefOrigem(a.valor)}
            aria-current={origemFiltro === a.valor ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
              origemFiltro === a.valor
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-label="Status do cliente">
        {ABAS.map((a) => (
          <Link
            key={a.valor}
            href={hrefAba(a.valor)}
            aria-current={aba === a.valor ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              aba === a.valor
                ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      <div className="max-w-md">
        <BuscaClientes valorInicial={busca} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Contato</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              {gerente && <th className="px-4 py-3 font-medium">Carteira</th>}
              {temAcoes && <th className="px-4 py-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {clientes.map((c) => (
              <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <td className="px-4 py-3">
                  {nomeAbrePagina ? (
                    <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                      {c.nome}
                    </Link>
                  ) : (
                    <span className="font-medium">{c.nome}</span>
                  )}
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
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.origens}</td>
                {gerente && (
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {c.dono ?? '—'}
                  </td>
                )}
                {arquivados && (
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={restaurarClienteAction.bind(null, c.id)}>
                        <button
                          type="submit"
                          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Restaurar
                        </button>
                      </form>
                      <form action={excluirClienteAction.bind(null, c.id)} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          name="motivo"
                          required
                          placeholder="Motivo da exclusão"
                          aria-label={`Motivo da exclusão de ${c.nome}`}
                          className="w-40 rounded-md border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        <BotaoConfirmar
                          pergunta="Excluir este cliente? O histórico de negociações e fechamentos não é apagado, mas ele some de Ativos e Arquivados."
                          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          Excluir
                        </BotaoConfirmar>
                      </form>
                    </div>
                  </td>
                )}
                {excluidos && (
                  <td className="px-4 py-3">
                    <form action={restaurarClienteExcluidoAction.bind(null, c.id)}>
                      <button
                        type="submit"
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Restaurar
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {clientes.length === 0 && (
              <tr>
                <td
                  colSpan={(gerente ? 6 : 5) + (temAcoes ? 1 : 0)}
                  className="px-4 py-10 text-center text-zinc-500"
                >
                  {busca
                    ? `Nenhum cliente encontrado para “${busca}”.`
                    : arquivados
                      ? 'Nenhum cliente arquivado.'
                      : excluidos
                        ? 'Nenhum cliente excluído.'
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
