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

import type { VendaMensal } from '@/lib/dal/dashboard'
import { formatarMes, formatarMoeda, formatarMoedaCompacta } from '@/lib/utils/formatacao'

import { CaixaTooltip, TabelaDados } from './grafico-comum'

/**
 * Valor vendido por mês de fechamento. Uma série só, então sem legenda: o
 * título do card diz o que está plotado. O tooltip traz valor e quantidade.
 */
export function GraficoVendas({ dados }: { dados: VendaMensal[] }) {
  const pontos = dados.map((d) => ({ ...d, rotulo: formatarMes(d.mes) }))

  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
            <XAxis
              dataKey="rotulo"
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grade)' }}
              tick={{ fill: 'var(--chart-texto)', fontSize: 12 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: 'var(--chart-texto)', fontSize: 12 }}
              tickFormatter={(v: number) => formatarMoedaCompacta(v)}
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
                      {ponto.quantidade} {ponto.quantidade === 1 ? 'negócio' : 'negócios'}
                    </p>
                  </CaixaTooltip>
                )
              }}
            />
            <Bar
              dataKey="valor"
              fill="var(--chart-serie)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <TabelaDados
        colunas={['Mês', 'Valor vendido', 'Negócios']}
        linhas={pontos.map((p) => [p.rotulo, formatarMoeda(p.valor), String(p.quantidade)])}
      />
    </div>
  )
}
