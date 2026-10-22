import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { listarFontes, opcoesDeDestino, podeGerirFontes } from '@/lib/dal/fontes-leads'
import { CATALOGO, itemDoTipo, situacaoDaFonte } from '@/lib/integracoes/catalogo'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

import { NovaFonte } from './_components/nova-fonte'

export const metadata: Metadata = {
  title: 'Integrações',
}

const TOM: Record<string, string> = {
  nativo: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  pronto: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  requer_configuracao: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ok: 'text-emerald-700 dark:text-emerald-300',
  espera: 'text-amber-700 dark:text-amber-300',
  parado: 'text-zinc-500',
}

/**
 * Fontes de leads desta empresa. Cada fonte tem destino próprio (funil, etapa,
 * responsável). Gerente vê; só o administrador cria e altera.
 */
export default async function IntegracoesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const [fontes, podeGerir, opcoes, responsaveis, params] = await Promise.all([
    listarFontes(),
    podeGerirFontes(),
    opcoesDeDestino(),
    listarResponsaveis(),
    searchParams,
  ])
  const erro = typeof params.erro === 'string' ? params.erro : null

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Integrações e fontes de leads</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cada fonte entra no funil e na etapa que você escolher. Reenvios do mesmo lead não duplicam a negociação, e
          nada daqui é compartilhado com outras empresas.
        </p>
      </div>
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOGO.map((item) => (
          <div key={item.tipo} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{item.nome}</p>
              <span className={`rounded px-2 py-0.5 text-[11px] ${TOM[item.situacao]}`}>{item.rotuloSituacao}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{item.descricao}</p>
            {item.tipo === 'manual' && (
              <Link href="/clientes/novo" className="mt-2 inline-block text-sm underline">
                Cadastrar cliente
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Fontes desta empresa</h2>
        {fontes.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma fonte cadastrada.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {fontes.map((f) => {
              const s = situacaoDaFonte(f)
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <Link href={`/configuracoes/integracoes/${f.id}`} className="font-medium hover:underline">
                      {f.nome}
                    </Link>
                    <span className="ml-2 text-xs text-zinc-500">{itemDoTipo(f.tipo).nome}</span>
                    <p className={`text-xs ${TOM[s.tom]}`}>
                      {s.rotulo}
                      {f.ultimoLeadEm ? ` · último lead ${formatarDataHoraCompleta(f.ultimoLeadEm)}` : ''}
                    </p>
                  </div>
                  {f.ultimoErro && f.status !== 'revogada' && <span className="text-xs text-red-600">Último erro registrado</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {podeGerir ? (
        <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">Nova fonte</h2>
          <NovaFonte opcoes={opcoes} responsaveis={responsaveis.map((r) => ({ id: r.id, nome: r.nome }))} />
        </section>
      ) : (
        <p className="text-sm text-zinc-500">Somente o administrador da empresa cria e altera fontes.</p>
      )}
    </div>
  )
}
