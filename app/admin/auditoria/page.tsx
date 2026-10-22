import type { Metadata } from 'next'
import Link from 'next/link'

import { listarAuditoria } from '@/lib/dal/super-admin'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

export const metadata: Metadata = {
  title: 'Auditoria',
}

/** Últimas 200 ações administrativas (criação, assinatura, suspensão, planos). */
export default async function AuditoriaPage() {
  const eventos = await listarAuditoria(undefined, 200)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Auditoria</h1>
      {eventos.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhuma ação registrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Ação</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Quem</th>
                <th className="px-3 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {eventos.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-2">{formatarDataHoraCompleta(e.criado_em)}</td>
                  <td className="px-3 py-2">{e.acao}</td>
                  <td className="px-3 py-2">
                    {e.tenant_id ? (
                      <Link href={`/admin/empresas/${e.tenant_id}`} className="hover:underline">
                        {e.empresa}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">{e.ator_email ?? '—'}</td>
                  <td className="px-3 py-2">
                    {typeof e.detalhes === 'object' && e.detalhes && 'motivo' in e.detalhes ? String(e.detalhes.motivo) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
