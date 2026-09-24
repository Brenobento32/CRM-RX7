'use client'

/**
 * Botão de envio que pede confirmação antes. Sem JavaScript o formulário
 * envia direto — as regras continuam no servidor e no banco.
 */
export function BotaoConfirmar({
  pergunta,
  className,
  children,
}: {
  pergunta: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(pergunta)) e.preventDefault()
      }}
    >
      {children}
    </button>
  )
}
