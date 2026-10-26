# AVANTE — Matriz de cargos

**Situação:** as quatro decisões foram aprovadas e estão implementadas e
testadas **só no ambiente local** (`C:\Tools\avante-local`). Nada disto está
no banco de produção: as migrations são propostas em `supabase/propostas/`
(estrutura separada da ativação) e só sobem com autorização explícita.

São **cinco cargos** por empresa — Administrador, Vendedor, Atendente, SDR e Closer.
**Super Admin não é cargo**: é um privilégio global da Rio X7.

> **Nome na interface:** o cargo "Gerente" passou a se chamar
> **Administrador** nas telas. O identificador técnico continua `gerente`
> (e `admin_empresa`), com as mesmas permissões — onde este documento diz
> "Gerente", leia Administrador. O Super Admin entra no CRM de qualquer
> empresa pelo painel global (janela de acesso auditada, papel de
> Administrador naquela empresa); ver `docs/SAAS-MULTIEMPRESA.md`.

## Regras que valem para todos

1. **Negado por padrão.** O que não estiver liberado abaixo não existe para o
   cargo — no banco (RLS, triggers e funções) e na tela. A tela só reflete.
2. **Cada cargo tem regras próprias.** Vendedor não herda de Closer; Atendente
   não herda de SDR. O mapeamento é explícito (`papel_do_cargo()`): nenhum
   cargo "vira gerente" por cair num `else`.
3. **Gerente administra só a própria empresa.** Nunca vê nem altera outra.
4. **Ninguém aumenta o próprio privilégio**: não muda o próprio vínculo, não
   cria permissão para si, não libera etapa para si.
5. **O teto do handoff** ("Reunião realizada") é absoluto para **SDR e
   Atendente** (trigger `negociacoes_valida_handoff_sdr`).
6. **Visibilidade comercial continua configurável** por pessoa, funil e etapa
   (`permissoes_colaborador`). A matriz é o **teto**; o Gerente libera dentro
   dele. `owner_id` nunca concede acesso.
7. **Permissões extras** (além desta matriz) só entram como nova proposta.

## Matriz

Legenda: ✅ pode · ⚙️ só se o Gerente liberar para a pessoa (funil/etapa) ·
👤 só os próprios registros · 👁 só leitura · — não pode.

| Área | Ação | Gerente | Vendedor | Atendente | SDR | Closer | Super Admin |
|---|---|---|---|---|---|---|---|
| **Clientes** | Ver | ✅ empresa | ⚙️ | ⚙️ | ⚙️ | ⚙️ | 👁 via painel¹ |
| | Criar | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| | Editar | ✅ | 👤 | 👤 | 👤 | 👤 | — |
| | Arquivar / excluir | ✅ | — | — | — | — | — |
| **Negociações** | Mover até "Reunião realizada" | ✅ | ⚙️ | ⚙️ etapas liberadas² | ⚙️ teto | ⚙️ | — |
| | Mover depois de "Reunião realizada" | ✅ | ⚙️ | — | — | ⚙️ | — |
| | Fechar ganho / perdido | ✅ | ⚙️ 👤 | — | — | ⚙️ 👤 | — |
| | Desqualificar / arquivar | ✅ | ⚙️ 👤 | — | ⚙️ 👤 | ⚙️ 👤 | — |
| | Excluir | ✅ | 👤 | — | — | 👤 | — |
| | Transferir responsável | ✅ | — | — | — | — | — |
| **Agenda** | Agendar para si | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| | Agendar para outra pessoa | ✅ empresa | — | ✅ só Closer³ | ✅ só Closer³ | — | — |
| | Ver ocupação dos Closers (só horários) | ✅ | — | ✅ | ✅ | — | — |
| | Ver agenda da equipe | ✅ | — | — | — | — | — |
| **Metas** | Vendas TCV/MRR — configurar | ✅ | — | — | — | — | — |
| | Vendas TCV/MRR — meta individual | — | 👤 | — | — | 👤 | — |
| | Reuniões (SDR) — configurar | ✅ | — | — | — | — | — |
| | Reuniões (SDR) — acompanhar | ✅ equipe | — | — | 👤 | — | — |
| **Propostas** | Ver / trabalhar | ✅ | 👤 ⚙️ | — | — | 👤 ⚙️ | — |
| **Conversas (WhatsApp)** | Ver / responder | ✅ | 👤 | 👤⁴ | 👤 | 👤 | — |
| **Relatórios / métricas** | Equipe | ✅ | — | — | — | — | — |
| | Próprios números | ✅ | ✅ | — | ✅ | ✅ | — |
| **Configurações** | Etapas e liberação para Atendentes | ✅ funis da empresa | — | — | — | — | — |
| | Usuários (criar/editar/desativar) | ✅ só na empresa, no limite do plano | — | — | — | — | ✅ gerente inicial |
| | Integrações / credenciais | ✅ | — | — | — | — | ✅ |
| **Empresa** | Logo, telefone, e-mail, responsável | ✅ própria | — | — | — | — | ✅ |
| | Nome comercial, endereço (slug), plano, IDs | — | — | — | — | — | ✅ auditado |
| | Cadastrar empresa | — | — | — | — | — | ✅ |
| **Assinatura** | Ver plano e consumo | ✅ admin | — | — | — | — | ✅ |
| | Alterar plano / situação | — | — | — | — | — | ✅ auditado |

¹ Super Admin enxerga cadastro, assinatura, usuários e auditoria de qualquer
empresa pelo painel `/admin`. Dados comerciais, só com vínculo na empresa.

² Ver "Atendente no funil" abaixo.

³ Ver "Reunião para o Closer" abaixo.

⁴ A "fila da empresa" para o Atendente **não foi aprovada**: continua como
proposta. Hoje o Atendente vê as conversas dos próprios clientes, como os
demais.

## As quatro decisões aprovadas — como ficaram

### 1. Atendente no funil

- **Configuração por empresa:** Funil → Configurações do funil → Etapas,
  coluna **Atendentes** (Liberada / Bloqueada). Só o Gerente muda, só nos
  funis da própria empresa. Começa tudo **bloqueado**.
- Etapas de fechamento (Ganha/Perdida) aparecem como **Protegida**: nunca
  podem ser liberadas (`check` no banco: só etapa aberta).
- Para mover, valem **todas** as condições, checadas no banco a cada
  movimentação (trigger `negociacoes_regras_atendente`, tela e API):
  - a negociação é dele ou da carteira dele (dono da negociação ou do cliente);
  - origem e destino são etapas abertas liberadas pelo Gerente;
  - a permissão individual de mover daquela etapa (Usuários → Permissões);
  - o teto do handoff.
- Nunca: marcar Ganha/Perdida, gravar ou anular um fechamento direto na
  tabela, desqualificar/arquivar, excluir, transferir o responsável, alterar
  negociação de outra pessoa ou as próprias permissões.

### 2. Reunião para o Closer (SDR e Atendente)

- Na agenda nativa, o campo **Responsável** mostra a própria pessoa e os
  **Closers ativos da mesma empresa** — mais ninguém (banco:
  `agenda_pode_definir_responsavel` + `agenda_valida_responsavel`).
- O formulário mostra a **ocupação** dos Closers ("Horário ocupado", sem
  título nem cliente — RPC `agenda_ocupacao`) e **avisa o conflito**, mas
  deixa agendar mesmo assim.
- **Quem criou** fica registrado em `criado_por`, preenchido pelo banco (não
  dá para forjar). O Closer vê como responsável; quem agendou continua vendo
  e editando o que marcou. O detalhe da reunião mostra "Agendada por".

### 3. Metas de reuniões do SDR

- Tabela própria `metas_reunioes` (mês, SDR, meta de agendadas, meta de
  realizadas), **separada das metas de vendas**. Só o Gerente configura, só
  para SDRs da própria empresa.
- Tela **Metas**: o Gerente vê a equipe (totais e por SDR, com campos de
  meta); o SDR vê só os próprios números.
- Como conta (`metas_reunioes_progresso`):
  - reuniões e apresentações **criadas pelo SDR** para um Closer ou com
    cliente (compromisso interno do próprio SDR não conta);
  - **agendadas**: pela data em que foram marcadas, sem as canceladas;
  - **realizadas**: pela data da reunião, com status "realizado";
  - **série conta uma vez**; remarcar não cria uma nova reunião, então não
    conta em dobro.

### 4. Gerente e os dados da empresa

- **Configurações → Dados da empresa**: logotipo, telefone, e-mail e nome do
  responsável. Nome comercial e endereço aparecem só para leitura.
- No banco: `empresa_atualizar_contato()` só grava esses quatro campos, só na
  empresa da requisição, só para Gerente/admin, com auditoria. O logo só pode
  estar na pasta da própria empresa no bucket `empresa-logos`.
  `admin_atualizar_empresa()` (que muda o nome) ficou só para o Super Admin.
- Slug, plano/assinatura, IDs, outras empresas e privilégios de Super Admin
  continuam fora do alcance do Gerente.

## Diferença entre os quatro cargos comerciais

| Cargo | Papel no funil | Teto de handoff | Meta |
|---|---|---|---|
| **Atendente** | Primeiro contato, cadastro e qualificação nas etapas liberadas | Sim | — |
| **SDR** | Prospecção e qualificação até a reunião | Sim | Reuniões agendadas e realizadas |
| **Closer** | Recebe o lead qualificado e fecha | Não | TCV/MRR |
| **Vendedor** | Ciclo completo do próprio lead, do contato ao fechamento | Não | TCV/MRR |

## Onde está cada coisa

| Parte | Arquivo |
|---|---|
| Enum dos cargos (estrutura 1/3) | `supabase/propostas/20261027100000_empresa_papeis_enum.sql` |
| Dados da empresa, logo, slug (estrutura 2/3) | `supabase/propostas/20261027100100_empresa_perfil.sql` |
| Liberação de etapas, `criado_por`, metas de reuniões (estrutura 3/3) | `supabase/propostas/20261027100200_cargos_estrutura.sql` |
| Ativação das permissões | `supabase/propostas/20261027100300_cargos_ativacao.sql` |
| Testes no banco | `supabase/tests/cargos_test.sql`, `empresa_perfil_test.sql`, `agenda_sem_cliente_test.sql` |
| Cargos nas telas | `lib/validations/usuario.ts` (`CARGOS_POR_AREA`, `CARGOS_EM_ORDEM`) |
