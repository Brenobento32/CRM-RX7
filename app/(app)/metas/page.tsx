import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { removerMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterProgressoMetas, type ProgressoPessoa } from '@/lib/dal/metas'
import { formatarMoeda } from '@/lib/utils/formatacao'
import { lerMes, rotuloMes } from '@/lib/utils/periodo'
import { ALVO_EMPRESA } from '@/lib/validations/meta'

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
            para o responsável pela negociação quando ela foi fechada.
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
            <CardMeta
              titulo="Meta da empresa"
              valorMeta={empresa.valorMeta}
              realizado={empresa.realizado}
              percentual={empresa.percentual}
              semMeta="Não definida"
              acoes={<AcoesMeta metaId={empresa.metaId} alvo={ALVO_EMPRESA} mes={mes} />}
            />
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
    <CardMeta
      titulo="Sua meta"
      valorMeta={pessoa?.valorMeta ?? null}
      realizado={pessoa?.realizado ?? 0}
      percentual={pessoa?.percentual ?? null}
      semMeta="Nenhuma meta definida para este mês"
    />
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
              <th className="px-4 py-3 font-medium">Closer</th>
              <th className="px-4 py-3 text-right font-medium">Meta</th>
              <th className="px-4 py-3 text-right font-medium">Vendido</th>
              <th className="px-4 py-3 font-medium">Atingido</th>
              <th className="px-4 py-3" />
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
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.valorMeta === null ? <span className="text-zinc-400">Sem meta</span> : formatarMoeda(p.valorMeta)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatarMoeda(p.realizado)}</td>
                <td className="px-4 py-3">
                  <div className="flex min-w-36 items-center gap-3">
                    <div className="flex-1">
                      <BarraProgresso percentual={p.percentual} rotulo={`Progresso de ${p.nome}`} />
                    </div>
                    <span className="w-14 text-right tabular-nums">
                      <TextoPercentual percentual={p.percentual} />
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {/* Meta individual só para closer ativo; as demais linhas só mostram o vendido. */}
                  {p.role === 'closer' && (p.ativo || p.metaId) && (
                    <AcoesMeta metaId={p.metaId} alvo={p.usuarioId} mes={mes} podeCriar={p.ativo} />
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

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </span>
  )
}

/** Sem meta: "Definir". Com meta: "Editar" e "Remover". */
function AcoesMeta({
  metaId,
  alvo,
  mes,
  podeCriar = true,
}: {
  metaId: string | null
  alvo: string
  mes: string
  podeCriar?: boolean
}) {
  if (!metaId) {
    return podeCriar ? (
      <span className="flex justify-end">
        <Link href={`/metas/nova?alvo=${alvo}&mes=${mes}`} className={botaoSecundarioClass}>
          Definir meta
        </Link>
      </span>
    ) : null
  }

  return (
    <span className="flex justify-end gap-2">
      <Link href={`/metas/${metaId}/editar`} className={botaoSecundarioClass}>
        Editar
      </Link>
      <form action={removerMetaAction.bind(null, metaId, mes)}>
        <button type="submit" className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}>
          Remover
        </button>
      </form>
    </span>
  )
}
