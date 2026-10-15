'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { inputClass } from '@/components/ui/estilos'

const ATRASO_MS = 300

/**
 * "Pesquisar conforme digita" — nunca baixa a tabela inteira: só atualiza
 * `?q=` na URL (debounced), e quem filtra de verdade continua sendo
 * `listarClientes()` no servidor (reaproveita `filtroDeBusca`, o mesmo
 * usado por `buscarClientesParaSelecao`). Sem chamada própria ao banco
 * aqui — é só UX em cima da busca server-side que já existia.
 */
export function BuscaClientes({ valorInicial }: { valorInicial: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [valor, setValor] = useState(valorInicial)
  const [, iniciarBusca] = useTransition()

  useEffect(() => {
    const id = setTimeout(() => {
      iniciarBusca(() => {
        const params = new URLSearchParams(searchParams.toString())
        if (valor) params.set('q', valor)
        else params.delete('q')
        params.delete('pagina')
        const query = params.toString()
        router.replace(query ? `${pathname}?${query}` : pathname)
      })
    }, ATRASO_MS)

    return () => clearTimeout(id)
    // Só redispara quando o texto digitado muda — incluir router/pathname/
    // searchParams reexecutaria o debounce a cada navegação que eles
    // próprios causam (router.replace muda searchParams, que religaria o
    // efeito, que chamaria router.replace de novo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  return (
    <input
      type="search"
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      placeholder="Pesquisar cliente…"
      aria-label="Pesquisar clientes"
      className={inputClass}
    />
  )
}
