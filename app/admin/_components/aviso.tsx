/** Mensagem de retorno das actions (?ok= / ?erro=). Texto vindo da URL, renderizado como texto. */
export function Aviso({ ok, erro }: { ok?: string | string[]; erro?: string | string[] }) {
  const mensagemOk = Array.isArray(ok) ? ok[0] : ok
  const mensagemErro = Array.isArray(erro) ? erro[0] : erro
  if (mensagemErro) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {mensagemErro}
      </p>
    )
  }
  if (mensagemOk) {
    return (
      <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        {mensagemOk}
      </p>
    )
  }
  return null
}

export const ROTULO_STATUS_EMPRESA: Record<string, string> = {
  teste: 'Teste',
  ativo: 'Ativa',
  suspenso: 'Suspensa',
  cancelado: 'Cancelada',
  arquivo: 'Arquivo (somente leitura)',
}

export const ROTULO_TIPO_EMPRESA: Record<string, string> = {
  assinante: 'Assinante',
  interno: 'Interna',
  arquivo: 'Arquivo',
}
