import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { tabelaCaixaClass, theadClass, tbodyClass } from '@/components/ui/estilos'
import { listarLeadsAtivos, type CardFunil } from '@/lib/dal/funil'
import { listarFunis } from '@/lib/dal/funis'
import { listarNegociacoesArquivadas, type NegociacaoArquivada } from '@/lib/dal/negociacoes'
import { formatarTelefone } from '@/lib/utils/documentos'
import { formatarData } from '@/lib/utils/formatacao'
import { ROTULO_ORIGEM, rotuloDaOrigem } from '@/lib/validations/funil'
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
      <PageHeaderPremium titulo="Leads" subtitulo="Ativos e arquivados, de qualquer funil ou de um só." />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav className="flex gap-1 border-b border-premium-borda" aria-label="Status do lead">
          {ABAS.map((a) => (
            <Link
              key={a.valor}
              href={hrefAba(a.valor)}
              aria-current={aba === a.valor ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                aba === a.valor
                  ? 'border-premium-acento text-premium-texto'
                  : 'border-transparent text-premium-mudo hover:text-premium-texto'
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
    <div className={tabelaCaixaClass}>
      <table className="w-full text-left text-sm">
        <thead className={theadClass}>
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
        <tbody className={tbodyClass}>
          {leads.map((l) => (
            <tr key={l.id} className="hover:bg-premium-bg">
              <td className="px-4 py-3">
                <Link href={`/clientes/${l.clienteId}`} className="font-medium hover:underline">
                  {l.clienteNome}
                </Link>
              </td>
              <td className="px-4 py-3 text-premium-secundario">{l.clienteEmpresa ?? '—'}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.nichoNome ?? 'Outros'}</td>
              <td className="px-4 py-3 text-premium-secundario">{rotuloDaOrigem(l.origem, l.atribuicao)}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.temperatura ? ROTULO_TEMPERATURA[l.temperatura] : '—'}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.clienteTelefone ? formatarTelefone(l.clienteTelefone) : '—'}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.responsavel ?? '—'}</td>
              {mostrarFunil && <td className="px-4 py-3 text-premium-secundario">{l.funilNome ?? '—'}</td>}
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={mostrarFunil ? 8 : 7} className="px-4 py-4">
                <EstadoVazio
                  compacto
                  titulo="Nenhum lead ativo"
                  descricao="Leads novos dos formulários, do WhatsApp ou cadastrados à mão aparecem aqui."
                />
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
    <div className={tabelaCaixaClass}>
      <table className="w-full text-left text-sm">
        <thead className={theadClass}>
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
        <tbody className={tbodyClass}>
          {leads.map((l) => (
            <tr key={l.id} className="hover:bg-premium-bg">
              <td className="px-4 py-3 font-medium">{l.clienteNome}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.clienteEmpresa ?? '—'}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.nichoNome ?? 'Outros'}</td>
              <td className="px-4 py-3 text-premium-secundario">{ROTULO_ORIGEM[l.origem]}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.temperatura ? ROTULO_TEMPERATURA[l.temperatura] : '—'}</td>
              <td className="px-4 py-3 text-premium-secundario">{l.responsavel ?? '—'}</td>
              <td className="max-w-56 truncate px-4 py-3 text-premium-secundario" title={l.motivoArquivamento}>
                {l.motivoArquivamento}
              </td>
              <td className="px-4 py-3 text-premium-secundario">{formatarData(l.arquivadaEm)}</td>
              <td className="px-4 py-3">
                <AcoesLeadArquivado id={l.id} clienteNome={l.clienteNome} />
              </td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-premium-mudo">
                Nenhum lead arquivado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
