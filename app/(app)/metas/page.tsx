import type { Metadata } from 'next'
import Link from 'next/link'
import { Fragment } from 'react'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { removerMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  obterProgressoMetas,
  type ProgressoMetaTipo,
  type ProgressoPessoa,
  type TipoMeta,
} from '@/lib/dal/metas'
import { formatarData, formatarMoeda } from '@/lib/utils/formatacao'
import { lerMes, primeiroDiaDoMes, rotuloMes, ultimoDiaDoMes } from '@/lib/utils/periodo'
import { ALVO_EMPRESA, ROTULO_TIPO_META, TIPOS_META } from '@/lib/validations/meta'

import { BarraProgresso, CardMeta, TextoPercentual } from './_components/progresso'
import { SeletorMes } from './_components/seletor-mes'

export const metadata: Metadata = {
  title: 'Metas',
}

export default async function MetasPage({ searchParams }: PageProps<'/metas'>) {
  const eu = await getUsuarioAtual()
  const { mes: param, erro } = await searchParams
  const mes = lerMes(param)
  const { empresa, pessoas } = await obterProgressoMetas(mes)
  const gerente = eu.role === 'gerente'

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Metas</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Vendas fechadas em {rotuloMes(mes).toLowerCase()}, pela data de fechamento. Cada venda conta
            para quem era o responsável da negociação no momento do fechamento
            (<code>fechamentos.responsavel_id</code>) — nunca o dono atual da carteira.
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Período: {formatarData(primeiroDiaDoMes(mes))} → {formatarData(ultimoDiaDoMes(mes))}
          </p>
        </div>
        <SeletorMes mes={mes} />
      </div>

      {typeof erro === 'string' && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      {gerente ? (
        <>
          {empresa && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Meta da empresa</h2>
              <p className="text-xs text-zinc-500">Todos os funis, todos os responsáveis.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {TIPOS_META.map((tipo) => (
                  <CardMeta
                    key={tipo}
                    titulo={ROTULO_TIPO_META[tipo]}
                    valorMeta={empresa[tipo].valorMeta}
                    realizado={empresa[tipo].realizado}
                    percentual={empresa[tipo].percentual}
                    semMeta="Não definida"
                    acoes={<AcoesMeta metaId={empresa[tipo].metaId} alvo={ALVO_EMPRESA} tipo={tipo} mes={mes} />}
                  />
                ))}
              </div>
            </section>
          )}
          <TabelaPessoas pessoas={pessoas} mes={mes} />
        </>
      ) : (
        <MinhaMeta pessoa={pessoas.find((p) => p.usuarioId === eu.id)} />
      )}
    </div>
  )
}

function MinhaMeta({ pessoa }: { pessoa: ProgressoPessoa | undefined }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Minha meta</h2>
      <p className="text-xs text-zinc-500">Todos os funis, só as suas vendas (responsável pelo fechamento).</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {TIPOS_META.map((tipo) => (
          <CardMeta
            key={tipo}
            titulo={ROTULO_TIPO_META[tipo]}
            valorMeta={pessoa?.[tipo].valorMeta ?? null}
            realizado={pessoa?.[tipo].realizado ?? 0}
            percentual={pessoa?.[tipo].percentual ?? null}
            semMeta="Nenhuma meta definida para este mês"
          />
        ))}
      </div>
    </section>
  )
}

function TabelaPessoas({ pessoas, mes }: { pessoas: ProgressoPessoa[]; mes: string }) {
  if (pessoas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Nenhum closer ativo.
      </p>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Por closer</h2>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium" rowSpan={2}>
                Closer
              </th>
              {TIPOS_META.map((tipo) => (
                <th key={tipo} className="px-4 py-2 text-center font-medium" colSpan={3}>
                  {ROTULO_TIPO_META[tipo]}
                </th>
              ))}
              <th className="px-4 py-3" rowSpan={2} />
            </tr>
            <tr>
              {TIPOS_META.map((tipo) => (
                <Fragment key={tipo}>
                  <th className="px-4 py-1.5 text-right font-medium">Meta</th>
                  <th className="px-4 py-1.5 text-right font-medium">Vendido</th>
                  <th className="px-4 py-1.5 font-medium">Atingido</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pessoas.map((p) => (
              <tr key={p.usuarioId}>
                <td className="px-4 py-3">
                  <span className="font-medium">{p.nome}</span>
                  {p.role !== 'closer' && <Etiqueta>gerente</Etiqueta>}
                  {!p.ativo && <Etiqueta>desativado</Etiqueta>}
                </td>
                {TIPOS_META.map((tipo) => (
                  <LinhaTipo key={tipo} dados={p[tipo]} nome={p.nome} />
                ))}
                <td className="px-4 py-3">
                  {/* Meta individual só para closer ativo; as demais linhas só mostram o vendido. */}
                  {p.role === 'closer' && (p.ativo || p.tcv.metaId || p.mrr.metaId) && (
                    <div className="flex flex-col items-end gap-1">
                      {TIPOS_META.map((tipo) => (
                        <AcoesMeta
                          key={tipo}
                          metaId={p[tipo].metaId}
                          alvo={p.usuarioId}
                          tipo={tipo}
                          mes={mes}
                          podeCriar={p.ativo}
                        />
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function LinhaTipo({ dados, nome }: { dados: ProgressoMetaTipo; nome: string }) {
  return (
    <>
      <td className="px-4 py-3 text-right tabular-nums">
        {dados.valorMeta === null ? <span className="text-zinc-400">Sem meta</span> : formatarMoeda(dados.valorMeta)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{formatarMoeda(dados.realizado)}</td>
      <td className="px-4 py-3">
        <div className="flex min-w-36 items-center gap-3">
          <div className="flex-1">
            <BarraProgresso percentual={dados.percentual} rotulo={`Progresso de ${nome}`} />
          </div>
          <span className="w-14 text-right tabular-nums">
            <TextoPercentual percentual={dados.percentual} />
          </span>
        </div>
      </td>
    </>
  )
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </span>
  )
}

/** Sem meta: "Definir [TCV/MRR]". Com meta: "Editar" e "Remover". */
function AcoesMeta({
  metaId,
  alvo,
  tipo,
  mes,
  podeCriar = true,
}: {
  metaId: string | null
  alvo: string
  tipo: TipoMeta
  mes: string
  podeCriar?: boolean
}) {
  if (!metaId) {
    return podeCriar ? (
      <span className="flex justify-end">
        <Link href={`/metas/nova?alvo=${alvo}&tipo=${tipo}&mes=${mes}`} className={botaoSecundarioClass}>
          Definir {ROTULO_TIPO_META[tipo]}
        </Link>
      </span>
    ) : null
  }

  return (
    <span className="flex justify-end gap-2">
      <Link href={`/metas/${metaId}/editar`} className={botaoSecundarioClass}>
        Editar {ROTULO_TIPO_META[tipo]}
      </Link>
      <form action={removerMetaAction.bind(null, metaId, mes)}>
        <button type="submit" className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}>
          Remover
        </button>
      </form>
    </span>
  )
}
