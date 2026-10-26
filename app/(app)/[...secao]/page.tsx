import { notFound } from 'next/navigation'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { exigirCargo } from '@/lib/dal/auth'
import { CARGOS_POR_AREA } from '@/lib/validations/usuario'

const EM_BREVE: Record<string, string> = {
  relatorios: 'Relatórios',
  'relatorios/vendas': 'Vendas',
  'relatorios/conversao': 'Conversão',
  'relatorios/exportacao': 'Exportação',
}

export default async function EmBrevePage({
  params,
}: PageProps<'/[...secao]'>) {
  await exigirCargo(CARGOS_POR_AREA.relatorios)

  const { secao } = await params
  const titulo = EM_BREVE[secao.join('/')]

  if (!titulo) notFound()

  return (
    <div className="space-y-6">
      <PageHeaderPremium contexto="Relatórios" titulo={titulo} subtitulo="Relatórios consolidados da sua carteira e da equipe." />
      <EstadoVazio
        titulo="Este relatório está em construção"
        descricao="Enquanto isso, as métricas do funil e as metas já mostram vendas, conversão e desempenho do período."
        acao={{ href: '/funil/metricas', rotulo: 'Ver métricas do funil' }}
        acaoSecundaria={{ href: '/metas', rotulo: 'Ver metas' }}
      />
    </div>
  )
}
