# Scorpion CRM — Regras de negócio de métricas e conversão

**ESPECIFICAÇÃO PENDENTE DE IMPLEMENTAÇÃO.**

Este documento registra regras já decididas para o cálculo de métricas
(metas, funil de conversão, qualquer box/gráfico que meça conversão ou
avanço de leads) — **sem que a matemática exata tenha sido definida ou
implementada ainda**. Nenhum código deve ser escrito a partir daqui sem
antes definir e testar rigorosamente a regra matemática exata (ver "O que
falta decidir", abaixo). Prioridade no roadmap:
[`SCORPION-ROADMAP.md`](SCORPION-ROADMAP.md), itens 1 e 2 ("Alta").

## Regra definitiva — fonte de verdade

**Nunca calcular conversão simplesmente contando os cards atuais** (o
estado presente de `negociacoes`/`funil_cards`). Isso mede "onde os leads
estão agora", não "quantos leads passaram por cada etapa" — um lead que já
avançou ou já fechou não aparece mais contado na etapa por onde passou.

A fonte de verdade para qualquer métrica de conversão/funil é o
**histórico real de movimentação** (`historico_etapas`), nunca o estado
atual de uma negociação.

## Conceitos que a métrica precisa distinguir

Para qualquer etapa, e para qualquer negociação que passou por ela, a
regra precisa diferenciar explicitamente:

- **entrada na etapa** — o momento em que a negociação passou a estar
  naquela etapa;
- **permanência** — quanto tempo ficou lá;
- **saída** — o momento em que deixou de estar naquela etapa (avançou,
  retrocedeu, foi perdida ou fechada);
- **retorno à etapa** — entrar de novo numa etapa por onde já tinha
  passado antes (ex.: closer devolve o lead de "Proposta enviada" para
  "Reunião realizada");
- **fechamento** — chegada a uma etapa do tipo `ganha`, com o registro
  correspondente em `fechamentos`.

## Entidades únicas, não eventos

Uma negociação que entra duas vezes na mesma etapa **não representa dois
leads**, nem duas entradas para efeito de taxa de conversão. A métrica deve
contar **entidades únicas** (a negociação, ou o lead) passando por cada
etapa — se precisar contar o histórico de passagens/retornos para outro
fim (ex.: um relatório de "quantas vezes o funil foi reaberto"), isso é uma
métrica **diferente**, com nome diferente, nunca a mesma métrica de
conversão.

## Fonte única de cálculo

Boxes e gráficos que exibem a mesma métrica (ou métricas derivadas uma da
outra) precisam usar a **mesma camada/função de cálculo** — nunca duas
implementações separadas que deveriam concordar mas foram escritas em
momentos diferentes. Isso vale tanto dentro de uma tela (o número do box
tem que bater com o gráfico ao lado) quanto entre telas (dashboard, metas,
funil de conversão, relatórios).

## O que falta decidir (não inventar na implementação)

Antes de implementar qualquer parte disto, ainda é preciso definir e
testar:

- a regra matemática exata de conversão por etapa (numerador/denominador:
  conversão em relação a quem entrou na etapa? em relação ao total do
  funil? em relação ao período?);
- como lidar com cohort (uma negociação que entrou num funil em um mês e
  fechou no mês seguinte conta em qual período, para qual métrica?);
- como a regra de "entidade única" interage com filtro por funil/período
  (ver `SCORPION-MASTER.md`, seção "Metas (TCV/MRR)" e "Funil de
  conversão") quando a mesma negociação passa por mais de um período
  filtrado.

Essas decisões **não foram tomadas ainda** — ficam para quando a
implementação dos itens 1 e 2 do roadmap for de fato iniciada, com teste
rigoroso antes de qualquer tela depender do resultado.
