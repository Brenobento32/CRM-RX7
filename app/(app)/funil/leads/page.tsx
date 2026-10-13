import type { Metadata } from 'next'
import Link from 'next/link'

import { listarLeadsAtivos, type CardFunil } from '@/lib/dal/funil'
import { listarFunis } from '@/lib/dal/funis'
import { listarNegociacoesArquivadas, type NegociacaoArquivada } from '@/lib/dal/negociacoes'
import { formatarTelefone } from '@/lib/utils/documentos'
import { formatarData } from '@/lib/utils/formatacao'
import { ROTULO_ORIGEM } from '@/lib/validations/funil'
import { ROTULO_TEMPERATURA } from '@/lib/validations/negociacao'

import { AcoesLeadArquivado } from './_components/acoes-lead-arquivado'
import { SeletorFunilLeads } from './_components/seletor-funil-leads'

export const metadata: Metadata = {
  title: 'Leads',
}

type Aba = 'ativos' | 'arquivados'

const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'arquivados', rotulo: 'Arquivados' },
]

/**
 * Tela única de Leads: Ativos (negociações não arquivadas, etapa aberta) e
 * Arquivados (desqualificados), filtráveis por funil. Substitui a antiga
 * `/funil/arquivados` (que agora só redireciona pra aqui com `?aba=arquivados`).
 *
 * Uma consulta por aba (via `funil_cards`/`negociacoes` já filtrados pelo
 * `funilId`), nunca N consultas por card — RLS decide o que cada usuário vê,
 * sem filtro de dono aqui.
 */
export default async function LeadsPage({ searchParams }: PageProps<'/funil/leads'>) {
  const params = await searchParams
  const aba: Aba = params.aba === 'arquivados' ? 'arquivados' : 'ativos'
  const funilId = typeof params.funil === 'string' && params.funil !== '' ? params.funil : null

  const [funis, leads] = await Promise.all([
    listarFunis(),
    aba === 'arquivados' ? listarNegociacoesArquivadas(funilId) : listarLeadsAtivos(funilId),
  ])

  const hrefAba = (valor: Aba) => {
    const qs = new URLSearchParams()
    if (valor !== 'ativos') qs.set('aba', valor)
    if (funilId) qs.set('funil', funilId)
    const s = qs.toString()
    return s ? `/funil/leads?${s}` : '/funil/leads'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ativos e arquivados, de qualquer funil ou de um só.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-label="Status do lead">
          {ABAS.map((a) => (
            <Link
              key={a.valor}
              href={hrefAba(a.valor)}
              aria-current={aba === a.valor ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                aba === a.valor
                  ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {a.rotulo}
            </Link>
          ))}
        </nav>

        <SeletorFunilLeads funis={funis} funilId={funilId} />
      </div>

      {aba === 'ativos' ? (
        <TabelaAtivos leads={leads as CardFunil[]} mostrarFunil={!funilId} />
      ) : (
        <TabelaArquivados leads={leads as NegociacaoArquivada[]} />
      )}
    </div>
  )
}

function TabelaAtivos({ leads, mostrarFunil }: { leads: CardFunil[]; mostrarFunil: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-3 font-medium">Nome</th>
            <th className="px-4 py-3 font-medium">Empresa</th>
            <th className="px-4 py-3 font-medium">Nicho</th>
            <th className="px-4 py-3 font-medium">Origem</th>
            <th className="px-4 py-3 font-medium">Temperatura</th>
            <th className="px-4 py-3 font-medium">Telefone</th>
            <th className="px-4 py-3 font-medium">Responsável</th>
            {mostrarFunil && <th className="px-4 py-3 font-medium">Funil</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {leads.map((l) => (
            <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <td className="px-4 py-3">
                <Link href={`/clientes/${l.clienteId}`} className="font-medium hover:underline">
                  {l.clienteNome}
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.clienteEmpresa ?? '—'}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.nichoNome ?? 'Outros'}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{ROTULO_ORIGEM[l.origem]}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {l.temperatura ? ROTULO_TEMPERATURA[l.temperatura] : '—'}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {l.clienteTelefone ? formatarTelefone(l.clienteTelefone) : '—'}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.responsavel ?? '—'}</td>
              {mostrarFunil && (
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.funilNome ?? '—'}</td>
              )}
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={mostrarFunil ? 8 : 7} className="px-4 py-10 text-center text-zinc-500">
                Nenhum lead ativo.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TabelaArquivados({ leads }: { leads: NegociacaoArquivada[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-3 font-medium">Nome</th>
            <th className="px-4 py-3 font-medium">Empresa</th>
            <th className="px-4 py-3 font-medium">Nicho</th>
            <th className="px-4 py-3 font-medium">Origem</th>
            <th className="px-4 py-3 font-medium">Temperatura</th>
            <th className="px-4 py-3 font-medium">Responsável</th>
            <th className="px-4 py-3 font-medium">Motivo</th>
            <th className="px-4 py-3 font-medium">Data</th>
            <th className="px-4 py-3 font-medium">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {leads.map((l) => (
            <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <td className="px-4 py-3 font-medium">{l.clienteNome}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.clienteEmpresa ?? '—'}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.nichoNome ?? 'Outros'}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{ROTULO_ORIGEM[l.origem]}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {l.temperatura ? ROTULO_TEMPERATURA[l.temperatura] : '—'}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.responsavel ?? '—'}</td>
              <td className="max-w-56 truncate px-4 py-3 text-zinc-600 dark:text-zinc-400" title={l.motivoArquivamento}>
                {l.motivoArquivamento}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatarData(l.arquivadaEm)}</td>
              <td className="px-4 py-3">
                <AcoesLeadArquivado id={l.id} clienteNome={l.clienteNome} />
              </td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-zinc-500">
                Nenhum lead arquivado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
