/** Mensagem de erro de um campo de formulário. */
export function ErroCampo({ id, mensagem }: { id?: string; mensagem?: string }) {
  if (!mensagem) return null
  return (
    <p id={id} className="mt-1 text-sm text-red-600 dark:text-red-400">
      {mensagem}
    </p>
  )
}
