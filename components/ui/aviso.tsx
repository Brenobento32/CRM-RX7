type Tom = 'sucesso' | 'erro' | 'alerta' | 'info'

const ESTILO: Record<Tom, { caixa: string; icone: React.ReactNode }> = {
  sucesso: {
    caixa: 'border-emerald-600/25 bg-emerald-600/8 text-emerald-800 dark:text-emerald-200',
    icone: <path d="m5 12 4.5 4.5L19 7" />,
  },
  erro: {
    caixa: 'border-red-600/25 bg-red-600/8 text-red-800 dark:text-red-200',
    icone: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" />
      </>
    ),
  },
  alerta: {
    caixa: 'border-amber-600/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
    icone: <path d="M12 4 2.5 20h19L12 4ZM12 10v4M12 17v.01" />,
  },
  info: {
    caixa: 'border-premium-borda bg-premium-bg text-premium-secundario',
    icone: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8v.01" />
      </>
    ),
  },
}

/**
 * Mensagem de retorno (sucesso, erro, alerta, informação). Erro usa
 * `role="alert"` (lido na hora); os demais `role="status"`. O texto pode vir
 * da URL (`?ok=`/`?erro=` das actions): é sempre renderizado como texto.
 */
export function Aviso({ tom = 'info', titulo, children }: { tom?: Tom; titulo?: string; children?: React.ReactNode }) {
  const e = ESTILO[tom]
  return (
    <div role={tom === 'erro' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${e.caixa}`}>
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 size-4 shrink-0">
        {e.icone}
      </svg>
      <div className="min-w-0">
        {titulo && <p className="font-medium">{titulo}</p>}
        {children && <div className={titulo ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
    </div>
  )
}

/** `?ok=` / `?erro=` vindos de uma Server Action, prontos para a página. */
export function AvisoDaUrl({ ok, erro }: { ok?: string | string[]; erro?: string | string[] }) {
  const mensagemErro = Array.isArray(erro) ? erro[0] : erro
  const mensagemOk = Array.isArray(ok) ? ok[0] : ok
  if (mensagemErro) return <Aviso tom="erro">{mensagemErro}</Aviso>
  if (mensagemOk) return <Aviso tom="sucesso">{mensagemOk}</Aviso>
  return null
}
