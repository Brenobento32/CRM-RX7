import Link from 'next/link'

import { MarcaAvante } from '@/components/marca/logo-avante'

/**
 * Telas de acesso (login, recuperação, redefinição, escolha de empresa):
 * painel da marca à esquerda (só em telas largas) e o formulário à direita.
 * O painel é sempre grafite com o verde da marca, nos dois temas — é a
 * "capa" do AVANTE; o formulário segue o tema escolhido.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid flex-1 bg-premium-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden bg-[#0c0f11] p-12 text-white lg:flex"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 70% 55% at 15% 0%, rgb(45 212 167 / 0.18), transparent 60%), radial-gradient(ellipse 50% 40% at 100% 100%, rgb(45 212 167 / 0.08), transparent 70%), linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px)',
          backgroundSize: 'auto, auto, 48px 48px, 48px 48px',
        }}
      >
        {/* Capa sempre escura: logo da variante escura (identidade global do AVANTE CRM). */}
        <MarcaAvante fundo="escuro" className="h-12 w-auto self-start" />

        <div className="max-w-md">
          <p className="text-sm font-medium tracking-wide text-[#5ee3c0] uppercase">Gestão comercial</p>
          <h2 className="mt-3 text-4xl leading-tight font-semibold tracking-tight">
            Do primeiro contato ao fechamento, num só lugar.
          </h2>
          <ul className="mt-8 space-y-3 text-[15px] text-white/75">
            {['Funil com etapas e permissões por cargo', 'Agenda da equipe com aviso de conflito', 'Metas de vendas e de reuniões em tempo real'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-[#2dd4a7]/15 text-[#2dd4a7]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="size-3">
                    <path d="m5 12 4.5 4.5L19 7" />
                  </svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/45">Rio X7 Agência Digital</p>
      </aside>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Marca compacta no celular/tablet (o painel some em telas estreitas). */}
          <div className="mb-8 lg:hidden">
            <MarcaAvante className="h-9 w-auto" />
          </div>
          {children}
          <nav aria-label="Documentos" className="mt-10 flex flex-wrap gap-x-4 gap-y-1 text-xs text-premium-mudo">
            <Link href="/apresentacao" className="hover:text-premium-texto">
              Sobre o AVANTE
            </Link>
            <Link href="/privacidade" className="hover:text-premium-texto">
              Política de Privacidade
            </Link>
            <Link href="/termos" className="hover:text-premium-texto">
              Termos de Uso
            </Link>
          </nav>
        </div>
      </div>
    </main>
  )
}
