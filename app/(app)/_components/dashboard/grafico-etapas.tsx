'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { EtapaResumo } from '@/lib/dal/dashboard'
import { formatarMoeda, formatarMoedaCompacta } from '@/lib/utils/formatacao'

import { CaixaTooltip, TabelaDados } from './grafico-comum'

/**
 * Distribuição de valor pelas etapas: estimado nas abertas, vendido em
 * "fechado". Barras horizontais porque os nomes das etapas são longos; um tom
 * só, já que o que se compara é magnitude.
 */
export function GraficoEtapas({ dados }: { dados: EtapaResumo[] }) {
  const pontos = dados.map((d) => ({ ...d, rotulo: d.nome }))

  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={pontos}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--chart-grade)" />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--chart-texto)', fontSize: 12 }}
              tickFormatter={(v: number) => formatarMoedaCompacta(v)}
            />
            <YAxis
              type="category"
              dataKey="rotulo"
              width={128}
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grade)' }}
              tick={{ fill: 'var(--chart-texto)', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--chart-cursor)' }}
              content={(props) => {
                const ponto = props.active ? (props.payload?.[0]?.payload as (typeof pontos)[number] | undefined) : undefined
                if (!ponto) return null
                return (
                  <CaixaTooltip titulo={ponto.rotulo}>
                    <p className="font-medium tabular-nums">{formatarMoeda(ponto.valor)}</p>
                    <p className="text-premium-mudo">
                      {ponto.quantidade} {ponto.quantidade === 1 ? 'negociação' : 'negociações'}
                    </p>
                  </CaixaTooltip>
                )
              }}
            />
            <Bar
              dataKey="valor"
              fill="var(--chart-serie)"
              radius={[0, 4, 4, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <TabelaDados
        colunas={['Etapa', 'Valor', 'Negociações']}
        linhas={pontos.map((p) => [p.rotulo, formatarMoeda(p.valor), String(p.quantidade)])}
      />
    </div>
  )
}
