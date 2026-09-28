import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarEtapas } from '@/lib/dal/etapas'
import { DIAS_VISIVEIS_ENCERRADOS, listarCardsFunil } from '@/lib/dal/funil'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { COOKIE_FUNIL } from '@/lib/utils/preferencia-funil'

import { BarraFunil } from './_components/barra-funil'
import { Kanban } from './_components/kanban'

export const metadata: Metadata = {
  title: 'Funil',
}

/** Kanban operacional. As métricas ficam em /funil/metricas. */
export default async function FunilPage({ searchParams }: PageProps<'/funil'>) {
  const [usuario, cookieStore] = await Promise.all([getUsuarioAtual(), cookies()])
  const { funil: funilParam, responsavel, temperatura } = await searchParams

  const funilSelecionado = await resolverFunilSelecionado(funilParam, cookieStore.get(COOKIE_FUNIL)?.value)
  const funis = await listarFunis()

  const [cards, etapas] = await Promise.all([
    listarCardsFunil(funilSelecionado.id),
    listarEtapas(funilSelecionado.id),
  ])

  const responsaveis = [...new Set(cards.flatMap((c) => (c.responsavel ? [c.responsavel] : [])))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  )
  const cardsFiltrados = cards.filter(
    (c) =>
      (typeof responsavel !== 'string' || responsavel === '' || c.responsavel === responsavel) &&
      (typeof temperatura !== 'string' || temperatura === '' || c.temperatura === temperatura),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Funil</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {usuario.role === 'gerente' ? 'Negociações de toda a equipe.' : 'Suas negociações.'} Fechadas e
            perdidas aparecem por {DIAS_VISIVEIS_ENCERRADOS} dias.
          </p>
        </div>
        <Link href={`/funil/metricas?funil=${funilSelecionado.id}`} className={botaoSecundarioClass}>
          Ver métricas
        </Link>
      </div>

      <BarraFunil
        funis={funis}
        funilId={funilSelecionado.id}
        responsaveis={responsaveis}
        podeConfigurar={usuario.role === 'gerente'}
      />

      <Kanban
        cards={cardsFiltrados}
        etapas={etapas.map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo }))}
      />
    </div>
  )
}
