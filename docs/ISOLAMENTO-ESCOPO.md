# Isolamento de dados legados (`escopo`) — M1: backup, validação e reversão

Estado: **M1 preparada e NÃO aplicada.** Nenhuma migration deste plano foi
aplicada em produção. Este documento é a referência para backup, aplicação e
reversão da M1 (`20261021200000_escopo_dados_legado_rx7.sql`).

## O que a M1 muda

Adiciona `escopo text not null` em 7 tabelas: `clientes`, `negociacoes`,
`fechamentos`, `metas`, `conversas`, `eventos`, `eventos_series`.

- Linhas existentes: `'legado'` (sem `UPDATE`, sem trigger, sem reescrita).
- Linhas novas: `'rx7'` (default final).
- Constraint `<tabela>_escopo_check`: só `'legado'` ou `'rx7'`.
- **Não** altera índices únicos, RLS, RPCs de ingestão nem de métricas.

## Linha de base (P0, 21/10/2026, CRM-RX7)

| Item | Valor |
|---|---|
| clientes / negociações / fechamentos / metas | 74 / 79 / 14 / 9 |
| atividades / eventos / conversas / histórico de etapas | 69 / 35 / 5 / 188 |
| Faturamento Set/2026 (MRR + TCV) | R$ 2.850 + R$ 30.800 = **R$ 33.650** |
| Faturamento Out/2026 (MRR + TCV) | R$ 6.100 + R$ 11.800 = **R$ 17.900** |
| Fechamentos válidos / anulados | 12 / 2 |
| Registros criados ou alterados após a cópia | 0 |

Depois da M1, **todos esses números têm de continuar idênticos**, e toda
linha existente deve ter `escopo = 'legado'`.

## Backup antes de aplicar (obrigatório)

O plano Free do Supabase **não tem backups** (indicado pelo painel). Antes de
qualquer aplicação em produção:

1. **Backup lógico completo** com `pg_dump` (formato custom) da conexão do
   CRM-RX7, com a senha do banco digitada pelo responsável (nunca em arquivo
   versionado, nunca em chat). Incluir os schemas `public` e `auth`.
2. **Backup secundário**: exportar em CSV as 8 tabelas da linha de base pelo
   Table Editor.
3. **Restauração testada**: restaurar o dump num banco **descartável** (local
   ou projeto Supabase de teste) e conferir, tabela por tabela, as contagens e
   os totais financeiros da linha de base. **Backup só vale depois de a
   restauração ser comprovada.**
4. Guardar o dump fora do repositório e do computador de trabalho.

Alternativa mais simples: ativar um plano com backups diários ou PITR antes da
aplicação.

## Aplicação (quando autorizada)

1. Janela de manutenção: ninguém logado, sem ingestão, sem WhatsApp.
2. Reexecutar a verificação do P0 e conferir que ainda é igual à linha de base.
3. Aplicar a M1 (um único bloco `DO`, atômico).
4. Reconferir a linha de base e `escopo = 'legado'` em todas as linhas.

## Testes

| Teste | Onde roda | Escreve em produção? |
|---|---|---|
| `supabase/tests/escopo_m1_pglite.mjs` — executa o **arquivo** da migration num Postgres em memória, com cenários de sucesso, falha no meio e reaplicação | máquina local, `@electric-sql/pglite` | não |
| `supabase/tests/escopo_m1_test.sql` — mesmo padrão dos outros testes SQL, com `ROLLBACK` | **somente** banco de teste com a cópia dos dados | **nunca** em produção |

## Reversão da M1

Só remove o marcador; nenhum dado comercial é afetado. Se migrations
posteriores (M2 em diante) já usarem `escopo`, **reverta-as antes**, na ordem
inversa.

```sql
do $$
declare
  v_t text;
begin
  foreach v_t in array array['clientes','negociacoes','fechamentos','metas','conversas','eventos','eventos_series'] loop
    execute format('alter table public.%I drop constraint %I', v_t, v_t || '_escopo_check');
    execute format('alter table public.%I drop column escopo', v_t);
  end loop;
end $$;
```

## Restauração (desastre)

1. Parar o uso do CRM.
2. Restaurar o dump validado num banco limpo (ou sobre o atual, conforme o
   caso), com `pg_restore`.
3. Conferir a linha de base (tabela acima).
4. Só então reabrir o uso.
