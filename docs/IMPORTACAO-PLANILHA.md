# Importação da planilha "Atendimento Clientes - Scorpion"

Migração **única** da planilha de controle de clientes usada antes do CRM.

- Script: `scripts/importar-planilha.mts`
- Origem: `Atendimento Clientes - Scorpion.xlsx`, aba **Controle Clientes**
- Destino: `clientes`, `negociacoes`, `eventos`, `atividades`, `proximas_acoes`

## Como funciona

O script **nunca grava no banco**. São três passos separados:

```bash
# 1. Análise: quantas linhas, como cada uma será mapeada e os problemas encontrados.
npm run importar:planilha -- "<caminho>/Atendimento Clientes - Scorpion.xlsx"

# 2. (Opcional) Simulação: gera um SQL que roda tudo no banco e DESFAZ no final.
#    Prova que nenhuma constraint, trigger ou RLS vai recusar os dados.
npm run importar:planilha -- "<planilha>.xlsx" --dono closer@empresa.com \
  --sql scripts/.saida/simulacao.sql --simular
npx supabase db query --linked -f scripts/.saida/simulacao.sql
#    Resultado esperado: erro "SIMULAÇÃO OK: 18 clientes seriam importados".

# 3. Importação: gera o SQL definitivo, revise o arquivo e execute.
npm run importar:planilha -- "<planilha>.xlsx" --dono closer@empresa.com \
  --sql scripts/.saida/importacao.sql
npx supabase db query --linked -f scripts/.saida/importacao.sql
```

Garantias do SQL gerado:

- **Tudo ou nada.** Um único bloco `DO`: se qualquer linha falhar, nada é gravado.
- **Não duplica.** Se algum cliente com o mesmo nome já existir, a importação
  inteira é abortada antes de gravar.
- **Dono validado.** O e-mail de `--dono` precisa existir em `profiles` e estar ativo.
- Os SQLs gerados ficam em `scripts/.saida/`, que está no `.gitignore`: eles
  contêm dados de clientes.

O SQL roda como `postgres` (via `supabase db query`), então a RLS não se aplica;
por isso o dono e o autor de cada registro são informados explicitamente.

## Dono da carteira

A planilha **não tem coluna de closer**. A coluna "Responsavel" é o contato do
lado do cliente (ex.: "Ronaldo", "Marla e Dr. Thales"), não o vendedor.

Todos os clientes entram na carteira do usuário informado em `--dono`, que
também fica como autor das atividades e dono dos eventos. Depois da importação
o gerente pode transferir clientes pela edição do cliente (a negociação vai junto).

## Mapeamento

### Cliente (`clientes`)

| Planilha | CRM | Observação |
|---|---|---|
| Nome do Cliente | `nome` e `empresa` | Todos entram como `tipo_cliente = empresa` |
| Responsavel | `responsavel` | Contato no cliente |
| — | `observacoes` | "Importado da planilha …, linha N." |
| 1° reunião | `created_at` | Data de cadastro aproximada |

A planilha não tem telefone, WhatsApp nem e-mail. Os clientes entram sem
contato; o formulário do CRM exige um ao editar.

### Negociação (`negociacoes`) — uma por cliente

| Planilha | CRM | Regra |
|---|---|---|
| Status 1 + Status da Proposta | `etapa` | Ver tabela abaixo |
| Termometro | `temperatura` | Quente → `quente`, Morno → `morno`, Frio → `frio` |
| Valor da Proposta | `valor_estimado` | Vazio fica vazio |
| Objeção | `objecao_principal` | Texto como está |
| 1° reunião | `data_primeira_reuniao` | |
| Reunião de Proposta | `data_proposta` | Só quando o Status da Proposta é "Feita" |
| Tempo da Proposta | `titulo` | "Proposta · 3 Meses". Não estava no mapeamento pedido; guardado aqui para não perder |

**Etapa:**

| Status 1 | Status da Proposta | Etapa no CRM |
|---|---|---|
| Feita | Feita | `proposta_enviada` |
| Feita | Agendada | `reuniao_realizada` |
| Feita | Aguardando | `reuniao_realizada` |
| Feita | (vazio) | `reuniao_realizada` |
| outro / vazio | — | `reuniao_agendada` |

Nenhuma linha é importada como `fechado` ou `perdido`: fechar exige os dados do
fechamento (valor vendido, contrato, pagamento, onboarding) e perder exige
motivo, que a planilha não tem. Linhas cuja objeção sugere desfecho são
sinalizadas na análise para ajuste manual no Kanban.

`data_entrada_etapa` e o registro inicial em `historico_etapas` usam a data da
planilha (proposta, ou 1ª reunião), não a data da importação — assim o
dashboard não mostra 18 "movimentações" do dia da importação.

### Agenda e timeline

A planilha só tem **datas, sem horário**. Horários fixos foram adotados para
manter a ordem do dia:

| Planilha | CRM | Detalhe |
|---|---|---|
| 1° reunião (Status 1 = Feita) | `eventos` reunião **realizado**, 10:00–11:00 + `atividades` reunião "Realizado: 1ª reunião" | Mesmo resultado de marcar "Realizado" na agenda |
| Reunião de Proposta (Feita) | `eventos` apresentação **realizado**, 14:00–15:00 + `atividades` "Realizado: Reunião de proposta" | |
| Reunião de Proposta (Agendada) | `eventos` apresentação **agendado**, 14:00–15:00 | Se a data já passou, aparece em "Aguardando status" na agenda |
| Próximo Contato | `proximas_acoes` "Próximo contato" pendente | Datas passadas aparecem como atrasadas |
| Follow 1 / 2 / 3 | `atividades` nota "Follow-up N: feito" / "sem resposta" | **Sem data na planilha**: registrados no último dia de reunião conhecido, às 18:00, com a observação "sem data original" |

Os eventos realizados alimentam "reuniões realizadas" no dashboard.

## Análise da planilha (23/09/2026, cópia de Downloads)

Há duas cópias do arquivo; a de `Downloads` (23/09) é mais nova e mais
completa que a da Área de Trabalho (03/09). A análise abaixo é da de Downloads.

- **18 linhas com dados** (980 linhas vazias ignoradas), sem nomes repetidos.
- Serão criados: **18 clientes, 18 negociações, 32 eventos, 40 atividades,
  11 próximas ações**.
- Etapas: 12 `proposta_enviada`, 6 `reuniao_realizada`.
- Temperatura: 6 quente, 10 morno, 2 frio.
- Valor estimado total: R$ 42.850,00 (3 linhas sem valor).

### Possíveis problemas

| Linha | Cliente | Problema | Tratamento |
|---|---|---|---|
| todas | — | Sem telefone/WhatsApp/e-mail | Clientes entram sem contato |
| todas | — | Sem coluna de closer | Todos vão para `--dono` |
| 2 | IVS - Viana | "Responsavel" cortado: "Italo (gerente) - Mariana (dona" | Importado como está |
| 5 | Oral Sim - Sarandi | Sem Status da Proposta e sem valor; objeção indica "sem interesse por agora" | `reuniao_realizada`; **revisar se é perda** |
| 6 | Instituto Mix | Sem Status da Proposta e sem valor | `reuniao_realizada` |
| 7 | Thomas Beauty | Objeção diz "Fechou 30 dias…" mas o status é só proposta feita | `proposta_enviada`; **fechar pelo Kanban** com os dados do fechamento |
| 8 | Embelleze Santa Maria | Objeção: "não tem como investir agora, está de churn" | `proposta_enviada`; **revisar se é perda** |
| 10 | IVS - São Luiz | Reunião de proposta "Agendada" para 10/09 (já passou) | Evento agendado em "Aguardando status" |
| 15 | MATER DEI | Objeção é "Sem Resposta" (status de contato) | Importado como está |
| 18 | Famaqui | Reunião de proposta "Agendada" para 22/09 (já passou) | Evento agendado em "Aguardando status" |
| 19 | CTSE e POS | Sem valor | Valor vazio |
| 2, 3, 4, 5, 7, 8, 11, 15 | — | Próximo contato já passou | Próxima ação **atrasada** |
