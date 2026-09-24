import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarPropostasFechadas } from '@/lib/dal/propostas'
import { formatarDia, formatarMoeda } from '@/lib/utils/formatacao'
import { chavePeriodo, resolverPeriodo } from '@/lib/utils/periodo'
import { ROTULO_STATUS_PAGAMENTO } from '@/lib/validations/funil'
import { ROTULO_FORMA_PAGAMENTO } from '@/lib/validations/negociacao'

import { SeletorPeriodo } from '../../_components/dashboard/seletor-periodo'
import { AbasPropostas, EtiquetasServicos, TabelaPropostas, Vazio } from '../_components/comum'

export const metadata: Metadata = {
  title: 'Propostas fechadas',
}

export default async function PropostasFechadasPage({ searchParams }: PageProps<'/propostas/fechadas'>) {
  const eu = await getUsuarioAtual()
  const { periodo: param } = await searchParams
  const periodo = resolverPeriodo(chavePeriodo(param))
  const fechadas = await listarPropostasFechadas(periodo)
  const total = fechadas.reduce((t, f) => t + f.valorVendido, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Propostas</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {eu.role === 'gerente' ? 'Da equipe inteira.' : 'Suas vendas.'} Fechadas: negócios ganhos no
            período, pela data de fechamento.
          </p>
        </div>
        <SeletorPeriodo atual={periodo.chave} caminho="/propostas/fechadas" />
      </div>

      <AbasPropostas atual="/propostas/fechadas" />

      {fechadas.length === 0 ? (
        <Vazio>Nenhum fechamento no período.</Vazio>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {fechadas.length} {fechadas.length === 1 ? 'fechamento' : 'fechamentos'} ·{' '}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{formatarMoeda(total)}</span>
          </p>
          <TabelaPropostas
            colunas={[
              { rotulo: 'Cliente' },
              { rotulo: 'Serviços' },
              { rotulo: 'Valor vendido', direita: true },
              { rotulo: 'Pagamento' },
              { rotulo: 'Responsável' },
              { rotulo: '' },
            ]}
          >
            {fechadas.map((f) => (
              <tr key={f.negociacaoId}>
                <td className="px-4 py-3">
                  <Link href={`/clientes/${f.clienteId}`} className="font-medium hover:underline">
                    {f.clienteNome}
                  </Link>
                  <p className="text-xs text-zinc-500">Fechado em {formatarDia(f.dataFechamento)}</p>
                </td>
                <td className="px-4 py-3">
                  <EtiquetasServicos servicos={f.servicos} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatarMoeda(f.valorVendido)}
                  {f.valorProposta !== null && f.valorProposta !== f.valorVendido && (
                    <p className="text-xs text-zinc-500">Proposta {formatarMoeda(f.valorProposta)}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {f.formaPagamento ? ROTULO_FORMA_PAGAMENTO[f.formaPagamento] : '—'}
                  <p className="text-xs text-zinc-500">{ROTULO_STATUS_PAGAMENTO[f.statusPagamento]}</p>
                </td>
                <td className="px-4 py-3">{f.responsavel ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/negociacoes/${f.negociacaoId}/editar`} className={botaoSecundarioClass}>
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </TabelaPropostas>
        </>
      )}
    </div>
  )
}
