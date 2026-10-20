import { IconeFunil } from '@/app/(app)/funil/_components/icones-metricas'
import { TextoPercentual } from '@/app/(app)/metas/_components/progresso'
import { CORES_PROGRESSO, IconBadge, PremiumCard, ProgressBarPremium, type CorProgresso } from '@/components/ui/premium'
import type { ProgressoFunilMeta } from '@/lib/dal/metas'
import { formatarMoeda } from '@/lib/utils/formatacao'

/**
 * Paleta por POSIÇÃO (ciclo), nunca pelo nome do funil — "o segundo card é
 * laranja" é consequência do índice, não uma regra amarrada a "Funil
 * Inbound". Um funil novo (sexto, sétimo…) recicla a paleta a partir do
 * início; nunca hardcoded para 2 funis. Mesma paleta (`CORES_PROGRESSO`) de
 * `/funil/metricas` (`MetaMensal`) — os dois lugares nunca divergem na cor
 * por posição, mesmo sendo componentes diferentes.
 */
const PALETA_FUNIL: CorProgresso[] = [
  CORES_PROGRESSO.roxo,
  CORES_PROGRESSO.rosa,
  CORES_PROGRESSO.ambar,
  CORES_PROGRESSO.teal,
  CORES_PROGRESSO.laranja,
  CORES_PROGRESSO.azul,
]

/**
 * Um card por funil ATIVO — a lista vem de `obterProgressoMetasFunis`
 * (RPC `metas_funis_progresso`), que já devolve todo funil ativo
 * automaticamente; um funil novo aparece aqui sem nenhuma mudança de
 * código. Dentro de cada card, TCV e MRR são dois objetivos independentes
 * do mesmo funil — nunca somados numa barra só (mesma regra de `/metas`:
 * TCV e MRR nunca se misturam). Usado só em `/metas` (cards de leitura,
 * abaixo do formulário de cadastro do gerente) — `/funil/metricas` tem seu
 * próprio card (`CardMetaFunilPremium`, em `meta-mensal.tsx`), porque lá os
 * cards de funil entram no MESMO grid dos cards gerais (TCV/MRR), aqui têm
 * uma grade própria.
 */
export function CardsMetaFunil({ progresso }: { progresso: ProgressoFunilMeta[] }) {
  if (progresso.length === 0) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {progresso.map((p, i) => (
        <CardMetaFunil key={p.funilId} progresso={p} cor={PALETA_FUNIL[i % PALETA_FUNIL.length]} />
      ))}
    </div>
  )
}

function CardMetaFunil({ progresso, cor }: { progresso: ProgressoFunilMeta; cor: CorProgresso }) {
  return (
    <PremiumCard className="space-y-3 p-4">
      <p className="flex items-center gap-2 font-semibold text-premium-texto">
        <IconBadge icone={IconeFunil} cor={cor.texto} fundo={cor.trilho} />
        {progresso.funilNome}
      </p>
      <LinhaMetaFunil titulo="TCV" dados={progresso.tcv} cor={cor} />
      <LinhaMetaFunil titulo="MRR" dados={progresso.mrr} cor={cor} />
    </PremiumCard>
  )
}

function LinhaMetaFunil({ titulo, dados, cor }: { titulo: string; dados: ProgressoFunilMeta['tcv']; cor: CorProgresso }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-premium-secundario">{titulo}</span>
        <TextoPercentual percentual={dados.percentual} />
      </div>
      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span className="font-medium text-premium-texto">{formatarMoeda(dados.realizado)}</span>
        <span className="text-xs text-premium-mudo">
          {dados.valorMeta === null ? 'Meta não definida' : `de ${formatarMoeda(dados.valorMeta)}`}
        </span>
      </div>
      <ProgressBarPremium
        percentual={dados.percentual}
        cor={cor}
        rotulo={`${titulo} de ${formatarMoeda(dados.realizado)}${
          dados.valorMeta === null ? ', meta não definida' : ` de ${formatarMoeda(dados.valorMeta)}`
        }`}
      />
    </div>
  )
}
