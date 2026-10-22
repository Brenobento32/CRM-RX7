# Runbook da M1 — backup, aplicação e reversão no CRM-RX7

Projeto: `ybgzlxgeoiggmfdxarqx` (Rio X7 Agencia Digital). Estado: **preparado,
NÃO executado.** Nenhum passo deste runbook foi aplicado em produção.
Decisão: não criar outro projeto Supabase; tudo acontece no CRM-RX7, com
restauração de teste em Postgres **local**.

## 1. Backup (obrigatório; o plano Free não tem backups)

Ferramenta oficial: `pg_dump` / `pg_restore` do PostgreSQL 17 (o
`supabase db dump` exige Docker, e a virtualização deste computador está
desligada). Instalação mínima: binários **portáteis** do PostgreSQL 17 (zip da
EDB), numa pasta fora do repositório, sem serviço do Windows.

1. Pasta do backup **fora do repositório**: `C:\Backups\crm-rx7\`.
2. Senha do banco informada só por quem executa, sem aparecer nem gravar:
   `Read-Host -AsSecureString` → variável `PGPASSWORD` só na sessão; apagada
   ao final (`Remove-Item Env:\PGPASSWORD`). Nunca em arquivo, log ou chat.
3. `pg_dump` do schema `public` (formato custom, `--no-owner`) pelo **session
   pooler** (porta 5432). Dados de `auth.users`/`auth.identities` e
   `storage.buckets` em arquivo à parte (contêm hashes de senha: segredo).
4. Proteção: `cipher /e` na pasta; nada de commit.
5. **Integridade do arquivo:** `pg_restore --list` (deve listar 26 tabelas,
   78 funções, 79 policies, 48 triggers), tamanho > 0 e SHA-256 anotado.
6. **Um backup só é "recuperável" depois de restaurado.** Restauração de teste
   em PostgreSQL 17 portátil, `localhost:5543`, esqueleto de `auth`, `storage`,
   papéis (`anon`, `authenticated`, `service_role`) e `pg_trgm` em `extensions`.
   O script de restauração recusa qualquer host que não seja `localhost`.
7. Na cópia restaurada: pré-verificação, `escopo_m1_test.sql`, M1,
   pós-verificação, e conteúdo inalterado conferido por `EXCEPT` (zero linhas
   diferentes, ignorando `escopo`; nenhum dado exibido, nenhum hash de dado
   pessoal).

**Limites:** configurações do Auth, Edge Functions e segredos não entram no
dump; papéis e grants dependem do esqueleto.

## 2. Revisão técnica da M1 (feita)

| Ponto | Conclusão |
|---|---|
| Colunas reais (P0) | nenhuma das tabelas tem coluna `escopo`; a migration falharia em voz alta se tivesse |
| Tabelas classificadas | 7: `clientes`, `negociacoes`, `fechamentos`, `metas`, `conversas`, `eventos`, `eventos_series`; as demais herdam da negociação, do cliente ou da conversa |
| Linhas atuais | todas ficam `legado`; a migration confere e aborta se alguma não ficar |
| Linhas novas | `rx7` (default final) |
| UPDATE em legado | nenhum; sem trigger de linha, sem mudança de `updated_at`, sem reescrita de tabela (comprovado no PGlite) |
| Atomicidade | um único bloco `DO`; falha em qualquer tabela desfaz tudo (comprovado) |
| **Travas** | `ALTER TABLE` pede lock exclusivo por instantes; a migration define `lock_timeout = 5s` e `statement_timeout = 30s` (só na transação): se algo segurar a tabela, desiste com 55P03 e desfaz tudo; basta repetir na janela |
| Escritas concorrentes | uma escrita em andamento nas 7 tabelas atrasa ou aborta a migration (nunca corrompe); por isso a janela sem gravações |
| `%rowtype` (`conversas`, `eventos`, `eventos_series`) | se adaptam às colunas novas; não há `select *`, `returns setof` nem `insert … select` dependentes das 7 tabelas |
| Constraints `NOT VALID` | `clientes_documento_por_tipo` e `clientes_telefone_formato` (de propósito, para tolerar legado) continuam como estão; **a partir da M6, qualquer UPDATE em cliente legado será checado por elas** |
| RLS, índices únicos, RPCs | **intocados** na M1 |

## 3. Checklist de pré-aplicação

- [ ] Backup concluído, protegido, **restaurado e validado** (seção 1).
- [ ] `escopo_m1_test.sql` e a M1 executados com sucesso na **cópia restaurada**.
- [ ] Janela combinada: ninguém logado no CRM, WhatsApp desconectado, webhook do
      Respondi **não** aponta para o RX7 (aponta para a Scorpion), sem Edge
      Function de ingestão ativa no RX7.
- [ ] Pré-verificação (`supabase/tests/escopo_m1_pre_verificacao.sql`) com
      **todas** as linhas `ok = true`, salva a saída (contagens e datas).
- [ ] Consulta informativa de sessões ativas (no fim daquele arquivo) sem
      escritas em andamento.
- [ ] Reversão e restauração lidas por quem vai executar.

**Estado da pré-verificação em 21/10/2026:** executada somente-leitura no
CRM-RX7. Contagens 74/79/14/9/69/35/5/188 ok; faturamento Set R$ 33.650 e Out
R$ 17.900 ok; órfãos 0; criados/alterados após o corte 0; 48 triggers ligados;
nenhuma coluna `escopo` existente. Única divergência de critério: as
constraints `NOT VALID` (3 no total: 2 em `public.clientes` e 1 do `realtime`),
que são **esperadas**; o critério foi corrigido para contar só as do `public`
(2). Esse ajuste não foi reexecutado; a pós-verificação ainda não foi rodada.

## 4. Aplicação (só com autorização)

1. Rodar a pré-verificação. Qualquer `false`: **parar** (seção 6).
2. Aplicar a M1 (arquivo `20261021200000_escopo_dados_legado_rx7.sql`) **uma
   única vez**, como um único script, no SQL Editor do CRM-RX7.
3. Rodar a pós-verificação (`supabase/tests/escopo_m1_pos_verificacao.sql`):
   **todas** as linhas `ok = true`.
4. Registrar a migration no histórico (`supabase_migrations.schema_migrations`),
   junto com a `20261021190000` que também foi aplicada à mão, para a CLI não
   tentar reaplicá-las (escrita; exige autorização à parte).
5. Manter a janela fechada até a pós-verificação passar.

## 5. SQL de verificação

- Pré: `supabase/tests/escopo_m1_pre_verificacao.sql` (somente leitura).
- Pós: `supabase/tests/escopo_m1_pos_verificacao.sql` (somente leitura).

## 6. Critérios para interromper

Parar, não aplicar (ou reverter) se:
- qualquer linha da pré-verificação vier `false` (exceto o ajuste já descrito);
- houver registro criado ou alterado depois do corte (pode haver registro do
  RX7 misturado ao legado: reclassificar antes);
- a migration falhar (55P03, erro de tabela ou conferência): nada foi alterado,
  conferir o motivo antes de repetir;
- a pós-verificação tiver qualquer `false`;
- alguém escrever no CRM durante a janela.

## 7. Reversão

Só remove o marcador; nenhum dado comercial é afetado. Se migrations
posteriores (M2 em diante) já usarem `escopo`, **reverta-as antes**, na ordem
inversa.

```sql
do $$
declare
  v_t text;
begin
  perform set_config('lock_timeout', '5s', true);
  foreach v_t in array array['clientes','negociacoes','fechamentos','metas','conversas','eventos','eventos_series'] loop
    execute format('alter table public.%I drop constraint %I', v_t, v_t || '_escopo_check');
    execute format('alter table public.%I drop column escopo', v_t);
  end loop;
end $$;
```

Se a reversão não bastar (dado danificado): parar o uso, restaurar o backup
validado (`pg_restore`), conferir a linha de base, só então reabrir.

## 8. Sequência das migrations seguintes (cada uma só com autorização)

| # | Migration | Depende de |
|---|---|---|
| M1 | colunas `escopo` | pré-verificação |
| M2 | índices: `conversas (telefone, escopo)`; CPF e CNPJ por escopo | M1 |
| M3 | ingestão e deduplicação só em `rx7`; travas por `external_id` e por contato | M1, M2 |
| M4 | métricas, metas, dashboards e Kanban só `rx7` | M1 |
| M5 | `whatsapp-service`, Edge Function, selo "Legado", tipos do app | M3, M4 |
| M6 | proteção do legado contra UPDATE e DELETE (opcional) | M1 |
| M7 | RLS restritiva do financeiro legado (opcional) | M1, M4 |

Pré-requisito da M3 em diante: criar a configuração de ingestão do RX7
(funil, etapa inicial e responsável padrão), que **não existe** hoje em
`whatsapp_conexoes`.

## 9. Procedimento FINAL de aplicação (substitui a seção 4)

Estado: **preparado e ensaiado na cópia local; NÃO executado em produção.**

Script único, gerado por `C:\Tools\crm-rx7\montar-aplicacao-m1.ps1` (fora do Git) em
`C:\Tools\crm-rx7\saida\aplicar-m1-rx7.sql`. Ele só é gerado se a SHA-256 da migration for
`22BDC4912FF42536689959976FBFFA6B70B38A0385DE2F4F8D67DA28DDB1D97C`. Conteúdo, em **uma** transação
(`begin` … `commit`):

1. **Trava de identidade e de estado** (aborta e nada é gravado): banco `postgres`; 1 perfil e 1 usuário de Auth,
   com o id do RX7; contagens da linha de base; faturamento Set R$ 33.650 e Out R$ 17.900; nenhum registro
   criado ou alterado depois do corte; 0 órfãos; nenhuma coluna `escopo`; tabela de histórico presente e M1 ainda
   não registrada.
2. **A M1**, byte a byte (com `lock_timeout` 5 s e `statement_timeout` 30 s).
3. **Registro** em `supabase_migrations.schema_migrations` (`20261021200000`).
4. **Conferência final** (aborta e desfaz TUDO): todas as linhas `legado`, defaults `rx7` e `NOT NULL`,
   constraints validadas, contagens e financeiro iguais, registro presente.

**Onde rodar:** SQL Editor do projeto CRM-RX7 (`.../project/ybgzlxgeoiggmfdxarqx/sql/new`, cabeçalho "CRM-RX7").
**Não** usar `supabase db push` (a CLI está sem login e aplicaria também a `20261021190000`).

Ensaios feitos na cópia restaurada (todos com o resultado esperado): trava aborta com a M1 já aplicada; aborta com
registro alterado depois do corte; falha forçada na conferência final desfaz M1 e registro (0 colunas, 0
constraints, 0 registros); caminho feliz em 161 ms; pós-verificação 36/36.

**Pré-verificação — o que impede e o que é informativo.** Impedem a aplicação (a trava do script também os exige,
exceto os marcados com *): contagens da linha de base; faturamento; nenhuma coluna `escopo`; nenhum registro
criado/alterado após o corte; 0 órfãos; 48 triggers ligados*; 2 constraints `NOT VALID` no `public`*. São
informativos (decisão humana): sessões do banco, último login e sessões de Auth, conexão do WhatsApp, webhook do
Respondi (apontando para o sistema antigo), ausência de Edge Functions de ingestão no RX7.

**Registro da `20261021190000`** (aplicada à mão): fora deste script; decisão à parte, para a CLI não tentar
reaplicá-la (ela é idempotente).

### Falhas e recuperação
| Situação | Ação |
|---|---|
| Falha durante o script | rollback automático; nada foi gravado; diagnosticar antes de repetir |
| Falha detectada após o `commit` | reversão específica da seção 7, só depois de diagnosticar; não é automática |
| Falha grave | parar o uso; restaurar `public.dump` (`pg_restore`); `auth` e `storage` **não** têm backup completo (só `auth.users`, `auth.identities`, `storage.buckets`); conferir a linha de base |
