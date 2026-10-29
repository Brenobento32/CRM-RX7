import Link from 'next/link'

import { MarcaAvante } from '@/components/marca/logo-avante'
import { DADOS_LEGAIS } from '@/lib/legal/dados-legais'

/**
 * Páginas públicas do AVANTE (apresentação, privacidade e termos): abrem sem
 * login, também para os verificadores do Google e da Meta. Nada aqui lê dados
 * de empresas, usuários ou negociações; só a marca global da plataforma.
 */
export default function PublicoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-premium-bg">
      <header className="border-b border-premium-borda-suave bg-premium-topo/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="AVANTE CRM — início" className="shrink-0">
            <MarcaAvante className="h-8 w-auto" />
          </Link>
          <nav aria-label="Páginas públicas" className="flex items-center gap-1 text-sm sm:gap-2">
            <Link href="/privacidade" className="hidden rounded-md px-2.5 py-1.5 text-premium-secundario hover:text-premium-texto sm:inline-block">
              Privacidade
            </Link>
            <Link href="/termos" className="hidden rounded-md px-2.5 py-1.5 text-premium-secundario hover:text-premium-texto sm:inline-block">
              Termos
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-premium-acento px-3.5 py-2 font-medium text-premium-acento-texto shadow-sm hover:bg-premium-acento-forte"
            >
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <RodapePublico />
    </div>
  )
}

function RodapePublico() {
  return (
    <footer className="border-t border-premium-borda-suave">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-premium-mudo sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p>AVANTE CRM · {DADOS_LEGAIS.marca}</p>
          {DADOS_LEGAIS.razaoSocial && DADOS_LEGAIS.cnpj && (
            <p className="text-xs">
              {DADOS_LEGAIS.razaoSocial} · CNPJ {DADOS_LEGAIS.cnpj}
            </p>
          )}
        </div>
        <nav aria-label="Documentos" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/privacidade" className="hover:text-premium-texto">
            Política de Privacidade
          </Link>
          <Link href="/termos" className="hover:text-premium-texto">
            Termos de Uso
          </Link>
          <Link href="/privacidade#exclusao-de-dados" className="hover:text-premium-texto">
            Exclusão de dados
          </Link>
        </nav>
      </div>
    </footer>
  )
}
