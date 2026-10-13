import Link from 'next/link'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import {
  definirAtivoEtapaAction,
  definirEtapaInicialAction,
  excluirEtapaAction,
  moverEtapaAction,
} from '@/lib/actions/etapas'
import type { EtapaComUso } from '@/lib/dal/etapas'
import { ROTULO_TIPO_ETAPA } from '@/lib/utils/etapas'

const botaoIcone =
  'rounded-md border border-zinc-300 px-2 py-1 text-xs transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800'

/**
 * Lista de etapas de um funil. `faixaPipeline`/`faixaRecuperacao` são as
 * abertas ativas de cada zona que podem trocar de posição entre si (antes ou
 * depois do fechamento do funil) — quem calcula isso é a página, que já sabe
 * onde ficam os dois limites.
 */
export function TabelaEtapas({
  funilId,
  etapas,
  faixaPipeline,
  faixaRecuperacao,
}: {
  funilId: string
  etapas: EtapaComUso[]
  faixaPipeline: EtapaComUso[]
  faixaRecuperacao: EtapaComUso[]
}) {
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
            const faixa = e.posFechamento ? faixaRecuperacao : faixaPipeline
            const i = faixa.findIndex((f) => f.id === e.id)
            const podeMover = !e.sistema && e.ativo && i >= 0
            const tituloDescer = e.posFechamento
              ? 'Etapa de recuperação já é a última do funil'
              : 'Etapas de fluxo comercial ficam antes do fechamento'
            const tituloSubir = e.posFechamento ? 'Etapa de recuperação já é a primeira depois do fechamento' : undefined
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
                    {e.posFechamento && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                        recuperação
                      </span>
                    )}
                    {e.etapaInicial && (
                      <span
                        title="Leads automáticos (formulário) e reativação de lead arquivado entram por aqui"
                        className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-normal text-sky-700 dark:bg-sky-950 dark:text-sky-400"
                      >
                        inicial
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">{ROTULO_TIPO_ETAPA[e.tipo]}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.negociacoesAtuais}</td>
                <td className="px-4 py-3">
                  {podeMover ? (
                    <span className="flex gap-1">
                      <form action={moverEtapaAction.bind(null, funilId, e.id, 'cima')}>
                        <button
                          type="submit"
                          disabled={i === 0}
                          aria-label={`Subir ${e.nome}`}
                          title={i === 0 ? tituloSubir : undefined}
                          className={botaoIcone}
                        >
                          ↑
                        </button>
                      </form>
                      <form action={moverEtapaAction.bind(null, funilId, e.id, 'baixo')}>
                        <button
                          type="submit"
                          disabled={i === faixa.length - 1}
                          aria-label={`Descer ${e.nome}`}
                          title={i === faixa.length - 1 ? tituloDescer : undefined}
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
                    {e.tipo === 'aberta' && e.ativo && !e.etapaInicial && (
                      <form action={definirEtapaInicialAction.bind(null, funilId, e.id)}>
                        <button
                          type="submit"
                          title="Leads automáticos e reativação passam a entrar por esta etapa"
                          className={botaoSecundarioClass}
                        >
                          Definir inicial
                        </button>
                      </form>
                    )}
                    <Link href={`/configuracoes/funis/${funilId}/etapas/${e.id}/editar`} className={botaoSecundarioClass}>
                      {e.sistema ? 'Cor' : 'Editar'}
                    </Link>
                    {!e.sistema && <AcaoRemover funilId={funilId} etapa={e} />}
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
function AcaoRemover({ funilId, etapa }: { funilId: string; etapa: EtapaComUso }) {
  if (!etapa.ativo) {
    return (
      <form action={definirAtivoEtapaAction.bind(null, funilId, etapa.id, true)}>
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
      <form action={definirAtivoEtapaAction.bind(null, funilId, etapa.id, false)}>
        <button type="submit" className={botaoSecundarioClass} title="Já teve negociações: fica no histórico.">
          Desativar
        </button>
      </form>
    )
  }

  return (
    <form action={excluirEtapaAction.bind(null, funilId, etapa.id)}>
      <button type="submit" className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}>
        Excluir
      </button>
    </form>
  )
}
