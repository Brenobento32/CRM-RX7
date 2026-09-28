'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import type { Funil } from '@/lib/dal/funis'
import { ROTULO_TEMPERATURA, TEMPERATURAS } from '@/lib/validations/negociacao'

import { SeletorFunil } from './seletor-funil'

const selectClass =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

/**
 * Toolbar do Kanban: funil selecionado, filtros de Responsável e
 * Temperatura (na URL — o servidor filtra os cards), configuração do funil e
 * nova entrada.
 */
export function BarraFunil({
  funis,
  funilId,
  responsaveis,
  podeConfigurar,
}: {
  funis: Pick<Funil, 'id' | 'nome' | 'ativo'>[]
  funilId: string
  responsaveis: string[]
  podeConfigurar: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function atualizarParam(nome: string, valor: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (valor) params.set(nome, valor)
    else params.delete(nome)
    router.push(`${pathname}?${params.toString()}`)
  }

  const responsavelAtual = searchParams.get('responsavel') ?? ''
  const temperaturaAtual = searchParams.get('temperatura') ?? ''

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SeletorFunil funis={funis} funilId={funilId} />

      <label className="sr-only" htmlFor="filtro-responsavel">
        Responsável
      </label>
      <select
        id="filtro-responsavel"
        value={responsavelAtual}
        onChange={(e) => atualizarParam('responsavel', e.target.value)}
        className={selectClass}
      >
        <option value="">Todos os responsáveis</option>
        {responsaveis.map((nome) => (
          <option key={nome} value={nome}>
            {nome}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="filtro-temperatura">
        Temperatura
      </label>
      <select
        id="filtro-temperatura"
        value={temperaturaAtual}
        onChange={(e) => atualizarParam('temperatura', e.target.value)}
        className={selectClass}
      >
        <option value="">Todas as temperaturas</option>
        {TEMPERATURAS.map((t) => (
          <option key={t} value={t}>
            {ROTULO_TEMPERATURA[t]}
          </option>
        ))}
      </select>

      <span className="flex-1" />

      {podeConfigurar && (
        <Link href={`/configuracoes/funis/${funilId}`} className={botaoSecundarioClass}>
          Configurar funil
        </Link>
      )}
      <Link href={`/funil/nova?funil=${funilId}`} className={botaoSecundarioClass}>
        + Nova entrada
      </Link>
    </div>
  )
}
