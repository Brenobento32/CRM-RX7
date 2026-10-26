/**
 * Seção em cartão: título (e descrição) à esquerda, ações à direita, conteúdo
 * abaixo. É o bloco padrão de qualquer painel do AVANTE — dashboards,
 * formulários agrupados, detalhes. `semPadding` para tabelas que encostam na
 * borda do cartão.
 */
export function Secao({
  titulo,
  descricao,
  acoes,
  children,
  className = '',
  semPadding = false,
  id,
}: {
  titulo?: React.ReactNode
  descricao?: React.ReactNode
  acoes?: React.ReactNode
  children: React.ReactNode
  className?: string
  semPadding?: boolean
  id?: string
}) {
  const temCabecalho = titulo || descricao || acoes
  return (
    <section
      id={id}
      aria-labelledby={id && titulo ? `${id}-titulo` : undefined}
      className={`min-w-0 rounded-xl border border-premium-borda bg-premium-card shadow-premium ${className}`}
    >
      {temCabecalho && (
        <header className={`flex flex-wrap items-start justify-between gap-3 ${semPadding ? 'border-b border-premium-borda-suave px-5 py-4' : 'px-5 pt-5'}`}>
          <div className="min-w-0">
            {titulo && (
              <h2 id={id ? `${id}-titulo` : undefined} className="text-[15px] font-semibold tracking-tight text-premium-texto">
                {titulo}
              </h2>
            )}
            {descricao && <p className="mt-0.5 text-xs text-premium-mudo">{descricao}</p>}
          </div>
          {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
        </header>
      )}
      <div className={semPadding ? '' : temCabecalho ? 'px-5 pt-4 pb-5' : 'p-5'}>{children}</div>
    </section>
  )
}
