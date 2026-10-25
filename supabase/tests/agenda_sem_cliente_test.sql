-- ===========================================================================
-- Teste da proposta `20261026100000_agenda_sem_cliente` (reunião sem cliente).
--
-- ONDE RODAR: só numa cópia LOCAL (`crm_rx7_*`) com M1 + T1..T14 aplicadas e a
-- proposta por cima. Tudo termina em ROLLBACK. Cria usuários fictícios em
-- auth.users (esqueleto local) — nunca rodar no Supabase real.
--
-- PROVA:
--   1  gerente cria reunião sem cliente → fica na empresa da aba;
--   2  gerente agenda para um closer da empresa, sem cliente;
--   3  closer agenda para si sem cliente; para outra pessoa é recusado;
--   4  série sem cliente (closer) gera ocorrências na empresa certa;
--   5  sem empresa na requisição, ou empresa alheia, a gravação é recusada;
--   6  B não enxerga as reuniões de A (nem com o header de A);
--   7  status "realizado" sem cliente não quebra e não cria atividade;
--   8  negociação sem cliente continua recusada;
--   9  reuniões antigas (com cliente) não mudaram.
-- ===========================================================================

begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

create function public._teste_como(p_uid uuid, p_slug text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._teste_como(uuid, text) to authenticated, service_role;

create temp table _antes as
select count(*) as n, md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) as h from public.eventos e where e.escopo = 'legado';
grant select on _antes to authenticated;

do $$
declare
  u_super uuid := '40000000-0000-0000-0000-000000000001';
  u_a     uuid := '40000000-0000-0000-0000-00000000000a';  -- admin_empresa de A
  u_a_clo uuid := '40000000-0000-0000-0000-0000000000ac';  -- closer de A
  u_b     uuid := '40000000-0000-0000-0000-00000000000b';  -- admin_empresa de B
  t_a uuid; t_b uuid;
  ev uuid; ev2 uuid; serie_primeiro uuid;
  v_n bigint;
  v_t uuid;
  f_a uuid;
begin
  insert into auth.users (id, email) values
    (u_super, 'super.ag@teste.invalid'), (u_a, 'a.ag@teste.invalid'),
    (u_a_clo, 'aclo.ag@teste.invalid'), (u_b, 'b.ag@teste.invalid');
  insert into public.profiles (id, nome, email, role)
  select u.id, split_part(u.email, '@', 1), u.email, 'closer' from auth.users u
   where u.id in (u_super, u_a, u_a_clo, u_b)
  on conflict (id) do nothing;
  update public.profiles set ativo = true where id in (u_super, u_a, u_a_clo, u_b);
  insert into public.super_admins (user_id) values (u_super);

  perform public._teste_como(u_super, null);
  t_a := public.provisionar_tenant('Agenda A', 'agenda-a', 'assinante', u_a);
  t_b := public.provisionar_tenant('Agenda B', 'agenda-b', 'assinante', u_b);
  perform public._teste_como(u_a, 'agenda-a');
  perform public.definir_membro_tenant(t_a, u_a_clo, 'closer');

  -- 1. gerente sem cliente
  perform public._teste_como(u_a, 'agenda-a');
  insert into public.eventos (titulo, inicio, fim, usuario_id)
  values ('Reunião interna A', now() + interval '1 day', now() + interval '1 day 30 min', u_a)
  returning id, tenant_id into ev, v_t;
  assert v_t = t_a, 'reunião sem cliente deveria ficar na empresa A';
  raise notice 'ok 1 gerente cria reunião sem cliente na própria empresa';

  -- 2. gerente agenda para o closer
  insert into public.eventos (titulo, inicio, fim, usuario_id)
  values ('Reunião do closer', now() + interval '2 day', now() + interval '2 day 1 hour', u_a_clo)
  returning id into ev2;
  raise notice 'ok 2 gerente agenda para closer da empresa, sem cliente';

  -- 3. closer: para si sim, para outra pessoa não
  perform public._teste_como(u_a_clo, 'agenda-a');
  insert into public.eventos (titulo, inicio, fim, usuario_id)
  values ('Minha reunião', now() + interval '3 day', now() + interval '3 day 15 min', u_a_clo);
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id)
    values ('Para o gerente', now() + interval '3 day', now() + interval '3 day 15 min', u_a);
    assert false, 'closer não pode agendar para outra pessoa';
  exception when insufficient_privilege then
    raise notice 'ok 3 closer agenda só para si';
  end;

  -- 4. série sem cliente
  serie_primeiro := public.criar_serie_eventos(
    'Daily do closer', 'reuniao', 'agendado', null, null, u_a_clo, null,
    (current_date + 1), time '09:00', 30, 'diaria', 1, null, null, null, 3);
  select count(*) into v_n from public.eventos where serie_id = (select serie_id from public.eventos where id = serie_primeiro);
  assert v_n = 3, format('série deveria gerar 3 ocorrências, gerou %s', v_n);
  select count(*) into v_n from public.eventos
   where serie_id = (select serie_id from public.eventos where id = serie_primeiro) and tenant_id <> t_a;
  assert v_n = 0, 'ocorrências da série fora da empresa A';
  raise notice 'ok 4 série sem cliente (closer) na empresa certa';

  -- 5. sem empresa / empresa alheia
  perform public._teste_como(u_a, null);
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id)
    values ('Sem empresa', now(), now() + interval '15 min', u_a);
    assert false, 'sem empresa na requisição a gravação deveria falhar';
  exception when not_null_violation or insufficient_privilege or check_violation then
    raise notice 'ok 5a sem empresa na requisição: recusado';
  end;
  perform public._teste_como(u_a, 'agenda-a');
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id, tenant_id)
    values ('Na empresa B', now(), now() + interval '15 min', u_a, t_b);
    assert false, 'gravar com tenant de B a partir de A deveria falhar';
  exception when insufficient_privilege or check_violation or raise_exception then
    raise notice 'ok 5b tenant alheio explícito: recusado';
  end;
  perform public._teste_como(u_a, 'agenda-b');
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id)
    values ('Header de B', now(), now() + interval '15 min', u_a);
    assert false, 'header de empresa sem vínculo deveria falhar';
  exception when not_null_violation or insufficient_privilege or check_violation then
    raise notice 'ok 5c header de empresa sem vínculo: recusado';
  end;

  -- 6. B não vê A
  perform public._teste_como(u_b, 'agenda-b');
  select count(*) into v_n from public.eventos where tenant_id = t_a;
  assert v_n = 0, 'B não pode ver reuniões de A';
  perform public._teste_como(u_b, 'agenda-a');
  select count(*) into v_n from public.eventos;
  assert v_n = 0, 'B com header de A não vê nada';
  raise notice 'ok 6 B não enxerga reuniões de A';

  -- 7. status sem cliente
  perform public._teste_como(u_a, 'agenda-a');
  perform public.alterar_status_evento(ev, 'realizado');
  assert (select status from public.eventos where id = ev) = 'realizado', 'status deveria mudar';
  select count(*) into v_n from public.atividades where tenant_id = t_a;
  assert v_n = 0, 'sem cliente não há atividade na timeline';
  raise notice 'ok 7 realizado sem cliente: sem erro e sem atividade';

  -- 8. negociação sem cliente continua recusada (negociação real de A)
  f_a := public.criar_funil('Funil Agenda A', 'Ganho', 'verde', 'Perdido', 'vermelho', '[{"nome":"Novo","cor":"azul"}]');
  perform public.criar_cliente('pessoa_fisica', 'Cliente Agenda A', p_telefone => '5521900000099', p_funil_id => f_a);
  select n.id into v_t from public.negociacoes n join public.clientes c on c.id = n.cliente_id
   where c.nome = 'Cliente Agenda A';
  assert v_t is not null, 'fixture: negociação de A não criada';
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id, negociacao_id)
    values ('Neg sem cliente', now(), now() + interval '15 min', u_a, v_t);
    assert false, 'negociação sem cliente deveria falhar';
  exception when check_violation or insufficient_privilege or foreign_key_violation or raise_exception then
    raise notice 'ok 8 negociação sem cliente: recusada';
  end;

  -- 10. editar série sem cliente: "este", "seguintes" e "todos"
  perform public._teste_como(u_a_clo, 'agenda-a');
  select e.id into ev2 from public.eventos e
   where e.serie_id = (select serie_id from public.eventos where id = serie_primeiro)
   order by e.inicio offset 1 limit 1;                     -- 2ª ocorrência
  perform public.alterar_eventos(ev2, 'este', 'Daily remarcada', 'reuniao', null, null, u_a_clo, null,
    current_date + 2, time '10:00', 45);
  assert (select titulo from public.eventos where id = ev2) = 'Daily remarcada', 'este: título';
  assert (select count(*) from public.eventos where serie_id = (select serie_id from public.eventos where id = serie_primeiro)
           and titulo = 'Daily do closer') = 2, 'este: as outras ocorrências não mudam';
  perform public.alterar_eventos(ev2, 'seguintes', 'Daily nova', 'reuniao', null, null, u_a_clo, null,
    current_date + 2, time '11:00', 30);
  assert (select titulo from public.eventos where id = serie_primeiro) = 'Daily do closer', 'seguintes: a 1ª fica';
  assert (select count(*) from public.eventos where serie_id = (select serie_id from public.eventos where id = serie_primeiro)
           and titulo = 'Daily nova') = 2, 'seguintes: 2ª e 3ª mudam';
  perform public.alterar_eventos(serie_primeiro, 'todos', 'Daily final', 'reuniao', null, null, u_a_clo, null,
    current_date + 1, time '09:00', 30);
  select count(*) into v_n from public.eventos
   where serie_id = (select serie_id from public.eventos where id = serie_primeiro)
     and (titulo <> 'Daily final' or tenant_id <> t_a or cliente_id is not null);
  assert v_n = 0, 'todos: as 3 ocorrências atualizadas, na empresa A, sem cliente';
  raise notice 'ok 10 editar série sem cliente (este / seguintes / todos)';

  -- 11. responsável inativo ou de outra empresa: recusado
  perform public._teste_como(u_a, 'agenda-a');
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id)
    values ('Para alguém de B', now() + interval '1 day', now() + interval '1 day 30 min', u_b);
    assert false, 'responsável de outra empresa deveria ser recusado';
  exception when check_violation or insufficient_privilege or raise_exception then
    null;
  end;
  perform set_config('role', 'postgres', true);
  update public.tenant_memberships set ativo = false where tenant_id = t_a and user_id = u_a_clo;
  perform public._teste_como(u_a, 'agenda-a');
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id)
    values ('Para inativo', now() + interval '1 day', now() + interval '1 day 30 min', u_a_clo);
    assert false, 'responsável inativo deveria ser recusado';
  exception when check_violation or insufficient_privilege or raise_exception then
    null;
  end;
  perform set_config('role', 'postgres', true);
  update public.tenant_memberships set ativo = true where tenant_id = t_a and user_id = u_a_clo;
  raise notice 'ok 11 responsável de outra empresa ou inativo: recusado';

  -- 12. reunião com cliente (como as antigas): editar mantém cliente e empresa
  perform public._teste_como(u_a, 'agenda-a');
  select c.id into v_t from public.clientes c where c.nome = 'Cliente Agenda A';
  insert into public.eventos (titulo, inicio, fim, usuario_id, cliente_id)
  values ('Com cliente', now() + interval '4 day', now() + interval '4 day 1 hour', u_a, v_t)
  returning id into ev;
  perform public.alterar_eventos(ev, 'este', 'Com cliente (editada)', 'reuniao', v_t, null, u_a, null,
    current_date + 5, time '15:00', 60);
  assert (select cliente_id = v_t and tenant_id = t_a from public.eventos where id = ev), 'cliente e empresa mantidos';
  raise notice 'ok 12 reunião com cliente editada: vínculo e empresa mantidos';

  perform public._teste_como(null, null);
end;
$$;

-- 9. reuniões antigas intactas
do $$
declare
  v_ok boolean;
begin
  select (select n from _antes) = count(*) filter (where escopo = 'legado')
     and (select h from _antes) = md5(string_agg(to_jsonb(e)::text, '|' order by e.id) filter (where e.escopo = 'legado'))
    into v_ok
  from public.eventos e;
  assert v_ok, 'reuniões antigas mudaram';
  assert not exists (select 1 from public.eventos where escopo = 'legado' and cliente_id is null), 'legado perdeu cliente';
  raise notice 'ok 9 reuniões antigas (com cliente) intactas';
end;
$$;

rollback;
