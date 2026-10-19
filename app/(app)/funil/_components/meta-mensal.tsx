import Link from 'next/link'

import type { ProgressoEmpresa } from '@/lib/dal/metas'
import type { RealizadoFunil } from '@/lib/dal/funil-metricas'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'
import { rotuloMes } from '@/lib/utils/periodo'

/**
 * Meta MENSAL — mês cheio, navegável pelo PRÓPRIO seletor (`seletorMes`,
 * independente do seletor de período operacional abaixo —
 * `SeletorPeriodoFunil`): essas são duas perguntas diferentes ("a empresa
 * bateu a meta de outubro?" vs. "como foi a conversão nos últimos 7
 * dias?"), cada uma com seu próprio mês/período, nunca compartilhando o
 * mesmo número. `progresso` vem de `obterProgressoMetas(mes)` — EXATAMENTE
 * a mesma função (e a mesma RPC `metas_progresso`, mês inteiro, sem
 * `metaProporcionalPeriodo`) que já alimenta `/metas`; nenhuma lógica nova
 * de meta foi criada aqui, só reaproveitada.
 *
 * "Meta por funil" é só o REALIZADO mensal de cada funil (TCV/MRR) — o
 * banco não tem meta por funil (`metas` não tem `funil_id`; auditado nesta
 * rodada), então nunca se inventa uma meta por funil dividindo a meta
 * total. Quando/se uma meta por funil for aprovada, entra aqui.
 */
export function MetaMensal({
  mes,
  progresso,
  porFunil,
  seletorMes,
}: {
  /** AAAA-MM do mês de referência — o que `seletorMes` tem selecionado agora. */
  mes: string
  progresso: ProgressoEmpresa | null
  porFunil: { nome: string; realizado: RealizadoFunil }[]
  /** `<SeletorMes caminhoBase="/funil/metricas?...&" nomeParametro="mesMeta" mes={mes} />` — próprio, nunca o período operacional. */
  seletorMes: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Meta mensal — {rotuloMes(mes)}</h2>
          <p className="text-xs text-zinc-500">
            Mês inteiro, nunca proporcional — todos os funis, todos os responsáveis. Independe do período de análise
            selecionado abaixo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {seletorMes}
          <Link href="/metas" className="text-sm text-zinc-500 hover:underline">
            Gerenciar metas →
          </Link>
        </div>
      </div>

      {progresso ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardMetaMensal titulo="TCV" dados={progresso.tcv} />
          <CardMetaMensal titulo="MRR" dados={progresso.mrr} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Nenhuma meta da empresa visível para o seu papel.</p>
      )}

      <div className="space-y-2 border-t border-dashed border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Realizado mensal por funil <span className="font-normal text-zinc-400">— meta por funil ainda não definida</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {porFunil.map(({ nome, realizado }) => (
            <div key={nome} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <p className="font-medium">{nome}</p>
              <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-zinc-500">TCV realizado</dt>
                <dd className="text-right tabular-nums">{formatarMoeda(realizado.tcv)}</dd>
                <dt className="text-zinc-500">MRR realizado</dt>
                <dd className="text-right tabular-nums">{formatarMoeda(realizado.mrr)}</dd>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CardMetaMensal({ titulo, dados }: { titulo: string; dados: ProgressoEmpresa['tcv'] }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="font-semibold">{titulo}</p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Meta mensal</dt>
          <dd className="font-medium tabular-nums">
            {dados.valorMeta === null ? <span className="text-zinc-400">Não definida</span> : formatarMoeda(dados.valorMeta)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Realizado</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(dados.realizado)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Atingido</dt>
          <dd className="font-medium tabular-nums">
            {dados.percentual === null ? <span className="text-zinc-400">—</span> : formatarPercentual(dados.percentual)}
          </dd>
        </div>
      </dl>
    </div>
  )
}
