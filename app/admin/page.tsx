import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoPrimarioClass } from '@/components/ui/estilos'
import { listarEmpresas } from '@/lib/dal/super-admin'
import { formatarData } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_ASSINATURA } from '@/lib/validations/super-admin'

import { Aviso, ROTULO_STATUS_EMPRESA, ROTULO_TIPO_EMPRESA } from './_components/aviso'

export const metadata: Metadata = {
  title: 'Empresas',
}

type Busca = Promise<Record<string, string | string[] | undefined>>

export default async function AdminEmpresasPage({ searchParams }: { searchParams: Busca }) {
  const [empresas, params] = await Promise.all([listarEmpresas(), searchParams])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Empresas</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Cadastro, usuários e assinatura de cada empresa. Os dados comerciais das empresas não aparecem aqui.
          </p>
        </div>
        <Link href="/admin/empresas/nova" className={botaoPrimarioClass}>
          Nova empresa
        </Link>
      </div>

      <Aviso ok={params.ok} erro={params.erro} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Plano</th>
              <th className="px-3 py-2">Assinatura</th>
              <th className="px-3 py-2">Renovação</th>
              <th className="px-3 py-2 text-right">Usuários</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {empresas.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2">
                  <Link href={`/admin/empresas/${e.id}`} className="font-medium hover:underline">
                    {e.nome}
                  </Link>
                  <span className="block text-xs text-zinc-500">{e.slug}</span>
                </td>
                <td className="px-3 py-2">{ROTULO_TIPO_EMPRESA[e.tipo]}</td>
                <td className="px-3 py-2">{ROTULO_STATUS_EMPRESA[e.status]}</td>
                <td className="px-3 py-2">{e.plano_nome ?? '—'}</td>
                <td className="px-3 py-2">{e.assinatura_status ? ROTULO_STATUS_ASSINATURA[e.assinatura_status] : '—'}</td>
                <td className="px-3 py-2">{e.renovacao_em ? formatarData(e.renovacao_em) : '—'}</td>
                <td className="px-3 py-2 text-right">{e.usuarios_ativos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
