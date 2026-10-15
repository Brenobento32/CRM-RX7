'use client'

import { useEffect, useState, useTransition } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass } from '@/components/ui/estilos'
import { buscarClientesAction } from '@/lib/actions/funis'
import type { OpcaoClienteBusca } from '@/lib/dal/clientes'

/** Só dispara a busca depois de parar de digitar — evita 1 chamada por tecla. */
const ATRASO_MS = 300

/**
 * Campo "Pesquisar cliente": digita, filtra no servidor (nunca baixa a
 * tabela inteira — `buscarClientesAction` só consulta quando há termo, e
 * sempre limitado). Sem cliente selecionado: input de busca + lista de
 * resultados. Com cliente selecionado: mostra o nome escolhido e um botão
 * pra trocar. `cliente_id` vai escondido no form, pro mesmo `<form>` que já
 * existia continuar funcionando sem mudança na action.
 */
export function SeletorClienteBusca({
  valorInicial,
  erro,
}: {
  valorInicial?: OpcaoClienteBusca
  erro?: string
}) {
  const [selecionado, setSelecionado] = useState<OpcaoClienteBusca | null>(valorInicial ?? null)
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<OpcaoClienteBusca[]>([])
  const [buscando, iniciarBusca] = useTransition()
  const [jaBuscou, setJaBuscou] = useState(false)

  useEffect(() => {
    // Todo o estado derivado do termo (incluindo "limpar quando vazio") só
    // muda dentro do callback assíncrono do debounce — nunca de forma
    // síncrona no corpo do efeito.
    const id = setTimeout(() => {
      if (termo.trim() === '') {
        setResultados([])
        setJaBuscou(false)
        return
      }
      iniciarBusca(async () => {
        const r = await buscarClientesAction(termo)
        setResultados(r)
        setJaBuscou(true)
      })
    }, ATRASO_MS)

    return () => clearTimeout(id)
  }, [termo])

  return (
    <div className="space-y-1.5">
      <label htmlFor="busca_cliente" className="block text-sm font-medium">
        Cliente
      </label>

      <input type="hidden" name="cliente_id" value={selecionado?.id ?? ''} />

      {selecionado ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <span className="truncate">
            <span className="font-medium">{selecionado.nome}</span>
            {selecionado.empresa ? ` · ${selecionado.empresa}` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelecionado(null)
              setTermo('')
              setResultados([])
            }}
            className="shrink-0 text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Trocar
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            id="busca_cliente"
            type="text"
            autoComplete="off"
            placeholder="Digite as primeiras letras do nome…"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'cliente_id-erro' : undefined}
            className={inputClass}
          />

          {termo.trim() !== '' && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
              {buscando ? (
                <p className="px-3 py-2 text-sm text-zinc-500">Buscando…</p>
              ) : resultados.length > 0 ? (
                <ul>
                  {resultados.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelecionado(c)
                          setTermo('')
                          setResultados([])
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="font-medium">{c.nome}</span>
                        {c.empresa ? ` · ${c.empresa}` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : jaBuscou ? (
                <p className="px-3 py-2 text-sm text-zinc-500">Nenhum cliente encontrado.</p>
              ) : null}
            </div>
          )}
        </div>
      )}

      <ErroCampo id="cliente_id-erro" mensagem={erro} />
    </div>
  )
}
