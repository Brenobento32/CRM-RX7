/**
 * Matemática pura e pequena do dashboard de métricas (funil visual em
 * degraus, donut da meta mensal) — nenhuma delas recalcula nada que já vem
 * pronto do banco (`alcancaram`, `conversaoAcumulada`, `totalEntraram`,
 * `percentual` de meta); só decidem LARGURA/FRAÇÃO visual a partir desses
 * números. Extraídas para serem testáveis sem montar nenhum componente.
 */

/** Extremos (%) da largura de um degrau do funil visual — o primeiro (a entrada) e o último, sempre os mesmos, pra qualquer funil. */
export const LARGURA_MAX_FUNIL = 100
export const LARGURA_MIN_FUNIL = 40

/**
 * Largura (%) de um degrau do funil visual, só pela POSIÇÃO — nunca pelo
 * valor da conversão. O funil é um template visual fixo (mesma forma pra
 * qualquer funil ou período; só nome/quantidade/cor internos mudam): o
 * primeiro degrau (`indice` 0, a própria entrada) sempre começa em
 * {@link LARGURA_MAX_FUNIL}, o último (`indice === totalDegraus - 1`)
 * sempre termina em {@link LARGURA_MIN_FUNIL}, com os do meio interpolados
 * linearmente pela posição entre os dois. `totalDegraus` inclui a
 * linha-base ("Leads entram"), que é sempre o índice 0 — ver `FunilVisual`.
 * `totalDegraus <= 1` (funil sem nenhuma etapa configurada além da entrada)
 * devolve a largura máxima, sem dividir por zero.
 */
export function larguraDegrauPorIndice(indice: number, totalDegraus: number): number {
  if (totalDegraus <= 1) return LARGURA_MAX_FUNIL
  const passo = (LARGURA_MAX_FUNIL - LARGURA_MIN_FUNIL) / (totalDegraus - 1)
  return Math.round(LARGURA_MAX_FUNIL - indice * passo)
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
