import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoPrimarioClass, botaoSecundarioClass, botaoPerigoClass, caixaErroClass, legendaClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import { definirAtivoFunilAction, excluirFunilAction } from '@/lib/actions/funis'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { limiteDeOrdemPipeline, limiteDeOrdemRecuperacao, listarEtapasComUso } from '@/lib/dal/etapas'
import { listarFunisComUso, obterFunil } from '@/lib/dal/funis'

import { DuplicarFunilForm } from '../_components/duplicar-funil-form'
import { EditarFunilForm } from '../_components/editar-funil-form'
import { TabelaEtapas } from '../_components/tabela-etapas'

export const metadata: Metadata = {
  title: 'Configurar funil',
}

export default async function FunilConfigPage({
  params,
  searchParams,
}: PageProps<'/configuracoes/funis/[funilId]'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { funilId } = await params
  if (!z.uuid().safeParse(funilId).success) notFound()

  const { erro } = await searchParams

  const [funil, etapas, funis] = await Promise.all([
    obterFunil(funilId),
    listarEtapasComUso(funilId),
    listarFunisComUso(),
  ])
  if (!funil) notFound()

  const negociacoesAtuais = funis.find((f) => f.id === funilId)?.negociacoesAtuais ?? 0
  const limitePipeline = limiteDeOrdemPipeline(etapas)
  const limiteRecuperacao = limiteDeOrdemRecuperacao(etapas)
  const faixaPipeline = etapas.filter((e) => e.ativo && e.tipo === 'aberta' && !e.posFechamento && e.ordem < limitePipeline)
  const faixaRecuperacao = etapas.filter((e) => e.ativo && e.tipo === 'aberta' && e.posFechamento && e.ordem > limiteRecuperacao)
  const ativas = etapas.filter((e) => e.ativo)
  const inativas = etapas.filter((e) => !e.ativo)

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeaderPremium
        titulo={funil.nome}
        subtitulo={funil.padrao ? 'Funil Principal — não pode ser excluído nem desativado.' : undefined}
        voltar={{ href: '/configuracoes/funis', rotulo: 'Funis' }}
      />

      {typeof erro === 'string' && (
        <p
          role="alert"
          className={caixaErroClass}
        >
          {erro}
        </p>
      )}

      <Secao titulo="Dados do funil">
        <EditarFunilForm
          funilId={funilId}
          nome={funil.nome}
          descricao={funil.descricao}
          whatsappHabilitado={funil.whatsappHabilitado}
        />
      </Secao>

      <section aria-labelledby="etapas-titulo" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="etapas-titulo" className={legendaClass}>
              Etapas
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-premium-secundario">
              Na ordem das colunas do Kanban. Etapas de fluxo comercial ficam antes do fechamento (ganha/perdida); etapas de
              recuperação pós-perda ficam depois.
            </p>
          </div>
          <Link href={`/configuracoes/funis/${funilId}/etapas/nova`} className={botaoPrimarioClass}>
            Nova etapa
          </Link>
        </div>
        <TabelaEtapas
          funilId={funilId}
          etapas={ativas}
          faixaPipeline={faixaPipeline}
          faixaRecuperacao={faixaRecuperacao}
        />

        {inativas.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-semibold text-premium-texto">Desativadas</h3>
            <p className="text-sm text-premium-secundario">
              Fora do Kanban, mas mantidas no histórico das negociações que passaram por elas.
            </p>
            <TabelaEtapas
              funilId={funilId}
              etapas={inativas}
              faixaPipeline={faixaPipeline}
              faixaRecuperacao={faixaRecuperacao}
            />
          </div>
        )}
      </section>

      <Secao
        titulo="Duplicar funil"
        descricao="Copia nome, cor, tipo e ordem das etapas. Não copia negociações, histórico nem fechamentos — o funil novo nasce vazio."
      >
        <DuplicarFunilForm funilId={funilId} nomeSugerido={`${funil.nome} (cópia)`} />
      </Secao>

      {!funil.padrao && (
        <Secao titulo="Ativação e exclusão" descricao="Funil desativado sai do menu e do Kanban; os dados continuam guardados.">
          <div className="flex flex-wrap gap-3">
            {funil.ativo ? (
              <form action={definirAtivoFunilAction.bind(null, funilId, false)}>
                <button type="submit" className={botaoSecundarioClass}>
                  Desativar funil
                </button>
              </form>
            ) : (
              <form action={definirAtivoFunilAction.bind(null, funilId, true)}>
                <button type="submit" className={botaoSecundarioClass}>
                  Reativar funil
                </button>
              </form>
            )}

            {negociacoesAtuais > 0 ? (
              <button
                type="button"
                disabled
                title={`Este funil tem ${negociacoesAtuais} negociação(ões) vinculada(s). Não é possível excluir.`}
                className={`${botaoSecundarioClass} cursor-not-allowed opacity-50`}
              >
                Excluir funil
              </button>
            ) : (
              <form action={excluirFunilAction.bind(null, funilId)}>
                <BotaoConfirmar
                  pergunta={`Excluir o funil "${funil.nome}"? Isso não pode ser desfeito.`}
                  className={botaoPerigoClass}
                >
                  Excluir funil
                </BotaoConfirmar>
              </form>
            )}
          </div>
          {negociacoesAtuais === 0 && (
            <p className="mt-3 text-xs text-premium-mudo">Funil vazio — pode ser excluído.</p>
          )}
        </Secao>
      )}
    </div>
  )
}
