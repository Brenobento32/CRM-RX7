# Scorpion CRM — Roadmap

Prioridades futuras. Para o que já existe, ver
[`SCORPION-MASTER.md`](SCORPION-MASTER.md). Para a tabela de fases
históricas (0 a 11E, Agenda A/N1/N2), ver a seção "Roadmap" de
[`ARQUITETURA.md`](ARQUITETURA.md) — este documento olha só pra frente.

## Pendências conhecidas (vindas de `ARQUITETURA.md`)

1. **Relatórios** — performance por closer, taxa de conversão, export CSV.
2. **Acabamento geral** — Realtime (hoje o Kanban/dashboard não atualizam
   sozinhos entre abas), estados vazios consistentes em todas as telas,
   responsivo completo, auditoria final de todas as policies de RLS
   (confirmar que cada tabela nova desde a Fase 1 tem exatamente as policies
   pretendidas, nem mais nem menos).

## Pendências identificadas durante o trabalho de permissões comerciais

3. **Caminhos de escrita que ainda só dependem de `owner_id`** — a auditoria
   da migration `20261014170000_protege_movimentacao_por_permissao`
   encontrou que a policy `negociacoes_update` (`owner_id OR gerente`)
   continua sendo o único portão pros **outros** campos da negociação (tudo
   além de `etapa_id`, que já ganhou o trigger dedicado). Nenhuma correção
   foi feita porque não foi pedida nem seu escopo foi definido — mas é um
   candidato natural a revisão: decidir se campos como `valor_estimado`,
   `temperatura`, etc. devem continuar liberados pra qualquer dono
   independente de `pode_ver`/`pode_mover`, ou se devem passar a exigir
   alguma permissão também.
4. **UX da "Lead Novo" sem permissão configurada** — todo lead novo nasce na
   etapa inicial do funil ("Lead Novo", fora das etapas de chave conhecida
   como `reuniao_agendada`). Se o gerente não conceder `pode_ver` nessa etapa
   especificamente, nem o próprio criador do lead (mesmo sendo o responsável)
   consegue vê-lo no Kanban — não é uma falha de segurança (é exatamente a
   regra "owner_id não dá bypass" funcionando), mas é uma pegadinha de
   produto: provavelmente toda configuração de SDR/CLOSER precisa incluir
   `pode_ver` na etapa inicial do funil, e isso vale documentar na própria
   tela de configuração ou validar ali (hoje a tela não avisa se o gerente
   deixar a etapa inicial sem visualização).
5. **Cliente sem nenhuma negociação** — caso raro e aceito como limitação
   (ver `SCORPION-MASTER.md`), mas caso o produto precise mudar isso no
   futuro, a solução não é reabrir a RLS de `clientes` — seria preciso um
   campo explícito de funil/origem no próprio cliente, decisão de modelo de
   dados que não foi tomada ainda.

## Processo para revisar este roadmap

Ao concluir um item daqui, mover a entrada correspondente (resumida) para
`SCORPION-MASTER.md`, na seção "Funcionalidades concluídas", e removê-la
deste arquivo — este documento deve refletir só o que **ainda não** foi
feito.
