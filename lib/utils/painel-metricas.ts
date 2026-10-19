/**
 * Matemática pura e pequena do NOVO dashboard de métricas (funil visual em
 * degraus, donut da meta mensal, barras de "Resultados do período") —
 * nenhuma delas recalcula nada que já vem pronto do banco (`alcancaram`,
 * `conversaoAcumulada`, `totalEntraram`, `ganhos`, `percentual` de meta);
 * só decidem LARGURA/ALTURA/FRAÇÃO visual a partir desses números. Extraídas
 * para serem testáveis sem montar nenhum componente.
 */

/** Largura mínima (%) de um degrau do funil — sempre legível, mesmo pra uma fração minúscula. */
export const LARGURA_MINIMA_FUNIL = 6

/**
 * Largura (%) de um degrau do funil visual, a partir de `conversaoAcumulada`
 * (já calculada por `processarMetricasFunil`, nunca recalculada aqui):
 * proporcional, nunca abaixo de {@link LARGURA_MINIMA_FUNIL} (uma fração de
 * 0,1% ainda precisa ser um bloco visível) nem acima de 100%. `null` (sem
 * nenhuma negociação na coorte) usa a largura mínima — nunca 0, nunca NaN.
 */
export function larguraDegrauFunil(conversaoAcumulada: number | null): number {
  if (conversaoAcumulada === null) return LARGURA_MINIMA_FUNIL
  return Math.round(Math.max(Math.min(conversaoAcumulada * 100, 100), LARGURA_MINIMA_FUNIL))
}

/**
 * Uma etapa "inclui entradas diretas" quando alcançou MAIS da coorte do que
 * a etapa anterior alcançou na PRÓPRIA sequência — nunca inferido por nome
 * ou posição, só pela comparação dos dois `conversaoAcumulada`/
 * `conversaoProxima` já calculados (mesmo contrato de `LinhaFunil`).
 */
export function temEntradaDireta(conversaoAcumulada: number | null, percentualAnterior: number | null): boolean {
  return percentualAnterior !== null && conversaoAcumulada !== null && conversaoAcumulada > percentualAnterior
}

/**
 * Altura (px) de uma barra do gráfico "Novos vs. Ganhos", proporcional ao
 * maior valor do conjunto — nunca abaixo de `alturaMinima` (uma barra de
 * valor 0 ainda precisa aparecer, legível, no eixo). `maior <= 0` (os dois
 * valores são zero) devolve `alturaMinima` para todas, sem divisão por zero.
 */
export function alturaBarraResultado(valor: number, maior: number, alturaMaxima: number, alturaMinima = 8): number {
  if (maior <= 0) return alturaMinima
  return Math.max(alturaMinima, Math.round((valor / maior) * alturaMaxima))
}

/**
 * Fração (0–1) do anel de progresso do donut — o PREENCHIMENTO visual nunca
 * passa de 100% (um anel não tem como desenhar 150%), mesmo quando a meta
 * foi superada; o texto no centro (fora desta função) mostra o percentual
 * real, sem limite. `null` (sem meta definida) é um anel vazio (0), nunca
 * cheio e nunca negativo.
 */
export function fracaoDonut(percentual: number | null): number {
  if (percentual === null) return 0
  return Math.min(Math.max(percentual, 0), 1)
}
