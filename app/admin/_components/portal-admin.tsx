import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { Aviso } from '@/components/ui/aviso'
import { logoutAdmin } from '@/lib/actions/auth'

import { LoginAdminForm } from './login-admin-form'
import { MarcaAdmin } from './marca-admin'

const IconeEscudo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

/**
 * Moldura das telas de entrada do portal da administração: identificação
 * "AVANTE — Administração", selo de área restrita e nenhum link para o portal
 * dos clientes (não se confundem os dois acessos).
 */
function MolduraPortal({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-premium-bg">
      {/* Grade discreta: marca visual do portal administrativo, nos dois temas. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(var(--color-premium-borda-suave)_1px,transparent_1px),linear-gradient(90deg,var(--color-premium-borda-suave)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
      <header className="relative flex justify-center px-4 pt-10 sm:pt-16">
        <MarcaAdmin grande />
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-premium-borda bg-premium-card shadow-premium-alta">
          <div aria-hidden className="h-1 bg-premium-acento" />
          <div className="p-6 sm:p-8">{children}</div>
        </div>
      </main>
      <footer className="relative pb-8 text-center text-xs text-premium-mudo">Acessos e ações administrativas são registrados.</footer>
    </div>
  )
}

function Selo() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-premium-acento-suave px-2.5 py-1 text-xs font-medium text-premium-acento">
      <IconeEscudo className="size-3.5" />
      Área restrita
    </span>
  )
}

/** `/admin` sem sessão: login administrativo. */
export function LoginAdminTela({ next, senhaRedefinida }: { next: string; senhaRedefinida: boolean }) {
  return (
    <MolduraPortal>
      <Selo />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-premium-texto">Entrar na administração</h1>
      <p className="mt-1.5 text-sm text-premium-secundario">Painel global da plataforma, exclusivo da equipe Rio X7.</p>
      {senhaRedefinida && (
        <div className="mt-5">
          <Aviso tom="sucesso">Senha atualizada. Entre com sua nova senha.</Aviso>
        </div>
      )}
      <div className="mt-6">
        <LoginAdminForm next={next} />
      </div>
    </MolduraPortal>
  )
}

/** `/admin` com sessão de quem não tem o privilégio global: nada do painel é carregado. */
export function AcessoRestritoAdmin() {
  return (
    <MolduraPortal>
      <Selo />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-premium-texto">Acesso restrito</h1>
      <p className="mt-1.5 text-sm text-premium-secundario">
        Sua conta não tem permissão para a administração da plataforma. Nenhuma informação administrativa foi carregada.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- voltar à empresa recarrega a área interna */}
        <a href="/" className={`${botaoPrimarioClass} sm:flex-1`}>
          Ir para minha empresa
        </a>
        <form action={logoutAdmin} className="sm:flex-1">
          <button type="submit" className={`${botaoSecundarioClass} w-full`}>
            Sair e trocar de conta
          </button>
        </form>
      </div>
    </MolduraPortal>
  )
}
