import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { caixaAlertaClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { atualizarFechamentoAction, salvarNegociacaoAction } from '@/lib/actions/negociacoes'
import { listarHistoricoDaNegociacao } from '@/lib/dal/historico'
import { NEGOCIACAO_ENCERRADA, obterNegociacaoParaEdicao, type FechamentoEdicao, type NegociacaoEdicao } from '@/lib/dal/negociacoes'
import { listarServicosAtivos, ordenarServicos } from '@/lib/dal/servicos'
import { formatarDia, formatarMoeda } from '@/lib/utils/formatacao'
import { montarHistorico } from '@/lib/utils/historico'
import { ROTULO_FORMA_PAGAMENTO, ROTULO_TEMPERATURA } from '@/lib/validations/negociacao'

import { EditarFechamentoForm } from './_components/editar-fechamento-form'
import { HistoricoFunil } from './_components/historico-funil'
import { NegociacaoForm } from './_components/negociacao-form'

export const metadata: Metadata = {
  title: 'Negociação',
}

/** 15000 → "15000,00" (o campo aceita o formato brasileiro de volta). */
function valorParaCampo(valor: number | null): string {
  return valor === null ? '' : valor.toFixed(2).replace('.', ',')
}

/**
 * Dados comerciais da negociação: qualificação, proposta e serviços.
 * Aberta: formulário completo. Ganha: qualificação/proposta somente
 * leitura + formulário de EDIÇÃO DO FECHAMENTO (valor vendido, serviços,
 * observações, contrato, status). Perdida: tudo somente leitura, banco
 * também recusa. Etapa, dono e motivo de perda mudam só pelo funil. A RLS
 * decide quem abre: closer que tente a negociação de outro recebe 404.
 */
export default async function EditarNegociacaoPage({ params }: PageProps<'/negociacoes/[id]/editar'>) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const [negociacao, historico] = await Promise.all([obterNegociacaoParaEdicao(id), listarHistoricoDaNegociacao(id)])
  if (!negociacao) notFound()

  const tipo = negociacao.etapa.tipo
  const voltar = `/clientes/${negociacao.clienteId}`
  const entradasHistorico = montarHistorico(historico)

  const titulo = tipo === 'aberta' ? 'Editar negociação' : tipo === 'ganha' ? 'Editar fechamento' : 'Negociação'

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo={titulo}
        voltar={{ href: voltar, rotulo: negociacao.clienteNome }}
        subtitulo={
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 font-medium text-premium-texto">
              <PontoEtapa cor={negociacao.etapa.cor} />
              {negociacao.etapa.nome}
            </span>
            <span>· A etapa muda pelo funil.</span>
          </span>
        }
      />

      {tipo === 'perdida' && (
        <>
          <p role="note" className={caixaAlertaClass}>
            {NEGOCIACAO_ENCERRADA}
          </p>
          <SomenteLeitura negociacao={negociacao} mostrarServicos />
        </>
      )}

      {tipo === 'ganha' && negociacao.fechamento && (
        <>
          <p role="note" className={caixaAlertaClass}>
            Qualificação e proposta não podem mais ser alteradas. Os dados do fechamento continuam editáveis abaixo.
          </p>
          <SomenteLeitura negociacao={negociacao} mostrarServicos={false} />
          <Secao titulo="Fechamento">
            <EditarFechamento negociacao={negociacao} fechamento={negociacao.fechamento} voltar={voltar} />
          </Secao>
        </>
      )}

      {tipo === 'aberta' && (
        <Secao>
          <Formulario negociacao={negociacao} voltar={voltar} />
        </Secao>
      )}

      <Secao titulo="Histórico do funil" descricao="Cada mudança de etapa, com data e responsável.">
        <HistoricoFunil entradas={entradasHistorico} />
      </Secao>
    </div>
  )
}

async function Formulario({ negociacao, voltar }: { negociacao: NegociacaoEdicao; voltar: string }) {
  // Desativados só aparecem se já estão nesta negociação.
  const ativos = await listarServicosAtivos()
  const idsAtivos = new Set(ativos.map((s) => s.id))
  const servicos = ordenarServicos([...ativos, ...negociacao.servicos.filter((s) => !idsAtivos.has(s.id))])

  return (
    <NegociacaoForm
      action={salvarNegociacaoAction.bind(null, negociacao.id, negociacao.clienteId)}
      servicos={servicos}
      cancelarHref={voltar}
      valoresIniciais={{
        valor_estimado: valorParaCampo(negociacao.valorEstimado),
        temperatura: negociacao.temperatura ?? '',
        data_primeira_reuniao: negociacao.dataPrimeiraReuniao ?? '',
        data_proposta: negociacao.dataProposta ?? '',
        objecao_principal: negociacao.objecaoPrincipal ?? '',
        valor_proposta: valorParaCampo(negociacao.valorProposta),
        forma_pagamento: negociacao.formaPagamento ?? '',
        servico_ids: negociacao.servicos.map((s) => s.id),
      }}
    />
  )
}

async function EditarFechamento({
  negociacao,
  fechamento,
  voltar,
}: {
  negociacao: NegociacaoEdicao
  fechamento: FechamentoEdicao
  voltar: string
}) {
  // Mesmo padrão de Formulario: desativados só aparecem se já vinculados.
  const ativos = await listarServicosAtivos()
  const idsAtivos = new Set(ativos.map((s) => s.id))
  const servicos = ordenarServicos([...ativos, ...negociacao.servicos.filter((s) => !idsAtivos.has(s.id))])

  return (
    <EditarFechamentoForm
      action={atualizarFechamentoAction.bind(null, negociacao.id, negociacao.clienteId)}
      fechamento={fechamento}
      servicoIdsAtuais={negociacao.servicos.map((s) => s.id)}
      servicos={servicos}
      cancelarHref={voltar}
    />
  )
}

function SomenteLeitura({
  negociacao: n,
  mostrarServicos = true,
}: {
  negociacao: NegociacaoEdicao
  /** false quando os serviços já aparecem editáveis em EditarFechamentoForm logo abaixo. */
  mostrarServicos?: boolean
}) {
  const moeda = (v: number | null) => (v === null ? null : formatarMoeda(v))
  const dia = (d: string | null) => (d === null ? null : formatarDia(d))

  const blocos: { titulo: string; itens: [string, React.ReactNode][] }[] = [
    {
      titulo: 'Qualificação',
      itens: [
        ['Valor estimado', moeda(n.valorEstimado)],
        ['Temperatura', n.temperatura && ROTULO_TEMPERATURA[n.temperatura]],
        ['Primeira reunião', dia(n.dataPrimeiraReuniao)],
        ['Data da proposta', dia(n.dataProposta)],
        ['Objeção principal', n.objecaoPrincipal],
      ],
    },
    {
      titulo: 'Proposta',
      itens: [
        ['Valor da proposta', moeda(n.valorProposta)],
        ['Forma de pagamento', n.formaPagamento && ROTULO_FORMA_PAGAMENTO[n.formaPagamento]],
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {blocos.map((b) => (
        <Secao key={b.titulo} titulo={b.titulo}>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {b.itens.map(([rotulo, valor]) => (
              <div key={rotulo} className={rotulo === 'Objeção principal' ? 'sm:col-span-2' : undefined}>
                <dt className="text-xs text-premium-mudo">{rotulo}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm text-premium-texto">{valor || '—'}</dd>
              </div>
            ))}
          </dl>
        </Secao>
      ))}

      {mostrarServicos && (
        <Secao titulo="Serviços">
          {n.servicos.length === 0 ? (
            <p className="text-sm text-premium-mudo">Nenhum serviço vinculado a esta negociação.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {ordenarServicos([...n.servicos]).map((s) => (
                <li
                  key={s.id}
                  className="rounded-md bg-premium-bg px-2 py-1 text-sm text-premium-secundario ring-1 ring-premium-borda ring-inset"
                >
                  {s.nome}
                  {!s.ativo && <span className="text-premium-mudo"> (desativado)</span>}
                </li>
              ))}
            </ul>
          )}
        </Secao>
      )}
    </div>
  )
}
