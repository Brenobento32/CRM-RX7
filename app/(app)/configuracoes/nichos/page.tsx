import type { Metadata } from 'next'
import Link from 'next/link'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarNichosAtivos, listarNichosComUso } from '@/lib/dal/nichos'
import { PALETA_ETAPAS } from '@/lib/utils/etapas'

import { ListaNichosGerente } from './_components/lista-nichos-gerente'

export const metadata: Metadata = {
  title: 'Nichos',
}

/** Gerente: CRUD completo. Closer: só os ativos, leitura. */
export default async function NichosPage() {
  const eu = await getUsuarioAtual()
  const gerente = eu.role === 'gerente'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nichos</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {gerente
            ? 'Segmento de mercado do lead — a cor decide a borda do card no Kanban. Nicho já usado nunca é excluído: desative-o.'
            : 'Nichos disponíveis para os leads.'}
        </p>
      </div>

      {gerente ? <ListaNichosGerente nichos={await listarNichosComUso()} /> : <VisaoCloser />}
    </div>
  )
}

async function VisaoCloser() {
  const nichos = await listarNichosAtivos()
  if (nichos.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhum nicho cadastrado.</p>
  }

  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
      {nichos.map((n) => (
        <li key={n.id} className="flex items-center gap-2 px-4 py-3 text-sm">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: PALETA_ETAPAS[n.cor].hex }}
          />
          {n.nome}
        </li>
      ))}
    </ul>
  )
}
