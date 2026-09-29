import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
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
    <div className="max-w-4xl space-y-8">
      <div>
        <Link href="/configuracoes/funis" className="text-sm text-zinc-500 hover:underline">
          ← Funis
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{funil.nome}</h1>
        {funil.padrao && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Funil Principal — não pode ser excluído nem desativado.
          </p>
        )}
      </div>

      {typeof erro === 'string' && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Dados do funil</h2>
        <EditarFunilForm funilId={funilId} nome={funil.nome} descricao={funil.descricao} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Etapas</h2>
          <Link href={`/configuracoes/funis/${funilId}/etapas/nova`} className={botaoPrimarioClass}>
            Nova etapa
          </Link>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Na ordem das colunas do Kanban. Etapas de fluxo comercial ficam antes do fechamento
          (ganha/perdida); etapas de recuperação pós-perda ficam depois.
        </p>
        <TabelaEtapas
          funilId={funilId}
          etapas={ativas}
          faixaPipeline={faixaPipeline}
          faixaRecuperacao={faixaRecuperacao}
        />

        {inativas.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-base font-semibold">Desativadas</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
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

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Duplicar</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Copia nome, cor, tipo e ordem das etapas. Não copia negociações, histórico nem fechamentos — o
          funil novo nasce vazio.
        </p>
        <DuplicarFunilForm funilId={funilId} nomeSugerido={`${funil.nome} (cópia)`} />
      </section>

      {!funil.padrao && (
        <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">Ativação e exclusão</h2>
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
                  className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}
                >
                  Excluir funil
                </BotaoConfirmar>
              </form>
            )}
          </div>
          {negociacoesAtuais === 0 && (
            <p className="text-xs text-zinc-500">Funil vazio — pode ser excluído.</p>
          )}
        </section>
      )}
    </div>
  )
}
