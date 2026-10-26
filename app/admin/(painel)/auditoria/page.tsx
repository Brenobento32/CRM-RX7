import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { tabelaCaixaClass, tabelaClass, tbodyClass, tdClass, thClass, theadClass } from '@/components/ui/estilos'
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
      <PageHeaderPremium titulo="Auditoria" subtitulo="Últimas 200 ações administrativas: criação de empresas, assinaturas, suspensões e planos." />
      {eventos.length === 0 ? (
        <EstadoVazio titulo="Nenhuma ação registrada" descricao="Criações, mudanças de assinatura e suspensões feitas no painel aparecem aqui." />
      ) : (
        <div className={tabelaCaixaClass}>
          <table className={tabelaClass}>
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Quando</th>
                <th className={thClass}>Ação</th>
                <th className={thClass}>Empresa</th>
                <th className={thClass}>Quem</th>
                <th className={thClass}>Motivo</th>
              </tr>
            </thead>
            <tbody className={tbodyClass}>
              {eventos.map((e) => (
                <tr key={e.id}>
                  <td className={`${tdClass} whitespace-nowrap`}>{formatarDataHoraCompleta(e.criado_em)}</td>
                  <td className={tdClass}>{e.acao}</td>
                  <td className={tdClass}>
                    {e.tenant_id ? (
                      <Link href={`/admin/empresas/${e.tenant_id}`} className="font-medium hover:underline">
                        {e.empresa}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={tdClass}>{e.ator_email ?? '—'}</td>
                  <td className={tdClass}>
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
