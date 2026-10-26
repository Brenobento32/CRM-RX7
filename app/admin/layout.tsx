import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { default: 'Administração', template: '%s · AVANTE Administração' },
  robots: { index: false, follow: false },
}

/**
 * Portal da administração da plataforma. Sem guarda aqui de propósito: em
 * `/admin` a própria página decide entre login administrativo, acesso
 * restrito e painel; as rotas internas ficam em `(painel)`, com a guarda.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
