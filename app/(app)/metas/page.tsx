import type { Metadata } from 'next'
import Link from 'next/link'
import { Fragment } from 'react'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { CardsMetaFunil } from '@/components/metas/cards-meta-funil'
import { PremiumPanel } from '@/components/ui/premium'
import { removerMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  obterProgressoMetas,
  obterProgressoMetasFunis,
  type ProgressoFunilMeta,
  type ProgressoMetaTipo,
  type ProgressoPessoa,
  type TipoMeta,
} from '@/lib/dal/metas'
import { formatarData, formatarMoeda } from '@/lib/utils/formatacao'
import { lerMes, primeiroDiaDoMes, rotuloMes, ultimoDiaDoMes } from '@/lib/utils/periodo'
import { ALVO_EMPRESA, ROTULO_TIPO_META, TIPOS_META } from '@/lib/validations/meta'

import { FormMetasFunis } from './_components/form-metas-funis'
import { BarraProgresso, CardMeta, TextoPercentual } from './_components/progresso'
import { SeletorMes } from './_components/seletor-mes'

export const metadata: Metadata = {
  title: 'Metas',
}

/** Botão/link discreto, visual próprio desta tela (não o `botaoSecundarioClass` claro compartilhado). */
const botaoPremiumClass = 'rounded-md border border-premium-borda px-3 py-1.5 text-sm text-premium-secundario transition hover:border-premium-mudo/50 hover:text-premium-texto'

export default async function MetasPage({ searchParams }: PageProps<'/metas'>) {
  const eu = await getUsuarioAtual()
  const { mes: param, erro } = await searchParams
  const mes = lerMes(param)
  const [{ empresa, pessoas }, progressoFunis] = await Promise.all([
    obterProgressoMetas(mes),
    obterProgressoMetasFunis(mes),
  ])
  const gerente = eu.role === 'gerente'

  return (
    <div className="@container w-full space-y-6 text-premium-texto">
      <PageHeaderPremium
        titulo="Metas"
        subtitulo={`Vendas fechadas em ${rotuloMes(mes).toLowerCase()}, pela data de fechamento. Cada venda conta para quem era o responsável da negociação no momento do fechamento — nunca o dono atual da carteira.`}
        acoes={<SeletorMes mes={mes} variant="premium" />}
        usuario={eu}
      />
      <p className="-mt-3 text-sm font-medium text-premium-secundario">
        Período: {formatarData(primeiroDiaDoMes(mes))} → {formatarData(ultimoDiaDoMes(mes))}
      </p>

      {typeof erro === 'string' && (
        <p role="alert" className="rounded-md border border-red-900 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {erro}
        </p>
      )}

      {/*
        Visibilidade por papel (regra desta rodada — nunca por CSS, os dados
        já vêm restringidos do servidor, ver metas_progresso):
          GERENTE: Meta da empresa + Desempenho da equipe (todo mundo).
          CLOSER:  Meta da empresa + Minha meta (só a própria linha —
                   `pessoas` já chega do servidor sem a de nenhum colega).
          SDR:     Só Meta da empresa — `pessoas` já chega vazio pro SDR
                   (a RPC nunca devolve nenhuma linha individual pra ele),
                   então nem "Minha meta" nem a tabela fariam sentido aqui.
      */}
      {empresa && <SecaoMetaEmpresa empresa={empresa} mes={mes} podeGerenciar={gerente} />}

      <SecaoMetasFunis mes={mes} progresso={progressoFunis} gerente={gerente} />

      {eu.role === 'closer' && <MinhaMeta pessoa={pessoas.find((p) => p.usuarioId === eu.id)} />}

      {gerente && <TabelaPessoas pessoas={pessoas} mes={mes} />}
    </div>
  )
}

function SecaoMetaEmpresa({
  empresa,
  mes,
  podeGerenciar,
}: {
  empresa: NonNullable<Awaited<ReturnType<typeof obterProgressoMetas>>['empresa']>
  mes: string
  podeGerenciar: boolean
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-premium-secundario">Meta da empresa</h2>
      <p className="text-xs text-premium-mudo">Todos os funis, todos os responsáveis.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {TIPOS_META.map((tipo) => (
          <CardMeta
            key={tipo}
            titulo={ROTULO_TIPO_META[tipo]}
            valorMeta={empresa[tipo].valorMeta}
            realizado={empresa[tipo].realizado}
            percentual={empresa[tipo].percentual}
            semMeta="Não definida"
            acoes={
              podeGerenciar ? (
                <AcoesMeta metaId={empresa[tipo].metaId} alvo={ALVO_EMPRESA} tipo={tipo} mes={mes} />
              ) : undefined
            }
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Metas mensais por funil — só GERENTE vê o formulário de cadastro
 * (`FormMetasFunis`); SDR/CLOSER veem só os cards de progresso
 * (`CardsMetaFunil`, o MESMO componente usado em `/funil/metricas`, para as
 * duas telas nunca divergirem). Nada aqui distribui a meta geral: cada
 * funil tem sua própria meta cadastrada à parte (ver aviso de divergência
 * dentro de `MetaMensal`, em `/funil/metricas`).
 */
function SecaoMetasFunis({
  mes,
  progresso,
  gerente,
}: {
  mes: string
  progresso: ProgressoFunilMeta[]
  gerente: boolean
}) {
  if (progresso.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-premium-secundario">Metas mensais por funil</h2>
      <p className="text-xs text-premium-mudo">
        Cada funil tem sua própria meta de TCV e de MRR, cadastrada separadamente da meta geral.
      </p>
      {gerente && (
        <PremiumPanel>
          <FormMetasFunis mes={mes} progresso={progresso} />
        </PremiumPanel>
      )}
      <CardsMetaFunil progresso={progresso} />
    </section>
  )
}

function MinhaMeta({ pessoa }: { pessoa: ProgressoPessoa | undefined }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-premium-secundario">Minha meta</h2>
      <p className="text-xs text-premium-mudo">Todos os funis, só as suas vendas (responsável pelo fechamento).</p>
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
      <p className="rounded-lg border border-dashed border-premium-borda p-6 text-center text-sm text-premium-mudo">
        Nenhum closer ativo.
      </p>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-premium-secundario">Desempenho da equipe</h2>
      <div className="overflow-x-auto rounded-lg border border-premium-borda bg-premium-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-premium-borda bg-premium-bg/40 text-xs uppercase tracking-wide text-premium-mudo">
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
          <tbody className="divide-y divide-premium-borda">
            {pessoas.map((p) => (
              <tr key={p.usuarioId}>
                <td className="px-4 py-3">
                  <span className="font-medium text-premium-texto">{p.nome}</span>
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
      <td className="px-4 py-3 text-right tabular-nums text-premium-texto">
        {dados.valorMeta === null ? <span className="text-premium-mudo">Sem meta</span> : formatarMoeda(dados.valorMeta)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-premium-texto">{formatarMoeda(dados.realizado)}</td>
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
  return <span className="ml-2 rounded bg-premium-borda px-1.5 py-0.5 text-xs text-premium-secundario">{children}</span>
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
        <Link href={`/metas/nova?alvo=${alvo}&tipo=${tipo}&mes=${mes}`} className={botaoPremiumClass}>
          Definir {ROTULO_TIPO_META[tipo]}
        </Link>
      </span>
    ) : null
  }

  return (
    <span className="flex justify-end gap-2">
      <Link href={`/metas/${metaId}/editar`} className={botaoPremiumClass}>
        Editar {ROTULO_TIPO_META[tipo]}
      </Link>
      <form action={removerMetaAction.bind(null, metaId, mes)}>
        <button type="submit" className={`${botaoPremiumClass} text-red-400 hover:border-red-900 hover:text-red-300`}>
          Remover
        </button>
      </form>
    </span>
  )
}
