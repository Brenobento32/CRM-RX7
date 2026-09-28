import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { botaoPrimarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarFunisComUso } from '@/lib/dal/funis'

export const metadata: Metadata = {
  title: 'Funis',
}

export default async function FunisPage({ searchParams }: PageProps<'/configuracoes/funis'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { erro } = await searchParams
  const funis = await listarFunisComUso()

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
            ← Configurações
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Funis</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Cada funil tem etapas, ordem e cores próprias. O Funil Principal é o padrão do sistema.
          </p>
        </div>
        <Link href="/configuracoes/funis/novo" className={botaoPrimarioClass}>
          Novo funil
        </Link>
      </div>

      {typeof erro === 'string' && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {funis.map((f) => (
          <li key={f.id}>
            <Link
              href={`/configuracoes/funis/${f.id}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {f.nome}
                  {f.padrao && (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      padrão
                    </span>
                  )}
                  {!f.ativo && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      desativado
                    </span>
                  )}
                </p>
                {f.descricao && <p className="text-sm text-zinc-600 dark:text-zinc-400">{f.descricao}</p>}
              </div>
              <span className="text-sm tabular-nums text-zinc-500">
                {f.negociacoesAtuais} {f.negociacoesAtuais === 1 ? 'negociação' : 'negociações'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
