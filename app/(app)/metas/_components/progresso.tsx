import { PremiumPanel, ProgressBarPremium, type CorProgresso } from '@/components/ui/premium'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

const CORES_BARRA: CorProgresso = { trilho: 'bg-premium-borda', fill: 'bg-premium-acento', texto: 'text-premium-acento' }
const CORES_BARRA_ATINGIDA: CorProgresso = { trilho: 'bg-premium-borda', fill: 'bg-emerald-400', texto: 'text-emerald-700 dark:text-emerald-400' }

/**
 * Barra de progresso da meta. Enche até 100%; acima disso o número mostra o
 * valor real (ex.: 132%) e a barra fica verde.
 */
export function BarraProgresso({ percentual, rotulo }: { percentual: number | null; rotulo: string }) {
  const atingida = percentual !== null && percentual >= 1
  return <ProgressBarPremium percentual={percentual} cor={atingida ? CORES_BARRA_ATINGIDA : CORES_BARRA} rotulo={rotulo} />
}

export function TextoPercentual({ percentual }: { percentual: number | null }) {
  if (percentual === null) return <span className="text-premium-mudo">—</span>
  return <span className={percentual >= 1 ? 'font-medium text-emerald-700 dark:text-emerald-400' : undefined}>{formatarPercentual(percentual)}</span>
}

type CardProps = {
  titulo: string
  valorMeta: number | null
  realizado: number
  percentual: number | null
  semMeta: string
  /** Ações do gerente (definir, editar, remover). */
  acoes?: React.ReactNode
  /** Metas financeiras em reais (padrão) ou contagem (reuniões). */
  formato?: 'moeda' | 'quantidade'
}

function formatarValor(valor: number, formato: 'moeda' | 'quantidade') {
  return formato === 'moeda' ? formatarMoeda(valor) : valor.toLocaleString('pt-BR')
}

/** Objetivo, realizado e percentual de uma meta, em destaque. */
export function CardMeta({ titulo, valorMeta, realizado, percentual, semMeta, acoes, formato = 'moeda' }: CardProps) {
  return (
    <PremiumPanel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-semibold text-premium-texto">{titulo}</h2>
        {acoes}
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-premium-mudo">Objetivo</dt>
          <dd className="mt-1 text-2xl font-semibold text-premium-texto">
            {valorMeta === null ? <span className="text-base font-normal text-premium-mudo">{semMeta}</span> : formatarValor(valorMeta, formato)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-premium-mudo">Realizado</dt>
          <dd className="mt-1 text-2xl font-semibold text-premium-texto">{formatarValor(realizado, formato)}</dd>
        </div>
        <div>
          <dt className="text-sm text-premium-mudo">Atingido</dt>
          <dd className="mt-1 text-2xl font-semibold text-premium-texto">
            <TextoPercentual percentual={percentual} />
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <BarraProgresso percentual={percentual} rotulo={`Progresso: ${titulo}`} />
      </div>
    </PremiumPanel>
  )
}
