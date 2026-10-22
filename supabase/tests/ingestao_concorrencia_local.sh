#!/usr/bin/env bash
# Teste de concorrência da ingestão por credencial (T10), com DUAS sessões reais.
#
# Só na cópia local: cria um banco descartável a partir do banco de teste
# informado (padrão crm_rx7_t9), grava fixtures, dispara o mesmo lead em duas
# sessões ao mesmo tempo e apaga o banco descartável no fim.
# Esperado: uma sessão cria (t), a outra espera o lock e só atualiza (f);
# 1 negociação e 1 cliente.
#
# Uso: PGBIN=/c/Tools/pg17/bin bash supabase/tests/ingestao_concorrencia_local.sh [banco_origem]
set -euo pipefail

PGBIN="${PGBIN:-/c/Tools/pg17/bin}"
ORIGEM="${1:-crm_rx7_t9}"
DB=crm_rx7_conc
P=(-h localhost -p 5543 -U postgres)

case "$ORIGEM" in crm_rx7_*) ;; *) echo "Só bancos de teste crm_rx7_*"; exit 1 ;; esac

"$PGBIN/dropdb" "${P[@]}" --if-exists "$DB"
"$PGBIN/createdb" "${P[@]}" -T "$ORIGEM" "$DB"
trap '"$PGBIN/dropdb" "${P[@]}" --if-exists "$DB"' EXIT

TOKEN=$("$PGBIN/psql" "${P[@]}" -d "$DB" -At -q -v ON_ERROR_STOP=1 <<'SQL' | tail -1 | tr -d '\r'
insert into auth.users (id, email) values
  ('50000000-0000-0000-0000-000000000001', 's@conc.invalid'), ('50000000-0000-0000-0000-00000000000a', 'a@conc.invalid');
insert into public.profiles (id, nome, email, role) values
  ('50000000-0000-0000-0000-000000000001', 's', 's@conc.invalid', 'closer'),
  ('50000000-0000-0000-0000-00000000000a', 'a', 'a@conc.invalid', 'closer') on conflict do nothing;
insert into public.super_admins (user_id) values ('50000000-0000-0000-0000-000000000001');
-- Com a T13, o plano da empresa nova precisa incluir a ingestão.
do $$ begin
  if to_regclass('public.planos') is not null then
    update public.planos set recursos = public.recursos_validos(), limite_integracoes = null where codigo = 'starter';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', false) is null;
select public.provisionar_empresa('Conc', 'empresa-conc', '50000000-0000-0000-0000-00000000000a') is null;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-00000000000a","role":"authenticated"}', false) is null;
select set_config('request.headers', '{"x-rx7-tenant":"empresa-conc"}', false) is null;
select public.gerar_credencial_ingestao('conc');
SQL
)

chamada() {
  local nome=$1 espera=$2
  "$PGBIN/psql" "${P[@]}" -d "$DB" -At -c "begin;
    select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true) is null;
    set local role service_role;
    select '$nome', criado from public.ingerir_lead_por_credencial('$TOKEN', 'ext-conc', 'Lead $nome', p_telefone => '5521977770000');
    select pg_sleep($espera) is null;
    commit;" | grep "^$nome"
}

chamada s1 3 & sleep 1
chamada s2 0
wait

"$PGBIN/psql" "${P[@]}" -d "$DB" -At -c \
  "select 'negociacoes=' || count(*) || ' clientes=' || count(distinct cliente_id) from public.negociacoes where external_id = 'ext-conc'"
