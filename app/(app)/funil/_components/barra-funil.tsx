'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { inputClass, botaoSecundarioClass, botaoPrimarioClass } from '@/components/ui/estilos'
import type { Funil } from '@/lib/dal/funis'
import { ROTULO_TEMPERATURA, TEMPERATURAS } from '@/lib/validations/negociacao'

import { SeletorFunil } from './seletor-funil'

const selectClass = `${inputClass} w-auto py-2 pr-8`
const botaoClass = botaoSecundarioClass

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
    <div className="flex flex-wrap items-end gap-2">
      <SeletorFunil funis={funis} funilId={funilId} variant="premium" />

      <div>
        <label className="mb-1 block text-xs text-premium-mudo" htmlFor="filtro-responsavel">
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
      </div>

      <div>
        <label className="mb-1 block text-xs text-premium-mudo" htmlFor="filtro-temperatura">
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
      </div>

      <span className="flex-1" />

      {podeConfigurar && (
        <Link href={`/configuracoes/funis/${funilId}`} className={botaoClass}>
          Configurar funil
        </Link>
      )}
      <Link
        href={`/funil/nova?funil=${funilId}`}
        className={botaoPrimarioClass}
      >
        + Nova entrada
      </Link>
    </div>
  )
}
