import type { Metadata } from 'next'
import Link from 'next/link'
import { Fragment } from 'react'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { CardsMetaFunil } from '@/components/metas/cards-meta-funil'
import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoSecundarioClass, caixaErroClass, tabelaCaixaClass, theadClass, tbodyClass, botaoPerigoClass } from '@/components/ui/estilos'
import { PremiumPanel } from '@/components/ui/premium'
import { removerMetaAction } from '@/lib/actions/metas'
import { exigirCargo } from '@/lib/dal/auth'
import { CARGOS_POR_AREA } from '@/lib/validations/usuario'
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

import { obterProgressoReunioes } from '@/lib/dal/metas-reunioes'
import { obterRegrasComerciais } from '@/lib/dal/regras-comerciais'
import { tiposVisiveis } from '@/lib/utils/regras-comerciais'

import { FormMetasFunis } from './_components/form-metas-funis'
import { CARGOS_COM_METAS_DE_REUNIOES, SecaoMetasReunioes } from './_components/metas-reunioes'
import { BarraProgresso, CardMeta, TextoPercentual } from './_components/progresso'
import { SeletorMes } from './_components/seletor-mes'

export const metadata: Metadata = {
  title: 'Metas',
}

const botaoPremiumClass = botaoSecundarioClass

export default async function MetasPage({ searchParams }: PageProps<'/metas'>) {
  const [eu, regras] = await Promise.all([exigirCargo(CARGOS_POR_AREA.metas), obterRegrasComerciais()])
  const { mes: param, erro } = await searchParams
  const mes = lerMes(param)

  // Menu desligado pelo Super Admin: a página não mostra metas (o banco também recusa gravar).
  if (!regras.metasAtivo) {
    return (
      <div className="@container w-full space-y-6 text-premium-texto">
        <PageHeaderPremium titulo="Metas" usuario={eu} />
        <p className="rounded-lg border border-dashed border-premium-borda p-6 text-center text-sm text-premium-mudo">
          O menu Metas não está disponível para esta empresa. As metas já cadastradas continuam guardadas.
        </p>
      </div>
    )
  }
  const veReunioes = (CARGOS_COM_METAS_DE_REUNIOES as readonly string[]).includes(eu.role)
  const [{ empresa, pessoas }, progressoFunis, reunioes] = await Promise.all([
    obterProgressoMetas(mes),
    obterProgressoMetasFunis(mes),
    veReunioes ? obterProgressoReunioes(mes) : Promise.resolve([]),
  ])
  const gerente = eu.role === 'gerente'
  const temMetaIndividual = eu.role === 'closer' || eu.role === 'vendedor'
  // Tipos liberados para a empresa + qualquer outro que já tenha meta ou venda neste mês (histórico nunca some).
  const comDados = TIPOS_META.filter((t) =>
    [empresa, ...pessoas, ...progressoFunis].some((x) => x && (x[t].valorMeta !== null || x[t].realizado > 0)),
  )
  const tipos = tiposVisiveis(regras.tiposVenda, comDados)
  const liberados = regras.tiposVenda

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
        <p role="alert" className={caixaErroClass}>
          {erro}
        </p>
      )}

      {/*
        Visibilidade por papel (regra desta rodada — nunca por CSS, os dados
        já vêm restringidos do servidor, ver metas_progresso):
          GERENTE: Meta da empresa + Desempenho da equipe (todo mundo).
          CLOSER/VENDEDOR: Meta da empresa + Minha meta (só a própria linha —
                   `pessoas` já chega do servidor sem a de nenhum colega).
          SDR:     Meta da empresa + Minhas metas de reuniões — `pessoas` chega vazio pro SDR
                   (a RPC nunca devolve nenhuma linha individual pra ele),
                   então nem "Minha meta" nem a tabela fariam sentido aqui.
      */}
      {empresa && <SecaoMetaEmpresa empresa={empresa} mes={mes} podeGerenciar={gerente} tipos={tipos} liberados={liberados} />}

      <SecaoMetasFunis mes={mes} progresso={progressoFunis} gerente={gerente} tipos={tipos} liberados={liberados} />

      {temMetaIndividual && <MinhaMeta pessoa={pessoas.find((p) => p.usuarioId === eu.id)} tipos={tipos} />}

      {gerente && <TabelaPessoas pessoas={pessoas} mes={mes} tipos={tipos} liberados={liberados} />}

      {veReunioes && <SecaoMetasReunioes mes={mes} sdrs={reunioes} gerente={gerente} euId={eu.id} />}
    </div>
  )
}

function SecaoMetaEmpresa({
  empresa,
  mes,
  podeGerenciar,
  tipos,
  liberados,
}: {
  empresa: NonNullable<Awaited<ReturnType<typeof obterProgressoMetas>>['empresa']>
  mes: string
  podeGerenciar: boolean
  tipos: readonly TipoMeta[]
  liberados: readonly TipoMeta[]
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-premium-secundario">Meta da empresa</h2>
      <p className="text-xs text-premium-mudo">Todos os funis, todos os responsáveis.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tipos.map((tipo) => (
          <CardMeta
            key={tipo}
            titulo={ROTULO_TIPO_META[tipo]}
            valorMeta={empresa[tipo].valorMeta}
            realizado={empresa[tipo].realizado}
            percentual={empresa[tipo].percentual}
            semMeta="Não definida"
            acoes={
              podeGerenciar ? (
                <AcoesMeta metaId={empresa[tipo].metaId} alvo={ALVO_EMPRESA} tipo={tipo} mes={mes} podeCriar={liberados.includes(tipo)} />
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
  tipos,
  liberados,
}: {
  mes: string
  progresso: ProgressoFunilMeta[]
  gerente: boolean
  tipos: readonly TipoMeta[]
  liberados: readonly TipoMeta[]
}) {
  if (progresso.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-premium-secundario">Metas mensais por funil</h2>
      <p className="text-xs text-premium-mudo">
        Cada funil tem sua própria meta por tipo ({tipos.map((t) => ROTULO_TIPO_META[t]).join(', ')}), cadastrada separadamente da meta geral.
      </p>
      {gerente && (
        <PremiumPanel>
          <FormMetasFunis mes={mes} progresso={progresso} tipos={liberados} />
        </PremiumPanel>
      )}
      <CardsMetaFunil progresso={progresso} tipos={tipos} />
    </section>
  )
}

function MinhaMeta({ pessoa, tipos }: { pessoa: ProgressoPessoa | undefined; tipos: readonly TipoMeta[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-premium-secundario">Minha meta</h2>
      <p className="text-xs text-premium-mudo">Todos os funis, só as suas vendas (responsável pelo fechamento).</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tipos.map((tipo) => (
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

function TabelaPessoas({
  pessoas,
  mes,
  tipos,
  liberados,
}: {
  pessoas: ProgressoPessoa[]
  mes: string
  tipos: readonly TipoMeta[]
  liberados: readonly TipoMeta[]
}) {
  if (pessoas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-premium-borda p-6 text-center text-sm text-premium-mudo">
        Nenhum closer ou vendedor ativo.
      </p>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-premium-secundario">Desempenho da equipe</h2>
      <div className={tabelaCaixaClass}>
        <table className="w-full text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3 font-medium" rowSpan={2}>
                Pessoa
              </th>
              {tipos.map((tipo) => (
                <th key={tipo} className="px-4 py-2 text-center font-medium" colSpan={3}>
                  {ROTULO_TIPO_META[tipo]}
                </th>
              ))}
              <th className="px-4 py-3" rowSpan={2} />
            </tr>
            <tr>
              {tipos.map((tipo) => (
                <Fragment key={tipo}>
                  <th className="px-4 py-1.5 text-right font-medium">Meta</th>
                  <th className="px-4 py-1.5 text-right font-medium">Vendido</th>
                  <th className="px-4 py-1.5 font-medium">Atingido</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {pessoas.map((p) => (
              <tr key={p.usuarioId}>
                <td className="px-4 py-3">
                  <span className="font-medium text-premium-texto">{p.nome}</span>
                  {p.role === 'vendedor' && <Etiqueta>vendedor</Etiqueta>}
                  {p.role === 'gerente' && <Etiqueta>gerente</Etiqueta>}
                  {!p.ativo && <Etiqueta>desativado</Etiqueta>}
                </td>
                {tipos.map((tipo) => (
                  <LinhaTipo key={tipo} dados={p[tipo]} nome={p.nome} />
                ))}
                <td className="px-4 py-3">
                  {/* Meta individual só para closer/vendedor ativo; as demais linhas só mostram o vendido. */}
                  {(p.role === 'closer' || p.role === 'vendedor') && (p.ativo || tipos.some((t) => p[t].metaId)) && (
                    <div className="flex flex-col items-end gap-1">
                      {tipos.map((tipo) => (
                        <AcoesMeta
                          key={tipo}
                          metaId={p[tipo].metaId}
                          alvo={p.usuarioId}
                          tipo={tipo}
                          mes={mes}
                          podeCriar={p.ativo && liberados.includes(tipo)}
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

/** Sem meta: "Definir [tipo]" (só tipo liberado). Com meta: "Editar" e "Remover". */
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
        <BotaoConfirmar pergunta={`Remover a meta ${ROTULO_TIPO_META[tipo]} deste mês?`} className={botaoPerigoClass}>
          Remover
        </BotaoConfirmar>
      </form>
    </span>
  )
}
