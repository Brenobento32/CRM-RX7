import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Aviso } from '@/components/ui/aviso'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { botaoPrimarioClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import { Selo, type TomSelo } from '@/components/ui/selo'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { listarFontes, opcoesDeDestino, podeGerirFontes } from '@/lib/dal/fontes-leads'
import { CATALOGO, itemDoTipo, situacaoDaFonte } from '@/lib/integracoes/catalogo'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

import { NovaFonte } from './_components/nova-fonte'

export const metadata: Metadata = {
  title: 'Integrações',
}

/** Situação do catálogo/fonte → tom do selo (a cor reforça, o texto informa). */
const TOM_SELO: Record<string, TomSelo> = {
  nativo: 'neutro',
  pronto: 'verde',
  requer_configuracao: 'ambar',
}
const TOM_TEXTO: Record<string, string> = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  espera: 'text-amber-700 dark:text-amber-300',
  parado: 'text-premium-mudo',
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
      <PageHeaderPremium
        titulo="Integrações e fontes de leads"
        subtitulo="Cada fonte entra no funil e na etapa que você escolher. Reenvios do mesmo lead não duplicam a negociação, e nada daqui é compartilhado com outras empresas."
        voltar={{ href: '/configuracoes', rotulo: 'Configurações' }}
        acoes={
          podeGerir && (
            <a href="#nova-fonte" className={botaoPrimarioClass}>
              Nova fonte
            </a>
          )
        }
      />
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <section aria-labelledby="catalogo-titulo" className="space-y-3">
        <h2 id="catalogo-titulo" className="text-[15px] font-semibold tracking-tight text-premium-texto">
          Tipos disponíveis
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOGO.map((item) => (
            <div key={item.tipo} className="rounded-xl border border-premium-borda bg-premium-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
                <p className="font-medium text-premium-texto">{item.nome}</p>
                <Selo tom={TOM_SELO[item.situacao] ?? 'neutro'} className="whitespace-normal">{item.rotuloSituacao}</Selo>
              </div>
              <p className="mt-1 text-sm text-premium-secundario">{item.descricao}</p>
              {item.tipo === 'manual' && (
                <Link href="/clientes/novo" className="mt-2 inline-block text-sm font-medium text-premium-acento hover:underline">
                  Cadastrar cliente
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <Secao titulo="Fontes desta empresa" descricao={`${fontes.length} ${fontes.length === 1 ? 'fonte' : 'fontes'}`} semPadding>
        {fontes.length === 0 ? (
          <EstadoVazio
            compacto
            titulo="Nenhuma fonte cadastrada"
            descricao={
              podeGerir
                ? 'Crie uma fonte abaixo para receber leads de formulários direto no funil.'
                : 'Quando o administrador criar uma fonte, ela aparece aqui.'
            }
          />
        ) : (
          <ul className="divide-y divide-premium-borda-suave">
            {fontes.map((f) => {
              const s = situacaoDaFonte(f)
              return (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm transition-colors hover:bg-premium-bg/60"
                >
                  <div className="min-w-0">
                    <Link href={`/configuracoes/integracoes/${f.id}`} className="font-medium text-premium-texto hover:underline">
                      {f.nome}
                    </Link>
                    <span className="ml-2 text-xs text-premium-mudo">{itemDoTipo(f.tipo).nome}</span>
                    <p className={`text-xs ${TOM_TEXTO[s.tom] ?? 'text-premium-mudo'}`}>
                      {s.rotulo}
                      {f.ultimoLeadEm ? ` · último lead ${formatarDataHoraCompleta(f.ultimoLeadEm)}` : ''}
                    </p>
                  </div>
                  {f.ultimoErro && f.status !== 'revogada' && <Selo tom="vermelho">Último erro registrado</Selo>}
                </li>
              )
            })}
          </ul>
        )}
      </Secao>

      {podeGerir ? (
        <Secao id="nova-fonte" titulo="Nova fonte" descricao="Escolha o tipo e para onde os leads vão.">
          <NovaFonte opcoes={opcoes} responsaveis={responsaveis.map((r) => ({ id: r.id, nome: r.nome }))} />
        </Secao>
      ) : (
        <Aviso tom="info">Somente o administrador da empresa cria e altera fontes.</Aviso>
      )}
    </div>
  )
}
