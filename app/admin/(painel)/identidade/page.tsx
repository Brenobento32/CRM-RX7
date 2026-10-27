import type { Metadata } from 'next'

import { LogoAvante } from '@/components/marca/logo-avante'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { botaoPerigoClass, cartaoClass, legendaClass } from '@/components/ui/estilos'
import { removerLogoPlataformaAction, salvarLogoPlataformaAction } from '@/lib/actions/super-admin'
import { LOGO_OFICIAL, obterIdentidadeAvante } from '@/lib/dal/identidade'
import { exigirSuperAdmin } from '@/lib/dal/super-admin'

import { Aviso } from '@/app/admin/_components/aviso'
import { CampoLogoPlataforma } from '@/app/admin/_components/campo-logo-plataforma'

export const metadata: Metadata = {
  title: 'Identidade do AVANTE CRM',
}

type Busca = Promise<Record<string, string | string[] | undefined>>

const VARIANTES = [
  {
    variante: 'claro',
    titulo: 'Logo para fundo claro',
    descricao: 'Usada no tema claro: menu lateral, cabeçalho, login no celular e telas institucionais.',
  },
  { variante: 'escuro', titulo: 'Logo para fundo escuro', descricao: 'Usada no tema escuro e na capa do login (sempre escura).' },
] as const

/**
 * Identidade GLOBAL do AVANTE CRM — a marca da plataforma, igual para todas as
 * empresas. (O logotipo de cada empresa cliente fica no cadastro dela.) Sem
 * logo personalizada, vale a oficial embutida da mesma variante.
 */
export default async function IdentidadePage({ searchParams }: { searchParams: Busca }) {
  await exigirSuperAdmin()
  const [identidade, params] = await Promise.all([obterIdentidadeAvante(), searchParams])

  return (
    <div className="space-y-4">
      <PageHeaderPremium
        titulo="Identidade do AVANTE CRM"
        subtitulo="A marca da plataforma, igual para todas as empresas. O logotipo de cada empresa cliente é editado no cadastro dela."
      />

      <Aviso ok={params.ok} erro={params.erro} />

      <section className={`${cartaoClass} space-y-3 p-5`}>
        <h2 className={legendaClass}>Como aparece agora</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex h-24 items-center justify-center rounded-lg border border-black/10 bg-[#f5f6f4] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo do storage ou de /public */}
            <img src={identidade.claro} alt="AVANTE CRM no tema claro" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="flex h-24 items-center justify-center rounded-lg border border-white/10 bg-[#0c0f11] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo do storage ou de /public */}
            <img src={identidade.escuro} alt="AVANTE CRM no tema escuro" className="max-h-full max-w-full object-contain" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-premium-mudo">
          <span>Neste tema:</span>
          <LogoAvante identidade={identidade} className="h-6 w-auto" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {VARIANTES.map((v) => {
          const personalizada = identidade.personalizada[v.variante] !== null
          return (
            <section key={v.variante} data-variante={v.variante} className={`${cartaoClass} space-y-4 p-5`}>
              <div>
                <h2 className={legendaClass}>{v.titulo}</h2>
                <p className="text-xs text-premium-mudo">{v.descricao}</p>
              </div>
              <form action={salvarLogoPlataformaAction} className="space-y-3">
                <input type="hidden" name="variante" value={v.variante} />
                <CampoLogoPlataforma variante={v.variante} emUso={identidade[v.variante]} personalizada={personalizada} />
              </form>
              {personalizada ? (
                <form action={removerLogoPlataformaAction} className="border-t border-premium-borda pt-3">
                  <input type="hidden" name="variante" value={v.variante} />
                  <button type="submit" className={botaoPerigoClass}>
                    Remover logo personalizada
                  </button>
                  <span className="ml-3 text-xs text-premium-mudo">Volta a logo oficial ({LOGO_OFICIAL[v.variante]}).</span>
                </form>
              ) : (
                <p className="border-t border-premium-borda pt-3 text-xs text-premium-mudo">Usando a logo oficial do AVANTE CRM.</p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
