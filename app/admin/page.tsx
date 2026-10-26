import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoPrimarioClass, linhaClass, tabelaCaixaClass, tabelaClass, theadClass } from '@/components/ui/estilos'
import { listarEmpresas } from '@/lib/dal/super-admin'
import { formatarData } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_ASSINATURA } from '@/lib/validations/super-admin'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

import { Aviso, ROTULO_STATUS_EMPRESA, ROTULO_TIPO_EMPRESA } from './_components/aviso'

export const metadata: Metadata = {
  title: 'Empresas',
}

type Busca = Promise<Record<string, string | string[] | undefined>>

export default async function AdminEmpresasPage({ searchParams }: { searchParams: Busca }) {
  const [empresas, params] = await Promise.all([listarEmpresas(), searchParams])

  return (
    <div className="space-y-4">
      <PageHeaderPremium
        titulo="Empresas"
        subtitulo="Cadastro, usuários e assinatura de cada empresa. Os dados comerciais das empresas não aparecem aqui."
        acoes={
          <Link href="/admin/empresas/nova" className={botaoPrimarioClass}>
            Nova empresa
          </Link>
        }
      />

      <Aviso ok={params.ok} erro={params.erro} />

      <div className={tabelaCaixaClass}>
        <table className={tabelaClass}>
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3">Assinatura</th>
              <th className="px-4 py-3">Renovação</th>
              <th className="px-4 py-3 text-right tabular-nums">Usuários</th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id} className={linhaClass}>
                <td className="px-4 py-3">
                  <Link href={`/admin/empresas/${e.id}`} className="font-medium hover:underline">
                    {e.nome}
                  </Link>
                  <span className="block text-xs text-premium-mudo">{e.slug}</span>
                </td>
                <td className="px-4 py-3">{ROTULO_TIPO_EMPRESA[e.tipo]}</td>
                <td className="px-4 py-3">{ROTULO_STATUS_EMPRESA[e.status]}</td>
                <td className="px-4 py-3">{e.plano_nome ?? '—'}</td>
                <td className="px-4 py-3">{e.assinatura_status ? ROTULO_STATUS_ASSINATURA[e.assinatura_status] : '—'}</td>
                <td className="px-4 py-3">{e.renovacao_em ? formatarData(e.renovacao_em) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.usuarios_ativos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
