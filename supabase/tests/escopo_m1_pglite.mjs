// Executa o ARQUIVO da migration M1 num Postgres descartavel em memoria (PGlite).
// Nao toca nenhum banco real. Requer: npm i --no-save @electric-sql/pglite
// Uso: node supabase/tests/escopo_m1_pglite.mjs supabase/migrations/20261021200000_escopo_dados_legado_rx7.sql [supabase/tests/escopo_m1_test.sql]
// Teste da M1 num Postgres DESCARTAVEL em memoria (PGlite). Nao toca nenhum banco real.
// Executa o ARQUIVO da migration, sem copia. Uso: node teste_m1.mjs <caminho da migration>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const sql = readFileSync(process.argv[2], 'utf8')
const TAB = ['clientes', 'negociacoes', 'fechamentos', 'metas', 'conversas', 'eventos', 'eventos_series']
let ok = 0, falhas = 0
const check = (nome, cond, extra = '') => { if (cond) { ok++; console.log('  ok  ', nome, extra) } else { falhas++; console.log('  FALHA', nome, extra) } }
const q = async (db, s) => (await db.query(s)).rows

// Esquema sintetico minimo, com FKs, updated_at e um trigger de UPDATE que registra qualquer disparo.
async function montar() {
  const db = new PGlite()
  await db.exec(`
    create table public.updates_log (tabela text, quando timestamptz default now());
    create function public.set_updated_at() returns trigger language plpgsql as $f$
      begin new.updated_at = now(); insert into public.updates_log(tabela) values (tg_table_name); return new; end $f$;
    create table public.clientes (id uuid primary key default gen_random_uuid(), nome text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.negociacoes (id uuid primary key default gen_random_uuid(), cliente_id uuid not null references public.clientes(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.fechamentos (negociacao_id uuid primary key references public.negociacoes(id), valor_vendido numeric(12,2) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.metas (id uuid primary key default gen_random_uuid(), valor_meta numeric(12,2) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.conversas (id uuid primary key default gen_random_uuid(), cliente_id uuid references public.clientes(id), telefone text not null, created_at timestamptz not null default now());
    create table public.eventos (id uuid primary key default gen_random_uuid(), cliente_id uuid references public.clientes(id), titulo text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.eventos_series (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
    create trigger t_cli before update on public.clientes for each row execute function public.set_updated_at();
    create trigger t_neg before update on public.negociacoes for each row execute function public.set_updated_at();
    create trigger t_fec before update on public.fechamentos for each row execute function public.set_updated_at();
    create trigger t_met before update on public.metas for each row execute function public.set_updated_at();
    create trigger t_evt before update on public.eventos for each row execute function public.set_updated_at();
    -- dados "legados" com datas antigas e distintas
    insert into public.clientes (id, nome, created_at, updated_at) values
      ('00000000-0000-0000-0000-0000000000c1','A','2026-09-02 12:00+00','2026-09-02 12:00+00'),
      ('00000000-0000-0000-0000-0000000000c2','B','2026-10-21 14:52:04+00','2026-10-21 14:52:04+00');
    insert into public.negociacoes (id, cliente_id, created_at, updated_at) values
      ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','2026-09-03 12:00+00','2026-10-21 20:35:46+00'),
      ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c2','2026-10-21 14:52:04+00','2026-10-21 14:52:04+00');
    insert into public.fechamentos (negociacao_id, valor_vendido, created_at, updated_at) values
      ('00000000-0000-0000-0000-0000000000a1', 30800.00, '2026-09-23 20:13:30+00','2026-10-19 18:42:21+00'),
      ('00000000-0000-0000-0000-0000000000a2', 11800.00, '2026-10-16 17:32:42+00','2026-10-16 17:32:42+00');
    insert into public.metas (valor_meta, created_at, updated_at) values (50000, '2026-09-24 14:15:33+00','2026-09-24 14:15:33+00');
    insert into public.conversas (cliente_id, telefone, created_at) values ('00000000-0000-0000-0000-0000000000c1','5511999990001','2026-10-01 12:56:53+00');
    insert into public.eventos (cliente_id, titulo, created_at, updated_at) values ('00000000-0000-0000-0000-0000000000c1','e1','2026-09-23 18:13:24+00','2026-10-15 19:07:52+00');
    delete from public.updates_log;`)
  return db
}

async function fotografia(db) {
  const f = {}
  for (const t of TAB) {
    const cols = (await q(db, `select column_name from information_schema.columns where table_schema='public' and table_name='${t}' and column_name in ('created_at','updated_at') order by 1`)).map((c) => c.column_name)
    const lista = cols.length ? cols.map((c) => `${c}::text`).join(` || '|' || `) : `''`
    f[t] = {
      n: Number((await q(db, `select count(*) n from public.${t}`))[0].n),
      datas: (await q(db, `select coalesce(string_agg(${lista}, ';' order by ${lista}), '') s from public.${t}`))[0].s,
      relfilenode: (await q(db, `select relfilenode::text r from pg_class where oid='public.${t}'::regclass`))[0].r,
    }
  }
  f.fin = (await q(db, `select (select sum(valor_vendido) from public.fechamentos)::text a, (select sum(valor_meta) from public.metas)::text b`))[0]
  f.log = Number((await q(db, `select count(*) n from public.updates_log`))[0].n)
  return f
}

console.log('CENARIO 1: aplicacao normal')
{
  const db = await montar()
  const antes = await fotografia(db)
  await db.exec(sql)
  const depois = await fotografia(db)

  for (const t of TAB) {
    const r = await q(db, `select escopo, count(*) n from public.${t} group by escopo`)
    const todasLegado = antes[t].n === 0 ? r.length === 0 : r.length === 1 && r[0].escopo === 'legado' && Number(r[0].n) === antes[t].n
    check(`${t}: linhas existentes = legado${antes[t].n === 0 ? ' (tabela vazia, como no RX7)' : ''}`, todasLegado, JSON.stringify(r))
    check(`${t}: contagem inalterada`, antes[t].n === depois[t].n, `${antes[t].n} -> ${depois[t].n}`)
    check(`${t}: created_at/updated_at inalterados`, antes[t].datas === depois[t].datas)
    check(`${t}: tabela NAO foi reescrita (relfilenode igual)`, antes[t].relfilenode === depois[t].relfilenode)
  }
  check('nenhum trigger de UPDATE disparou', depois.log === 0, `disparos: ${depois.log}`)
  check('valores financeiros inalterados', antes.fin.a === depois.fin.a && antes.fin.b === depois.fin.b, `${depois.fin.a} / ${depois.fin.b}`)
  check('relacionamentos consistentes', Number((await q(db, `select count(*) n from public.negociacoes n join public.clientes c on c.id=n.cliente_id join public.fechamentos f on f.negociacao_id=n.id`))[0].n) === 2)

  // linhas novas nascem rx7
  await db.exec(`insert into public.clientes (id, nome) values ('00000000-0000-0000-0000-0000000000c3','novo');
    insert into public.negociacoes (id, cliente_id) values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c3');
    insert into public.fechamentos (negociacao_id, valor_vendido) values ('00000000-0000-0000-0000-0000000000a3', 1);
    insert into public.metas (valor_meta) values (1);
    insert into public.conversas (telefone) values ('5511999990002');
    insert into public.eventos (titulo) values ('novo');
    insert into public.eventos_series default values;`)
  for (const t of TAB) {
    const r = await q(db, `select count(*) filter (where escopo='rx7') rx, count(*) filter (where escopo='legado') lg from public.${t}`)
    check(`${t}: linha nova = rx7 e antigas seguem legado`, Number(r[0].rx) === 1 && Number(r[0].lg) === antes[t].n, JSON.stringify(r[0]))
  }

  // defaults e constraints finais
  const def = await q(db, `select table_name, column_default, is_nullable from information_schema.columns where table_schema='public' and column_name='escopo' order by table_name`)
  check('default final = rx7 e NOT NULL em todas', def.length === 7 && def.every((d) => d.column_default.includes('rx7') && d.is_nullable === 'NO'))
  console.table(def)

  // restricoes
  for (const t of ['clientes', 'metas']) {
    let rej = false; try { await db.exec(`insert into public.${t} (${t === 'clientes' ? 'nome' : 'valor_meta'}, escopo) values (${t === 'clientes' ? "'x'" : '1'}, 'invalido')`) } catch (e) { rej = /check/i.test(e.message) }
    check(`${t}: escopo invalido rejeitado`, rej)
    let nul = false; try { await db.exec(`insert into public.${t} (${t === 'clientes' ? 'nome' : 'valor_meta'}, escopo) values (${t === 'clientes' ? "'x'" : '1'}, null)`) } catch (e) { nul = /null/i.test(e.message) }
    check(`${t}: escopo NULL rejeitado`, nul)
    let upd = false; try { await db.exec(`update public.${t} set escopo='outro'`) } catch (e) { upd = /check/i.test(e.message) }
    check(`${t}: UPDATE para valor invalido rejeitado`, upd)
  }
  await db.close()
}

console.log('CENARIO 2: falha no meio nao deixa classificacao parcial')
{
  const db = await montar()
  await db.exec(`drop table public.eventos_series`) // ultima tabela da lista: a falha acontece DEPOIS das outras 6
  let falhou = false
  try { await db.exec(sql) } catch (e) { falhou = /eventos_series/.test(e.message) }
  check('a migration falha quando uma tabela nao existe', falhou)
  const cols = await q(db, `select table_name from information_schema.columns where table_schema='public' and column_name='escopo'`)
  check('nenhuma coluna escopo ficou para tras (rollback total)', cols.length === 0, `colunas encontradas: ${cols.length}`)
  const log = Number((await q(db, `select count(*) n from public.updates_log`))[0].n)
  check('nenhum UPDATE no cenario de falha', log === 0)
  await db.close()
}

console.log('CENARIO 3: coluna ja existente (reaplicacao) falha sem alterar nada')
{
  const db = await montar()
  await db.exec(sql)
  let falhou = false
  try { await db.exec(sql) } catch (e) { falhou = /already exists|escopo/i.test(e.message) }
  check('reaplicar a migration e recusado', falhou)
  const r = await q(db, `select count(*) n from public.clientes where escopo='legado'`)
  check('classificacao anterior permanece', Number(r[0].n) === 2)
  await db.close()
}

if (process.argv[3]) {
  console.log('CENARIO 4: SQL de teste (banco de teste) executado no esquema sintetico')
  const db = await montar()
  const t = readFileSync(process.argv[3], 'utf8')
  let erro = null
  try { await db.exec(t) } catch (e) { erro = e.message }
  check('escopo_m1_test.sql roda sem erro e termina em ROLLBACK', erro === null, erro ?? '')
  const cols = await q(db, `select count(*) n from information_schema.columns where table_schema='public' and column_name='escopo'`)
  check('apos o teste (ROLLBACK) nenhuma coluna escopo ficou', Number(cols[0].n) === 0)
  await db.close()
}

console.log(`\nRESULTADO: ${ok} verificacoes ok, ${falhas} falhas`)
process.exit(falhas ? 1 : 0)
