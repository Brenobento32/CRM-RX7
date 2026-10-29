import { DADOS_LEGAIS, pendencias, type DadosLegais } from '@/lib/legal/dados-legais'

/** Valor confirmado ou marca "a confirmar" bem visível (nunca um dado inventado). */
export function Dado({ campo, rotulo }: { campo: Exclude<keyof DadosLegais, 'marca'>; rotulo: string }) {
  const valor = DADOS_LEGAIS[campo]
  if (valor) return <>{valor}</>
  return <Pendente>{rotulo}</Pendente>
}

/** Trecho que depende de confirmação da Rio X7 ou de revisão jurídica. */
export function Pendente({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded bg-amber-200/70 px-1 py-0.5 text-amber-950 dark:bg-amber-400/25 dark:text-amber-100" data-pendente>
      [a confirmar: {children}]
    </mark>
  )
}

/** Aviso de rascunho enquanto houver dado pendente (some sozinho quando tudo estiver preenchido). */
export function AvisoRascunho({ extra = [] }: { extra?: string[] }) {
  const itens = [...pendencias(), ...extra]
  if (itens.length === 0) return null
  return (
    <div role="note" className="mb-8 rounded-lg border border-amber-400/50 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
      <p className="font-semibold">Rascunho para revisão: não publicar</p>
      <p className="mt-1">Os trechos destacados dependem de confirmação da Rio X7 e de revisão jurídica: {itens.join('; ')}.</p>
    </div>
  )
}

export function Secao({ id, titulo, children }: { id?: string; titulo: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mt-10 mb-3 text-lg font-semibold tracking-tight text-premium-texto">{titulo}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-premium-secundario">{children}</div>
    </section>
  )
}

export function Lista({ itens }: { itens: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {itens.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  )
}

export function CabecalhoLegal({ titulo, resumo }: { titulo: string; resumo: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-3xl font-semibold tracking-tight text-premium-texto sm:text-4xl">{titulo}</h1>
      <p className="mt-3 text-premium-secundario">{resumo}</p>
      <p className="mt-2 text-sm text-premium-mudo">
        Última atualização: <Dado campo="vigencia" rotulo="data dos documentos" />
      </p>
    </header>
  )
}
