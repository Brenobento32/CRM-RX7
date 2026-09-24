import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarPropostasAbertas } from '@/lib/dal/propostas'
import { formatarDia, formatarMoeda } from '@/lib/utils/formatacao'
import { ROTULO_FORMA_PAGAMENTO } from '@/lib/validations/negociacao'

import { AbasPropostas, EtiquetasServicos, TabelaPropostas, Vazio } from '../_components/comum'

export const metadata: Metadata = {
  title: 'Propostas abertas',
}

export default async function PropostasAbertasPage() {
  const eu = await getUsuarioAtual()
  const propostas = await listarPropostasAbertas()
  const total = propostas.reduce((t, p) => t + p.valorProposta, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Propostas</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {eu.role === 'gerente' ? 'Da equipe inteira.' : 'Suas negociações.'} Abertas: negociações em
          andamento com valor de proposta.
        </p>
      </div>

      <AbasPropostas atual="/propostas/abertas" />

      {propostas.length === 0 ? (
        <Vazio>Nenhuma proposta em aberto. Informe o valor da proposta na negociação.</Vazio>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {propostas.length} {propostas.length === 1 ? 'proposta' : 'propostas'} ·{' '}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{formatarMoeda(total)}</span>
          </p>
          <TabelaPropostas
            colunas={[
              { rotulo: 'Cliente' },
              { rotulo: 'Serviços' },
              { rotulo: 'Valor da proposta', direita: true },
              { rotulo: 'Pagamento' },
              { rotulo: 'Responsável' },
              { rotulo: '' },
            ]}
          >
            {propostas.map((p) => (
              <tr key={p.negociacaoId}>
                <td className="px-4 py-3">
                  <Link href={`/clientes/${p.clienteId}`} className="font-medium hover:underline">
                    {p.clienteNome}
                  </Link>
                  {p.dataProposta && (
                    <p className="text-xs text-zinc-500">Enviada em {formatarDia(p.dataProposta)}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <EtiquetasServicos servicos={p.servicos} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatarMoeda(p.valorProposta)}</td>
                <td className="px-4 py-3">
                  {p.formaPagamento ? ROTULO_FORMA_PAGAMENTO[p.formaPagamento] : <span className="text-zinc-400">—</span>}
                </td>
                <td className="px-4 py-3">{p.responsavel ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/negociacoes/${p.negociacaoId}/editar`} className={botaoSecundarioClass}>
                    Editar
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
