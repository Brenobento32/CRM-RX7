'use client'

import { useEffect, useRef, useState } from 'react'

/** Nome que a pessoa vê para o campo: rótulo, legenda do grupo ou nome acessível. */
function rotuloNaTela(form: HTMLFormElement, nome: string): string | null {
  const campo =
    form.querySelector<HTMLElement>(`[name="${CSS.escape(nome)}"]:not([type="hidden"])`) ??
    form.querySelector<HTMLElement>(`#${CSS.escape(nome)}`)
  if (!campo) return null
  const texto =
    (campo.id ? form.querySelector(`label[for="${CSS.escape(campo.id)}"]`)?.textContent : null) ??
    campo.closest('fieldset')?.querySelector('legend')?.textContent ??
    campo.closest('label')?.textContent ??
    campo.getAttribute('aria-label')
  const limpo = texto
    ?.replace(/\((opcional|precisa ser Sim)\)/gi, '')
    .replace(/[?:*]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return limpo || null
}

/**
 * Aviso vermelho junto do botão Salvar/Finalizar: diz quais campos faltam ou
 * estão errados (o erro de cada um continua junto do próprio campo) e leva ao
 * primeiro. Não apaga nada do que foi digitado — só lê o estado da Server
 * Action, que já validou no servidor.
 */
export function ResumoErros({
  campos,
  rotulos,
  erro,
}: {
  /** `campos` devolvidos pela Server Action (Zod flatten). */
  campos?: Record<string, string[] | undefined>
  /** Nome amigável de cada campo; sem ele, usa o rótulo que está na tela. */
  rotulos?: Record<string, string>
  /** Erro geral (do banco), mostrado também aqui perto do botão. */
  erro?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [daTela, setDaTela] = useState<Record<string, string>>({})
  const pendentes = Object.entries(campos ?? {})
    .filter(([, msgs]) => msgs && msgs.length > 0)
    .map(([campo]) => campo)
  const chave = `${pendentes.join(',')}|${erro ?? ''}`

  useEffect(() => {
    if (pendentes.length === 0 && !erro) return
    const form = ref.current?.closest('form')
    if (form) {
      setDaTela(Object.fromEntries(pendentes.flatMap((c) => {
        const r = rotuloNaTela(form, c)
        return r ? [[c, r]] : []
      })))
    }
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // Recalcula e rola a cada novo resultado com erro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  if (pendentes.length === 0 && !erro) return null

  function irParaPrimeiro() {
    const form = ref.current?.closest('form')
    const nome = pendentes[0]
    if (!form || !nome) return
    const alvo =
      form.querySelector<HTMLElement>(`[name="${CSS.escape(nome)}"]:not([type="hidden"])`) ??
      form.querySelector<HTMLElement>(`#${CSS.escape(nome)}`)
    if (!alvo) return
    alvo.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const focavel = alvo.matches('input, select, textarea, button') ? alvo : alvo.querySelector<HTMLElement>('input, select, textarea, button')
    focavel?.focus({ preventScroll: true })
  }

  const nomes = pendentes.map((c) => rotulos?.[c] ?? daTela[c] ?? c)
  return (
    <div
      ref={ref}
      role="alert"
      data-resumo-erros
      className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
    >
      {pendentes.length > 0 ? (
        <p>
          <span className="font-medium">
            {pendentes.length === 1 ? 'Falta corrigir 1 campo' : `Faltam corrigir ${pendentes.length} campos`}:
          </span>{' '}
          {nomes.join(', ')}.{' '}
          <button type="button" onClick={irParaPrimeiro} className="font-medium underline underline-offset-2">
            Ir para o primeiro
          </button>
        </p>
      ) : (
        <p>{erro}</p>
      )}
      {pendentes.length > 0 && erro && <p className="mt-1">{erro}</p>}
    </div>
  )
}
