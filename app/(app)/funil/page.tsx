import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarEtapas } from '@/lib/dal/etapas'
import { DIAS_VISIVEIS_ENCERRADOS, listarCardsFunil } from '@/lib/dal/funil'
import { listarConversaoFunil } from '@/lib/dal/funil-conversao'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { listarServicosAtivos } from '@/lib/dal/servicos'
import { COOKIE_FUNIL } from '@/lib/utils/preferencia-funil'

import { BarraFunil } from './_components/barra-funil'
import { BoxConversao } from './_components/box-conversao'
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

  const [cards, etapas, servicos] = await Promise.all([
    listarCardsFunil(funilSelecionado.id),
    listarEtapas(funilSelecionado.id),
    listarServicosAtivos(),
  ])
  const conversao = await listarConversaoFunil(funilSelecionado.id, etapas)

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
          <h1 className="text-2xl font-semibold">{funilSelecionado.nome}</h1>
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

      <BoxConversao etapas={etapas} conversao={conversao} />

      <Kanban
        cards={cardsFiltrados}
        etapas={etapas.map(({ id, nome, cor, tipo, etapaInicial }) => ({ id, nome, cor, tipo, etapaInicial }))}
        servicos={servicos}
        whatsappHabilitado={funilSelecionado.whatsappHabilitado}
      />
    </div>
  )
}
