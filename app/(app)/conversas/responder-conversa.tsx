'use client'

import { useActionState, useEffect, useRef } from 'react'

import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { enviarWhatsappAction, type EstadoEnvio } from '@/lib/actions/integracoes-oficiais'

/** Resposta de texto dentro da janela gratuita. O servidor confere tudo de novo antes de falar com a Meta. */
export function ResponderConversa({ conversaId, abertaAte }: { conversaId: string; abertaAte: string | null }) {
  const [estado, acao, enviando] = useActionState<EstadoEnvio, FormData>(enviarWhatsappAction, {})
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (estado.ok) form.current?.reset()
  }, [estado])
  const ate = abertaAte ? new Date(abertaAte).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : null
  return (
    <form ref={form} action={acao} className="space-y-2">
      <input type="hidden" name="conversa" value={conversaId} />
      <label className="block text-sm">
        <span className="sr-only">Mensagem</span>
        <textarea name="texto" required maxLength={4096} rows={3} className={inputClass} placeholder="Escreva a resposta…" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-premium-mudo">Resposta gratuita liberada {ate ? `até ${ate}` : 'dentro da janela de 24 h'}.</p>
        <button type="submit" disabled={enviando} className={botaoPrimarioClass}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
      {estado.erro && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {estado.erro}
        </p>
      )}
    </form>
  )
}
