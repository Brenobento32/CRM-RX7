import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarEtapas } from '@/lib/dal/etapas'
import { DIAS_VISIVEIS_ENCERRADOS, listarCardsFunil } from '@/lib/dal/funil'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { obterPermissoesFunil } from '@/lib/dal/permissoes'
import { listarServicosAtivos } from '@/lib/dal/servicos'
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

  if (!funilSelecionado) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Funil</h1>
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Você ainda não tem acesso a nenhum funil. Peça ao gerente para configurar suas permissões.
        </p>
      </div>
    )
  }

  const [cards, etapas, servicos] = await Promise.all([
    listarCardsFunil(funilSelecionado.id),
    listarEtapas(funilSelecionado.id),
    listarServicosAtivos(),
  ])
  const permissoes = await obterPermissoesFunil(
    funilSelecionado.id,
    etapas.map((e) => e.id),
  )

  const responsaveis = [...new Set(cards.flatMap((c) => (c.responsavel ? [c.responsavel] : [])))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  )
  const cardsFiltrados = cards.filter(
    (c) =>
      (typeof responsavel !== 'string' || responsavel === '' || c.responsavel === responsavel) &&
      (typeof temperatura !== 'string' || temperatura === '' || c.temperatura === temperatura),
  )

  // Coluna aparece se o gerente vê tudo OU se há permissão de ver
  // configurada para aquela etapa — owner_id não entra aqui. Nenhum card
  // chega em `cardsFiltrados` fora de uma etapa visível: a RLS de
  // `negociacoes` já filtra pela mesma regra (`pode_ver_etapa`).
  const etapasVisiveis =
    usuario.role === 'gerente' ? new Set(etapas.map((e) => e.id)) : permissoes.etapasVisiveis
  const etapasExibidas = etapas.filter((e) => etapasVisiveis.has(e.id))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{funilSelecionado.nome}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {usuario.role === 'gerente'
              ? 'Negociações de toda a equipe.'
              : 'Negociações das etapas liberadas pelo gerente.'}{' '}
            Fechadas e perdidas aparecem por {DIAS_VISIVEIS_ENCERRADOS} dias.
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
        etapas={etapasExibidas.map(({ id, nome, cor, tipo, etapaInicial, ordem, chave }) => ({
          id,
          nome,
          cor,
          tipo,
          etapaInicial,
          ordem,
          chave,
        }))}
        papel={usuario.role}
        etapasMovimentaveis={usuario.role === 'gerente' ? null : [...permissoes.etapasMovimentaveis]}
        servicos={servicos}
        whatsappHabilitado={funilSelecionado.whatsappHabilitado}
      />
    </div>
  )
}
