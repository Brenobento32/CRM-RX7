import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import {
  definirAtivoEtapaAction,
  excluirEtapaAction,
  moverEtapaAction,
} from '@/lib/actions/etapas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarEtapasComUso, type EtapaComUso } from '@/lib/dal/etapas'
import { ROTULO_TIPO_ETAPA } from '@/lib/utils/etapas'

export const metadata: Metadata = {
  title: 'Etapas do funil',
}

const botaoIcone =
  'rounded-md border border-zinc-300 px-2 py-1 text-xs transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800'

export default async function EtapasPage({ searchParams }: PageProps<'/configuracoes/etapas'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { erro } = await searchParams
  const etapas = await listarEtapasComUso()

  // Posições possíveis de uma personalizada: as abertas ativas antes de
  // Negociação. Ela só sobe/desce dentro dessa faixa.
  const negociacao = etapas.find((e) => e.chave === 'negociacao')
  const faixa = etapas.filter(
    (e) => e.ativo && e.tipo === 'aberta' && negociacao && e.ordem < negociacao.ordem,
  )

  const ativas = etapas.filter((e) => e.ativo)
  const inativas = etapas.filter((e) => !e.ativo)

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
            ← Configurações
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Etapas do funil</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Na ordem das colunas do Kanban. Etapas personalizadas ficam sempre antes de Negociação.
          </p>
        </div>
        <Link href="/configuracoes/etapas/nova" className={botaoPrimarioClass}>
          Nova etapa
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

      <TabelaEtapas etapas={ativas} faixa={faixa} />

      {inativas.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Desativadas</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Fora do Kanban, mas mantidas no histórico das negociações que passaram por elas.
          </p>
          <TabelaEtapas etapas={inativas} faixa={faixa} />
        </section>
      )}
    </div>
  )
}

function TabelaEtapas({ etapas, faixa }: { etapas: EtapaComUso[]; faixa: EtapaComUso[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-3 font-medium">Etapa</th>
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 text-right font-medium">Negociações</th>
            <th className="px-4 py-3 font-medium">Posição</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {etapas.map((e) => {
            const i = faixa.findIndex((f) => f.id === e.id)
            const podeMover = !e.sistema && e.ativo && i >= 0
            return (
              <tr key={e.id} className={e.ativo ? undefined : 'text-zinc-400'}>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 font-medium">
                    <PontoEtapa cor={e.cor} />
                    {e.nome}
                    {e.sistema && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        padrão
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">{ROTULO_TIPO_ETAPA[e.tipo]}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.negociacoesAtuais}</td>
                <td className="px-4 py-3">
                  {podeMover ? (
                    <span className="flex gap-1">
                      <form action={moverEtapaAction.bind(null, e.id, 'cima')}>
                        <button
                          type="submit"
                          disabled={i === 0}
                          aria-label={`Subir ${e.nome}`}
                          className={botaoIcone}
                        >
                          ↑
                        </button>
                      </form>
                      <form action={moverEtapaAction.bind(null, e.id, 'baixo')}>
                        <button
                          type="submit"
                          disabled={i === faixa.length - 1}
                          aria-label={`Descer ${e.nome}`}
                          title={i === faixa.length - 1 ? 'Etapas personalizadas ficam antes de Negociação' : undefined}
                          className={botaoIcone}
                        >
                          ↓
                        </button>
                      </form>
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">{e.sistema ? 'Fixa' : '—'}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="flex justify-end gap-2">
                    <Link href={`/configuracoes/etapas/${e.id}/editar`} className={botaoSecundarioClass}>
                      {e.sistema ? 'Cor' : 'Editar'}
                    </Link>
                    {!e.sistema && <AcaoRemover etapa={e} />}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Nunca usada: excluir. Já teve negociação: desativar (o histórico continua
 * apontando para ela). Com negociações agora: nenhum dos dois — o botão fica
 * desabilitado e diz por quê.
 */
function AcaoRemover({ etapa }: { etapa: EtapaComUso }) {
  if (!etapa.ativo) {
    return (
      <form action={definirAtivoEtapaAction.bind(null, etapa.id, true)}>
        <button type="submit" className={botaoSecundarioClass}>
          Reativar
        </button>
      </form>
    )
  }

  if (etapa.negociacoesAtuais > 0) {
    return (
      <button
        type="button"
        disabled
        title="Mova as negociações desta etapa antes de desativá-la."
        className={`${botaoSecundarioClass} cursor-not-allowed opacity-50`}
      >
        {etapa.jaUsada ? 'Desativar' : 'Excluir'}
      </button>
    )
  }

  if (etapa.jaUsada) {
    return (
      <form action={definirAtivoEtapaAction.bind(null, etapa.id, false)}>
        <button type="submit" className={botaoSecundarioClass} title="Já teve negociações: fica no histórico.">
          Desativar
        </button>
      </form>
    )
  }

  return (
    <form action={excluirEtapaAction.bind(null, etapa.id)}>
      <button type="submit" className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}>
        Excluir
      </button>
    </form>
  )
}
