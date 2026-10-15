# Scorpion CRM — Regras de negócio de métricas e conversão

**ESPECIFICAÇÃO DEFINITIVA — implementada em
`supabase/migrations/20261015100000_funil_metricas_entidade_unica.sql`.**

Este documento registra a matemática definitiva de conversão do funil
(`public.funil_metricas`, consumida por `lib/dal/funil-metricas.ts` →
`lib/utils/funil-metricas.ts` → `/funil/metricas`). Decidida e revisada em
várias rodadas antes da implementação; qualquer mudança futura nesta regra
precisa passar pela mesma camada única (nunca duplicar o cálculo numa
tela nova).

## Regra definitiva — fonte de verdade

**Nunca calcular conversão simplesmente contando os cards atuais** (o
estado presente de `negociacoes`/`funil_cards`). A fonte de verdade é o
**histórico real de movimentação** (`historico_etapas`), nunca o estado
atual de uma negociação.

## Duas bases, nunca uma só

- **Histórico** (coorte, alcance por etapa, ganhos no período, perdidos no
  período, tempo por etapa): toda negociação do funil, **sem nenhuma
  exclusão** por arquivamento (`negociacoes.arquivada_em`/`excluida_em`)
  nem por cliente excluído (`clientes.deleted_at`). Nenhum soft delete
  apaga participação estatística passada — decisão definitiva
  (Alternativa B): `clientes.deleted_at` é estruturalmente o mesmo soft
  delete reversível que `negociacoes.arquivada_em`/`excluida_em` (nunca
  DELETE físico, a RLS não filtra, quem filtra é a DAL), então recebe o
  mesmo tratamento.
- **Atual** (quantidade/valor/parados de etapas abertas, "agora"): a
  ÚNICA parte que exclui cliente excluído e negociação
  arquivada/excluída — porque isso de fato não é mais uma oportunidade
  aberta.

## Coorte

`totalEntraram` = `COUNT(*)` de negociações do funil cujo `created_at`
cai no período selecionado — da base histórica completa, sem exclusões.
Fixa para sempre: uma negociação nunca é reclassificada para outro
período por ter avançado, sido arquivada ou excluída depois.

## Alcance por etapa — conversão da coorte, evolução até o momento

Uma negociação da coorte "alcançou" uma etapa se existe **pelo menos uma
entrada real** em `historico_etapas` para aquela etapa — `EXISTS`,
**nunca inferência por posição/ordem**. Pular uma etapa nunca credita a
etapa pulada (ex.: "Lead Novo → Proposta" direto conta Lead Novo e
Proposta, nunca as etapas do meio).

O join com `historico_etapas` **não tem filtro de data** — o período
define só quem entra na coorte; o avanço é sempre lido **até o momento da
consulta**, mesmo que tenha acontecido depois do fim do período de
entrada. Rótulo obrigatório em qualquer UI que mostre isso: **"Conversão
da coorte — evolução até o momento"**, nunca "conversão do período".

## Entidade única

Uma negociação que entra na mesma etapa múltiplas vezes conta **uma vez**
— nunca uma vez por entrada. Isso vale para alcance por etapa, para
"perdido no período" e para "ganho no período".

## Fórmulas de conversão

```
conversão acumulada(etapa)  = alcançaram(etapa) / totalEntraram
conversão incremental(etapa) = alcançaram(próxima etapa do pipeline normal) / alcançaram(etapa)
```

`null` sempre que o denominador for zero — nunca `0%` artificial. "Próxima
etapa do pipeline normal" é a sequência de etapas abertas com
`pos_fechamento = false`, pela ordem, seguida da etapa `ganha`. A etapa de
recuperação nunca é "próxima" de nenhuma etapa normal, e sua própria
"próxima" é sempre `null`.

## Ganho e perdido

- **Ganho**: identificado por `etapas_funil.tipo = 'ganha'`. Alcance via
  `historico_etapas` (evolução até o momento, ver acima). "Ganhos no
  período" e `fechadoValor` (TCV/MRR) usam **venda histórica real**
  (`fechamentos.data_fechamento`), sobre a base histórica completa —
  arquivar/excluir a negociação **depois** de vendida nunca apaga a venda
  do histórico financeiro.
- **Perdido**: identificado por `etapas_funil.tipo = 'perdida'`. "Perdidos
  no período" conta pela **entrada real** na etapa perdida
  (`historico_etapas.created_at` no período) — nunca pela etapa atual
  (sobrevive a Perdido → Recuperação). **Deduplicado por negociação antes
  de agregar valor**: se a mesma negociação entra em perdida mais de uma
  vez no período, conta 1, nunca 2, e o valor não dobra. O valor somado é
  `negociacoes.valor_estimado` — campo **atual**, sem histórico de
  alterações: é uma aproximação, nunca o valor real no momento da perda,
  e a UI nunca deve apresentá-lo como indicador financeiro confiável sem
  rotulá-lo como estimado.

## Recuperação

Zona separada (`etapas_funil.pos_fechamento = true`) — nunca é "próxima
etapa" de nenhuma etapa normal do pipeline, nunca soma em
`oportunidades`/`pipelineValor` do resumo. Tem sua própria contagem de
alcance, pelo mesmo mecanismo `EXISTS` de qualquer outra etapa.

## TCV/MRR × funil de conversão — unidades nunca misturadas

Conversão é **contagem** de negociações/leads (`quantidade`,
`alcancaram`, `totalEntraram`, `conversao*`). TCV/MRR é **valor
financeiro** (`fechamentos.valor_vendido`/`tipo_venda`, meta em
`metas`/`metas_progresso`). As duas nunca se misturam na mesma fórmula:
`resumo.conversao` depende só de contagens de ganhos/perdidos, nunca do
valor vendido; `resumo.fechadoValor` é um campo separado. Meta geral da
empresa continua geral (sem filtro por funil) até que exista meta
específica por funil — decisão fora do escopo desta implementação.

## Fonte única de cálculo

`public.funil_metricas` (RPC, agregação em SQL) → `lib/dal/funil-metricas.ts`
(só chama a RPC) → `lib/utils/funil-metricas.ts` (`processarMetricasFunil`,
lógica pura) → UI (`/funil/metricas`). Nenhuma tela recalcula nada — boxes,
tabela e qualquer gráfico futuro consomem exatamente o mesmo resultado.
Não existe mais uma segunda implementação paralela (`lib/dal/funil-conversao.ts`
e o componente `BoxConversao` da tela `/funil` foram removidos — calculavam
conversão sem filtro de período, com números que podiam divergir dos de
`/funil/metricas` para o "mesmo" funil).
