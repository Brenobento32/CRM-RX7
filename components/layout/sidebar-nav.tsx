'use client'

import Link from 'next/link'
import { useRotaInterna } from '@/lib/empresa/use-rota-interna'
import { useState } from 'react'

import { contemMenu, filtrarMenu, folhasMenu, hrefAtivoMenu, type NoMenu, type NomeIcone } from '@/lib/navegacao/menu'
import type { Cargo } from '@/lib/validations/usuario'

import {
  IconeAbertas,
  IconeAgenda,
  IconeAssinatura,
  IconeClientes,
  IconeConfiguracoes,
  IconeConversao,
  IconeConversas,
  IconeCrm,
  IconeEmpresa,
  IconeEtapas,
  IconeExportacao,
  IconeFechadas,
  IconeInicio,
  IconeIntegracoes,
  IconeKanban,
  IconeLeads,
  IconeMetas,
  IconeMetricas,
  IconeNichos,
  IconePropostas,
  IconeRelatorios,
  IconeSeta,
  IconeServicos,
  IconeVendas,
} from './icones'

type Icone = (p: { className?: string }) => React.ReactNode

const ICONES: Record<NomeIcone, Icone> = {
  inicio: IconeInicio, agenda: IconeAgenda, crm: IconeCrm, kanban: IconeKanban, metricas: IconeMetricas,
  leads: IconeLeads, configuracoes: IconeConfiguracoes, etapas: IconeEtapas, nichos: IconeNichos,
  servicos: IconeServicos, clientes: IconeClientes, metas: IconeMetas, propostas: IconePropostas,
  abertas: IconeAbertas, fechadas: IconeFechadas, relatorios: IconeRelatorios, vendas: IconeVendas,
  conversao: IconeConversao, exportacao: IconeExportacao, empresa: IconeEmpresa, usuarios: IconeClientes,
  integracoes: IconeIntegracoes, assinatura: IconeAssinatura, conversas: IconeConversas,
}

type No = NoMenu

function IconeDo({ no, className }: { no: No; className?: string }) {
  const C = ICONES[no.icone]
  return <C className={className} />
}

/** `pl-[10px]` compensa os 2px do `border-l-2` — o texto fica alinhado igual, ativo ou não. */
const linhaBase =
  'flex items-center gap-3 rounded-md border-l-2 border-transparent py-2 pr-3 pl-[10px] text-sm transition group-data-[sidebar=recolhida]/shell:justify-center group-data-[sidebar=recolhida]/shell:border-l-0 group-data-[sidebar=recolhida]/shell:px-0'
const linhaAtiva = 'border-premium-acento bg-premium-acento-suave font-medium text-premium-acento'
const linhaAncestral = 'font-medium text-premium-texto'
const linhaInativa = 'text-premium-secundario hover:bg-premium-card hover:text-premium-texto'
const subLinha = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition'

/**
 * Client pelo `usePathname` (item ativo) e pelo estado dos grupos abertos.
 *
 * Sidebar expandida: cada grupo (inclusive o aninhado) é um botão com seta
 * que abre/fecha; os grupos que contêm a página atual começam abertos.
 * Sidebar recolhida (e celular): o ícone do grupo leva ao primeiro link, e
 * passar o mouse ou focar nele abre um painel flutuante com a árvore toda
 * (`group-hover` / `group-focus-within`, então o teclado também chega lá).
 */
export function SidebarNav({ papel, ocultar = [] }: { papel: Cargo; ocultar?: string[] }) {
  const pathname = useRotaInterna()
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})
  const itens = filtrarMenu(papel).filter((n) => !ocultar.includes(n.chave))
  const ativo = hrefAtivoMenu(pathname, itens)

  const estaAberto = (n: No) => abertos[n.chave] ?? contemMenu(n, ativo)
  const alternar = (n: No) => setAbertos((a) => ({ ...a, [n.chave]: !estaAberto(n) }))

  return (
    <nav
      aria-label="Menu principal"
      className="flex-1 overflow-y-auto p-3 group-data-[sidebar=recolhida]/shell:overflow-visible group-data-[sidebar=recolhida]/shell:px-2"
    >
      <ul className="space-y-1">
        {itens.map((item) =>
          item.filhos ? (
            <GrupoTopo key={item.chave} grupo={item} ativo={ativo} estaAberto={estaAberto} alternar={alternar} />
          ) : (
            <li key={item.chave}>
              <Link
                href={item.href!}
                title={item.rotulo}
                aria-current={item.href === ativo ? 'page' : undefined}
                className={`${linhaBase} ${item.href === ativo ? linhaAtiva : linhaInativa}`}
              >
                <IconeDo no={item} />
                <span className="truncate group-data-[sidebar=recolhida]/shell:sr-only">{item.rotulo}</span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  )
}

type PropsArvore = {
  ativo: string | undefined
  estaAberto: (n: No) => boolean
  alternar: (n: No) => void
}

function GrupoTopo({ grupo, ativo, estaAberto, alternar }: PropsArvore & { grupo: No }) {
  const aberto = estaAberto(grupo)
  const ancestral = contemMenu(grupo, ativo)
  const idLista = `submenu-${grupo.chave}`

  return (
    <li className="group/item relative">
      {/* Expandida: abre/fecha os subitens. */}
      <button
        type="button"
        onClick={() => alternar(grupo)}
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-label={grupo.titulo}
        title={grupo.titulo ?? grupo.rotulo}
        className={`${linhaBase} w-full group-data-[sidebar=recolhida]/shell:hidden ${ancestral ? `${linhaAncestral} hover:bg-premium-card` : linhaInativa}`}
      >
        <IconeDo no={grupo} className={`size-5 ${ancestral ? 'text-premium-acento' : ''}`} />
        <span className="flex-1 truncate text-left">{grupo.rotulo}</span>
        <IconeSeta className={`size-4 text-premium-mudo transition-transform motion-reduce:transition-none ${aberto ? 'rotate-90' : ''}`} />
      </button>

      {aberto && (
        <ul id={idLista} className="mt-0.5 ml-[21px] space-y-0.5 border-l border-premium-borda pl-2 group-data-[sidebar=recolhida]/shell:hidden">
          {grupo.filhos!.map((f) => (
            <NoArvore key={f.chave} no={f} ativo={ativo} estaAberto={estaAberto} alternar={alternar} />
          ))}
        </ul>
      )}

      {/* Recolhida: ícone leva ao primeiro link; o painel mostra a árvore. */}
      <Link
        href={folhasMenu(grupo.filhos!)[0].href!}
        aria-label={grupo.titulo ?? grupo.rotulo}
        className={`${linhaBase} hidden group-data-[sidebar=recolhida]/shell:flex ${ancestral ? linhaAtiva : linhaInativa}`}
      >
        <IconeDo no={grupo} />
      </Link>

      <div className="absolute top-0 left-full z-40 hidden pl-2 group-data-[sidebar=recolhida]/shell:group-focus-within/item:block group-data-[sidebar=recolhida]/shell:group-hover/item:block">
        <div className="min-w-48 rounded-md border border-premium-borda bg-premium-elevado p-1 shadow-premium-alta">
          <p className="px-2.5 py-1.5 text-xs font-semibold tracking-wide text-premium-mudo uppercase">{grupo.titulo ?? grupo.rotulo}</p>
          <ul className="space-y-0.5">
            {grupo.filhos!.map((f) => (
              <NoPainel key={f.chave} no={f} ativo={ativo} />
            ))}
          </ul>
        </div>
      </div>
    </li>
  )
}

/** Subitem da sidebar expandida: link, ou grupo aninhado com seta própria. */
function NoArvore({ no, ativo, estaAberto, alternar }: PropsArvore & { no: No }) {
  if (!no.filhos) {
    const atual = no.href === ativo
    return (
      <li>
        <Link
          href={no.href!}
          aria-current={atual ? 'page' : undefined}
          className={`${subLinha} ${atual ? linhaAtiva : linhaInativa}`}
        >
          <IconeDo no={no} className="size-4" />
          <span className="truncate">{no.rotulo}</span>
        </Link>
      </li>
    )
  }

  const aberto = estaAberto(no)
  const ancestral = contemMenu(no, ativo)
  const idLista = `submenu-${no.chave}`
  return (
    <li>
      <button
        type="button"
        onClick={() => alternar(no)}
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-label={no.titulo}
        title={no.titulo ?? no.rotulo}
        className={`${subLinha} ${ancestral ? `${linhaAncestral} hover:bg-premium-card` : linhaInativa}`}
      >
        <IconeDo no={no} className={`size-4 ${ancestral ? 'text-premium-acento' : ''}`} />
        <span className="flex-1 truncate text-left">{no.rotulo}</span>
        <IconeSeta className={`size-3.5 text-premium-mudo transition-transform motion-reduce:transition-none ${aberto ? 'rotate-90' : ''}`} />
      </button>
      {aberto && (
        <ul id={idLista} className="mt-0.5 ml-[17px] space-y-0.5 border-l border-premium-borda pl-2">
          {no.filhos.map((f) => (
            <NoArvore key={f.chave} no={f} ativo={ativo} estaAberto={estaAberto} alternar={alternar} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Painel flutuante (sidebar recolhida): grupo aninhado vira título com recuo. */
function NoPainel({ no, ativo }: { no: No; ativo: string | undefined }) {
  if (!no.filhos) {
    const atual = no.href === ativo
    return (
      <li>
        <Link href={no.href!} aria-current={atual ? 'page' : undefined} className={`${subLinha} ${atual ? linhaAtiva : linhaInativa}`}>
          <IconeDo no={no} className="size-4" />
          <span className="truncate">{no.rotulo}</span>
        </Link>
      </li>
    )
  }
  return (
    <li>
      <p className="mt-1 flex items-center gap-2.5 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-premium-mudo uppercase">
        <IconeDo no={no} className="size-3.5" />
        {no.rotulo}
      </p>
      <ul className="ml-[17px] space-y-0.5 border-l border-premium-borda pl-2">
        {no.filhos.map((f) => (
          <NoPainel key={f.chave} no={f} ativo={ativo} />
        ))}
      </ul>
    </li>
  )
}
