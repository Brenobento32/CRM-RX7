import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { PremiumCard } from '@/components/ui/premium'
import type { Funil } from '@/lib/dal/funis'
import { classeTextoAgenda, corDeFundoAgenda } from '@/lib/utils/etapas'
import { filtrarPipelinePrincipal, type MetricaEtapa, type MetricasFunil } from '@/lib/utils/funil-metricas'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'
import { larguraDegrauPorIndice, temEntradaDireta } from '@/lib/utils/painel-metricas'

import { IconeTrofeu } from './icones-metricas'
import { SeletorFunil } from './seletor-funil'

/**
 * Funil visual — números absolutos e percentuais, lado a lado com a tabela
 * detalhada (que continua existindo para leitura precisa). REGRA CRÍTICA:
 * nenhum número aqui é recalculado — tudo vem pronto de `MetricasFunil`
 * (RPC `funil_metricas` → `lib/dal/funil-metricas.ts` →
 * `lib/utils/funil-metricas.ts`). Este componente só decide COMO exibir,
 * nunca O QUE calcular: `filtrarPipelinePrincipal` é a mesma função que já
 * decide a sequência usada para `conversaoProxima`/`conversaoAcumulada` —
 * se a tabela diz "MQL = 70", o gráfico usa exatamente o mesmo `70`. Essa
 * mesma função já exclui os estados laterais abertos (ex.: "No Show",
 * `participaConversao=false`) da sequência — este componente nunca filtra
 * nenhum deles sozinho, só decide ONDE mostrá-los (fora do cone, na linha
 * "Perdido · Desqualificado · etapas laterais abertas · Recuperação").
 *
 * Números são sempre `alcancaram` (coorte, evolução até o momento) — nunca
 * `quantidade` (estado presente) — porque um funil visual de conversão
 * responde "de quem entrou, quantos chegaram aqui", não "quantos estão
 * aqui agora". Ver "Conversão da coorte — evolução até o momento" na tabela.
 */
export function FunilVisual({
  metricas,
  funis,
  funilId,
}: {
  metricas: MetricasFunil
  /** Pro seletor de funil, que agora mora no cabeçalho deste painel (item 9 da rodada), não mais na barra de filtros da página. */
  funis: Pick<Funil, 'id' | 'nome' | 'ativo'>[]
  funilId: string
}) {
  const { resumo, etapas } = metricas
  const pipeline = filtrarPipelinePrincipal(etapas)
  // Fora do cone, nesta ordem fixa: Perdido, Desqualificado, etapas abertas
  // laterais (por ordem), Recuperação (por ordem). Cada grupo só aparece se
  // existir neste funil — nunca inventado. "Lateral aberta" é estrutural
  // (`participaConversao=false` numa etapa aberta não pós-fechamento —
  // cálculo definitivo, nunca o nome) — pode haver mais de uma (No Show é só
  // a mais comum), todas aparecem, cada uma com o nome real dela.
  const perdido = etapas.find((e) => e.tipo === 'perdida')
  const lateraisAbertas = etapas
    .filter((e) => e.tipo === 'aberta' && !e.posFechamento && !e.participaConversao)
    .sort((a, b) => a.ordem - b.ordem)
  const recuperacao = etapas.filter((e) => e.posFechamento).sort((a, b) => a.ordem - b.ordem)

  const cabecalho = (
    <div className="flex flex-col gap-1 border-b border-premium-borda pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-premium-texto">
          <IconeTrofeu className="size-4 shrink-0 text-amber-400" />
          Funil de vendas
        </h2>
        <SeletorFunil funis={funis} funilId={funilId} variant="premium" comRotulo={false} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-premium-secundario">Conversão da coorte</p>
        <span
          className="shrink-0 rounded-full border border-premium-borda bg-premium-bg/60 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-premium-secundario"
          title="Leads de origens diferentes podem entrar direto numa etapa mais avançada — por isso os números nem sempre diminuem etapa a etapa."
        >
          Leads entram <span className="tabular-nums text-premium-texto">{resumo.totalEntraram}</span>
        </span>
      </div>
    </div>
  )

  if (pipeline.length === 0) {
    return (
      <section className="@container flex h-full flex-col gap-4">
        {cabecalho}
        <p className="rounded-lg border border-dashed border-premium-borda p-6 text-center text-sm text-premium-mudo">
          Este funil ainda não tem etapas configuradas.
        </p>
      </section>
    )
  }

  // Largura de cada degrau, fixa por POSIÇÃO (`larguraDegrauPorIndice`) —
  // nunca pelo valor de conversão: o funil é um template visual estável,
  // só o texto/cor internos mudam com o dado. `totalDegraus` inclui a
  // linha-base ("Leads entram"), que é sempre o índice 0 — o topo de cada
  // trapezoide é a largura do degrau ANTERIOR (índice `i`), a base é a
  // largura PRÓPRIA (índice `i + 1`).
  const totalDegraus = pipeline.length + 1
  const larguras = Array.from({ length: totalDegraus }, (_, indice) => larguraDegrauPorIndice(indice, totalDegraus))
  // Altura total do bloco (todas as linhas + os espaços entre elas, sem o
  // espaço depois da última) — calculada uma vez aqui pra centralizar
  // verticalmente o bloco INTEIRO (trapézios + selos) como uma unidade só.
  // Ver `topoSelo` pro porquê de precisar de um número exato em vez de só
  // `justify-center` no `<ol>` (que descentralizaria os selos da coluna
  // lateral, calculados a partir do topo).
  const alturaTotal = totalDegraus * PASSO_DEGRAU - GAP_DEGRAU

  return (
    <section aria-label="Funil de conversão visual" className="@container flex h-full flex-col gap-4">
      {cabecalho}

      <div className="flex flex-1 flex-col justify-center">
        <div className="relative" style={{ height: alturaTotal }}>
          {/* O "trilho" dos trapézios (`<ol>`) e a camada de selos logo
              abaixo usam a MESMA geometria (`inset-y-0 left-0 right-36`,
              nunca `pr-36`/padding num e `inset-0` no outro) de propósito:
              os dois precisam enxergar a mesma largura de container pra
              `largura%` (a mesma do clip-path) e `left: calc(largura%+...)`
              apontarem pro MESMO ponto físico na tela — com bases
              diferentes (um com padding, outro sem), a borda "direita do
              trapézio" calculada pelo selo ficaria sistematicamente errada.
              `right-36` (144px, não mais 96px): folga calculada pro pior
              caso de texto ("233,3%", o mais largo que `formatarPercentual`
              produz com entrada direta) + gap + ícone nunca estourarem essa
              margem reservada — ver `ESPACO_SELO`. */}
          <ol className="absolute inset-y-0 left-0 right-36 flex flex-col gap-1">
            <LinhaFunilBase quantidade={resumo.totalEntraram} />
            {pipeline.map((etapa, i) => (
              <LinhaFunil
                key={etapa.etapaId}
                etapa={etapa}
                larguraAnterior={larguras[i]}
                largura={larguras[i + 1]}
              />
            ))}
          </ol>

          {/* Taxas — SEPARADAS da lista de trapézios de propósito (nunca
              dentro do mesmo `<li>`): cada selo é posicionado pelo MEIO do
              PRÓPRIO degrau correspondente (`topoSelo` — nunca mais a
              transição entre dois degraus) e pela BORDA DIREITA do próprio
              trapézio daquela linha (`largura`,
              a mesma % usada no `clip-path` — nunca uma coluna fixa
              distante do cone, nunca um `right: 0`). `left: calc(50% +
              largura/2% + ESPACO_SELO px)`: 50% é o centro (trapézio
              sempre centralizado), +largura/2% chega na borda direita
              dele, +ESPACO_SELO é o espaço FIXO e uniforme em px — sempre
              a MESMA distância da borda, em qualquer largura, acompanhando
              a lateral do funil (preserva o efeito cascata) sem nunca
              "empurrar" ou desalinhar nada, porque não depende da largura
              do próprio texto do percentual (só da posição de partida). */}
          <div className="pointer-events-none absolute inset-y-0 left-0 right-36">
            <SeloLateral topo={topoSelo(0)} largura={100} percentual={1} cor="var(--premium-texto)" entradaDireta={false} primeira />
            {pipeline.map((etapa, i) => {
              const percentualAnterior = i === 0 ? etapa.conversaoAcumulada : pipeline[i - 1].conversaoProxima
              return (
                <SeloLateral
                  key={etapa.etapaId}
                  topo={topoSelo(i + 1)}
                  largura={larguras[i + 1]}
                  percentual={percentualAnterior}
                  cor={corDeFundoAgenda(etapa.cor)}
                  entradaDireta={temEntradaDireta(etapa.conversaoAcumulada, percentualAnterior)}
                />
              )
            })}
          </div>
        </div>
      </div>

      {(perdido || resumo.desqualificados > 0 || lateraisAbertas.length > 0 || recuperacao.length > 0) && (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-premium-borda pt-3">
          <p className="w-full text-xs text-premium-mudo">Fora da sequência principal — não são &ldquo;próxima etapa&rdquo;:</p>
          {/* Ordem fixa: Perdido, Desqualificado, etapas abertas laterais
              (por ordem, rótulo = nome real da etapa), Recuperação (por
              ordem) — só os que existirem, preservando a ordem relativa.
              Perdido/laterais/recuperação: `quantidade`/`alcancaram` já são
              da COORTE (migration
              20261020140000_funil_metricas_alcance_cumulativo.sql) — sem
              override de quantidade aqui, o valor padrão (`etapa.quantidade`)
              já é o certo. Nenhum grupo mostra valor financeiro, exceto
              Perdido (já vem de fonte real — mantido). */}
          {perdido && <BadgeLateral etapa={perdido} detalhe="Perdas da coorte (evolução até agora)" />}
          {resumo.desqualificados > 0 && (
            <BadgeDesqualificado
              quantidade={resumo.desqualificados}
              detalhe="Leads da coorte desqualificados (arquivada_em) — continuam contando nas etapas principais que alcançaram antes"
            />
          )}
          {lateraisAbertas.map((e) => (
            <BadgeLateral key={e.etapaId} etapa={e} detalhe="Da coorte, quantos chegaram a este estado (evolução até agora)" />
          ))}
          {recuperacao.map((r) => (
            <BadgeLateral key={r.etapaId} etapa={r} detalhe="Da coorte, em recuperação" />
          ))}
        </div>
      )}
    </section>
  )
}

/** Altura (px) de cada degrau/trapezoide do funil — mesma para todos, só a largura varia. */
const ALTURA_DEGRAU = 50
/** Espaço (px) entre um degrau e o próximo — precisa bater com o `gap-1` do `<ol>` logo abaixo (0.25rem = 4px); um só lugar define os dois. */
const GAP_DEGRAU = 4
/** Altura "ocupada" por um degrau + o espaço depois dele — a unidade de repetição vertical do funil inteiro. */
const PASSO_DEGRAU = ALTURA_DEGRAU + GAP_DEGRAU

/**
 * Topo (px, relativo ao bloco inteiro) de cada selo lateral — SEMPRE o meio
 * do PRÓPRIO degrau `indice` (nunca mais a transição/espaço entre dois
 * degraus, pedido explícito desta rodada): a taxa daquela etapa fica
 * alinhada verticalmente ao centro do trapézio dela mesma, a mesma altura
 * em que o nome/quantidade da etapa aparecem dentro do trapézio.
 */
function topoSelo(indice: number): number {
  return indice * PASSO_DEGRAU + ALTURA_DEGRAU / 2
}

/** `clip-path: polygon(...)` de um trapezoide CENTRALIZADO: `topo`/`base` em % (0–100) da largura total do container. */
function trapezoide(topo: number, base: number): string {
  const inset = (pct: number) => (100 - pct) / 2
  return `polygon(${inset(topo)}% 0, ${100 - inset(topo)}% 0, ${100 - inset(base)}% 100%, ${inset(base)}% 100%)`
}

function LinhaFunilBase({ quantidade }: { quantidade: number }) {
  return (
    <li
      className="rounded-t-lg bg-premium-borda leading-tight text-premium-texto"
      style={{ height: ALTURA_DEGRAU }}
    >
      <div className="flex h-full flex-col items-center justify-center">
        <span className="text-xs font-semibold">Leads entram</span>
        <span className="text-lg font-bold tabular-nums">{quantidade}</span>
      </div>
    </li>
  )
}

/**
 * Um degrau do funil — trapezoide CENTRALIZADO (nunca um retângulo
 * alinhado à esquerda): o topo tem a largura do degrau ANTERIOR, a base tem
 * a largura PRÓPRIA — ambas fixas por POSIÇÃO (`larguraDegrauPorIndice`,
 * calculada em `FunilVisual`, nunca aqui) — a transição entre os dois é o
 * que dá a aparência real de funil, em vez de barras horizontais
 * empilhadas. O template visual (a forma) nunca muda com o dado: só o
 * nome/quantidade/cor dentro do trapezoide refletem a etapa de verdade.
 * Entradas diretas (origens diferentes entram em pontos diferentes do
 * funil — auditado: `empresa`/`etapa_inicial` configurável por nicho) nunca
 * alteram a largura (que é só posição) — continuam marcadas pelo `title`
 * do `SeloLateral` ao lado, que é sobre o NÚMERO, nunca sobre a forma.
 */
function LinhaFunil({
  etapa,
  larguraAnterior,
  largura,
}: {
  etapa: MetricaEtapa
  larguraAnterior: number
  largura: number
}) {
  const corTexto = classeTextoAgenda(etapa.cor)

  return (
    <li
      className="relative flex items-center justify-center transition-[clip-path]"
      style={{
        height: ALTURA_DEGRAU,
        clipPath: trapezoide(larguraAnterior, largura),
        backgroundColor: corDeFundoAgenda(etapa.cor),
      }}
    >
      <div className={`flex min-w-0 flex-col items-center justify-center leading-tight ${corTexto}`}>
        <span className="max-w-full truncate px-2 text-xs font-semibold">{etapa.nome}</span>
        <span className="text-lg font-bold tabular-nums">{etapa.alcancaram}</span>
      </div>
    </li>
  )
}

/**
 * Espaço (px) uniforme entre a borda direita do trapézio e a taxa — sempre
 * o mesmo, qualquer que seja a largura da linha. Aumentado de novo nesta
 * rodada (18 → 28): pedido explícito pra mover a taxa mais para a direita,
 * mantendo o mesmo gap fixo e uniforme em todas as alturas.
 */
const ESPACO_SELO = 28

/**
 * Taxa de conversão — percentual + seta curva (ponta apontando de volta pro
 * funil), SEM caixa/pílula/borda nem legenda visível (pedido explícito): o
 * rótulo ("da etapa anterior") existe só para leitor de tela (`sr-only`).
 *
 * Posição HORIZONTAL acompanha a borda direita do PRÓPRIO trapézio desta
 * linha, nunca uma coluna fixa distante do cone: `largura` é a mesma %
 * usada no `clip-path` da base do degrau (0–100, centralizada) — a borda
 * direita dele fica em `50% + largura/2%` do container; somando
 * {@link ESPACO_SELO} em px (fixo, uniforme) chega exatamente onde a taxa
 * deve começar, em qualquer largura. Posição VERTICAL pelo MEIO do próprio
 * degrau (`topo`, de `topoSelo`) — a mesma altura do nome/quantidade dentro
 * do trapézio correspondente, nunca a transição/espaço entre dois degraus.
 *
 * Cor da seta/número é a da etapa de DESTINO (pra onde a conversão está
 * indo) — a mesma cor do trapezoide logo depois dela. Taxa acima de 100%
 * (entrada direta) aparece por inteiro, nunca limitada — só ganha um
 * `title` explicando o motivo, nunca um texto permanente embaixo.
 */
function SeloLateral({
  topo,
  largura,
  percentual,
  cor,
  entradaDireta,
  primeira = false,
}: {
  topo: number
  /** Largura (%) da base do trapézio desta linha — mesma usada no clip-path. */
  largura: number
  percentual: number | null
  cor: string
  entradaDireta: boolean
  primeira?: boolean
}) {
  return (
    <div
      className="pointer-events-auto absolute flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap"
      style={{ top: topo, left: `calc(${50 + largura / 2}% + ${ESPACO_SELO}px)` }}
      title={
        entradaDireta
          ? 'Esta etapa alcançou mais negociações que a etapa anterior — algumas entraram direto aqui, sem passar pela anterior'
          : undefined
      }
    >
      <span className="text-lg font-bold tabular-nums" style={{ color: cor }}>
        {percentual === null ? '—' : formatarPercentual(percentual)}
      </span>
      {!primeira && (
        <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" aria-hidden>
          <path d="M18 3 V8 Q18 14 12 14 H7" stroke={cor} strokeWidth={2} strokeLinecap="round" />
          <path d="M10 10 L6 14 L10 18" stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span className="sr-only">{primeira ? 'desde a entrada' : 'da etapa anterior'}</span>
    </div>
  )
}

/**
 * Resumo "Entrada → Ganho" de cada funil disponível, no mesmo período de
 * análise — mesma definição de coorte do funil visual (nunca estado atual):
 * é a `conversaoAcumulada` da própria etapa "ganha" de cada funil
 * (`alcancaram(ganha) ÷ totalEntraram`), já calculada por
 * `processarMetricasFunil`; nada recalculado aqui, só uma lista compacta
 * pra comparar funis sem abrir um de cada vez.
 */
export function TaxaPorFunil({ resumos }: { resumos: { funilId: string; nome: string; metricas: MetricasFunil }[] }) {
  if (resumos.length < 2) return null

  return (
    <section aria-label="Taxa de conversão por funil" className="space-y-2">
      <h3 className="text-xs font-medium text-premium-secundario">Entrada → Ganho, por funil</h3>
      <div className="flex flex-wrap gap-3">
        {resumos.map(({ funilId, nome, metricas }) => {
          const ganha = metricas.etapas.find((e) => e.tipo === 'ganha')
          const taxa = ganha?.conversaoAcumulada ?? null
          return (
            <PremiumCard key={funilId} className="px-3 py-2 text-sm text-premium-texto">
              <p className="font-medium">{nome}</p>
              <dl className="mt-1 grid grid-cols-3 gap-x-3 text-xs">
                <div>
                  <dt className="text-premium-mudo">Entraram</dt>
                  <dd className="font-semibold tabular-nums">{metricas.resumo.totalEntraram}</dd>
                </div>
                <div>
                  <dt className="text-premium-mudo">Ganhos</dt>
                  <dd className="font-semibold tabular-nums">{ganha?.alcancaram ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-premium-mudo">Conversão</dt>
                  <dd className="font-semibold tabular-nums text-premium-secundario">{taxa === null ? '—' : formatarPercentual(taxa)}</dd>
                </div>
              </dl>
            </PremiumCard>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Perdido/No Show/Recuperação: quantidade real da COORTE (migration
 * 20261020140000_funil_metricas_alcance_cumulativo.sql já devolve
 * `quantidade`/`alcancaram` corretos pros três — nenhum override precisa
 * ser feito aqui), nunca como etapa de avanço do funil principal. Nenhum
 * dos três mostra valor financeiro, exceto Perdido (já vem de fonte real).
 */
function BadgeLateral({ etapa, detalhe }: { etapa: MetricaEtapa; detalhe?: string }) {
  return (
    <PremiumCard className="flex items-center gap-2 px-3 py-2 text-sm text-premium-texto" title={detalhe}>
      <PontoEtapa cor={etapa.cor} />
      <span>{etapa.nome}</span>
      <span className="font-semibold tabular-nums">{etapa.quantidade}</span>
      {etapa.tipo === 'perdida' && (
        <span className="text-xs text-premium-mudo" title="Valor estimado atual, aproximado — sem histórico de valor na época da perda">
          ≈ {formatarMoeda(etapa.valor)}
        </span>
      )}
    </PremiumCard>
  )
}

/**
 * Desqualificado — total único da COORTE (`resumo.desqualificados`, nunca
 * por etapa: desqualificar não move a negociação, pode estar em qualquer
 * uma quando acontece). Por isso não usa `MetricaEtapa` como `BadgeLateral`
 * (não existe uma etapa "Desqualificado" nenhuma — nunca criar uma
 * artificial, pedido explícito). Sem cor de etapa própria: ponto neutro.
 * Nunca mostra valor financeiro (pedido explícito).
 */
function BadgeDesqualificado({ quantidade, detalhe }: { quantidade: number; detalhe?: string }) {
  return (
    <PremiumCard className="flex items-center gap-2 px-3 py-2 text-sm text-premium-texto" title={detalhe}>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-premium-mudo" />
      <span>Desqualificado</span>
      <span className="font-semibold tabular-nums">{quantidade}</span>
    </PremiumCard>
  )
}
