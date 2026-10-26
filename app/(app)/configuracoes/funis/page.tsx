import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { botaoPrimarioClass, caixaErroClass, cartaoClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarFunisComUso } from '@/lib/dal/funis'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

export const metadata: Metadata = {
  title: 'Funis',
}

export default async function FunisPage({ searchParams }: PageProps<'/configuracoes/funis'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { erro } = await searchParams
  const funis = await listarFunisComUso()

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderPremium
        titulo="Funis"
        subtitulo="Cada funil tem etapas, ordem e cores próprias. O Funil Principal é o padrão do sistema."
        voltar={{ href: '/configuracoes', rotulo: 'Configurações' }}
        acoes={
          <Link href="/configuracoes/funis/novo" className={botaoPrimarioClass}>
            Novo funil
          </Link>
        }
      />

      {typeof erro === 'string' && (
        <p role="alert" className={caixaErroClass}>
          {erro}
        </p>
      )}

      <ul className={`${cartaoClass} divide-y divide-premium-borda-suave`}>
        {funis.map((f) => (
          <li key={f.id}>
            <Link
              href={`/configuracoes/funis/${f.id}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-premium-bg"
            >
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {f.nome}
                  {f.padrao && (
                    <span className="rounded bg-premium-bg px-1.5 py-0.5 text-xs font-normal text-premium-secundario">padrão</span>
                  )}
                  {!f.ativo && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      desativado
                    </span>
                  )}
                </p>
                {f.descricao && <p className="text-sm text-premium-secundario">{f.descricao}</p>}
              </div>
              <span className="text-sm tabular-nums text-premium-mudo">
                {f.negociacoesAtuais} {f.negociacoesAtuais === 1 ? 'negociação' : 'negociações'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
