import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { definirAtivoServicoAction, excluirServicoAction } from '@/lib/actions/servicos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  listarServicosAtivos,
  listarServicosComUso,
  type Servico,
  type ServicoComUso,
} from '@/lib/dal/servicos'

export const metadata: Metadata = {
  title: 'Serviços',
}

/** Gerente: ativos e desativados, com ações. Closer: só ativos, leitura. */
export default async function ServicosPage({ searchParams }: PageProps<'/configuracoes/servicos'>) {
  const eu = await getUsuarioAtual()
  const gerente = eu.role === 'gerente'

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
            ← Configurações
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Serviços</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {gerente
              ? 'Catálogo usado nas negociações. Serviço já usado não é excluído: desative-o.'
              : 'Serviços disponíveis para as negociações.'}
          </p>
        </div>
        {gerente && (
          <Link href="/configuracoes/servicos/novo" className={botaoPrimarioClass}>
            Novo serviço
          </Link>
        )}
      </div>

      {gerente ? <VisaoGerente erro={(await searchParams).erro} /> : <VisaoCloser />}
    </div>
  )
}

async function VisaoCloser() {
  const servicos = await listarServicosAtivos()
  if (servicos.length === 0) return <Vazio>Nenhum serviço cadastrado.</Vazio>

  return (
    <Tabela colunas={['Serviço', 'Categoria']}>
      {servicos.map((s) => (
        <tr key={s.id}>
          <CelulaNome servico={s} />
          <CelulaCategoria servico={s} />
        </tr>
      ))}
    </Tabela>
  )
}

async function VisaoGerente({ erro }: { erro: string | string[] | undefined }) {
  const servicos = await listarServicosComUso()
  const ativos = servicos.filter((s) => s.ativo)
  const inativos = servicos.filter((s) => !s.ativo)

  return (
    <>
      {typeof erro === 'string' && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      {ativos.length === 0 ? <Vazio>Nenhum serviço ativo.</Vazio> : <TabelaGerente servicos={ativos} />}

      {inativos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Desativados</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Fora da escolha em negociações novas, mas mantidos nas negociações que já os usam.
          </p>
          <TabelaGerente servicos={inativos} />
        </section>
      )}
    </>
  )
}

function TabelaGerente({ servicos }: { servicos: ServicoComUso[] }) {
  return (
    <Tabela colunas={['Serviço', 'Categoria', 'Negociações', '']}>
      {servicos.map((s) => (
        <tr key={s.id} className={s.ativo ? undefined : 'text-zinc-400'}>
          <CelulaNome servico={s} />
          <CelulaCategoria servico={s} />
          <td className="px-4 py-3 text-right tabular-nums">{s.negociacoes}</td>
          <td className="px-4 py-3">
            <span className="flex justify-end gap-2">
              <Link href={`/configuracoes/servicos/${s.id}/editar`} className={botaoSecundarioClass}>
                Editar
              </Link>
              <form action={definirAtivoServicoAction.bind(null, s.id, !s.ativo)}>
                <button type="submit" className={botaoSecundarioClass}>
                  {s.ativo ? 'Desativar' : 'Reativar'}
                </button>
              </form>
              {s.negociacoes === 0 ? (
                <form action={excluirServicoAction.bind(null, s.id)}>
                  <button type="submit" className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}>
                    Excluir
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Usado em negociações: desative em vez de excluir."
                  className={`${botaoSecundarioClass} cursor-not-allowed opacity-50`}
                >
                  Excluir
                </button>
              )}
            </span>
          </td>
        </tr>
      ))}
    </Tabela>
  )
}

function Tabela({ colunas, children }: { colunas: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            {colunas.map((c, i) => (
              <th key={i} className={`px-4 py-3 font-medium ${c === 'Negociações' ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</tbody>
      </table>
    </div>
  )
}

function CelulaNome({ servico }: { servico: Servico }) {
  return <td className="px-4 py-3 font-medium">{servico.nome}</td>
}

function CelulaCategoria({ servico }: { servico: Servico }) {
  return <td className="px-4 py-3">{servico.categoria ?? <span className="text-zinc-400">—</span>}</td>
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {children}
    </p>
  )
}
