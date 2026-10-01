-- ===========================================================================
-- Configuração da conexão WhatsApp: funil e responsável padrão.
--
-- Fase 2 — só os dois campos que o gerente escolhe em /configuracoes/whatsapp,
-- para quando a criação automática de cliente/negociação existir saber em
-- qual funil e com qual responsável abrir o lead. Nenhuma automação é
-- implementada aqui. `whatsapp_conexoes` continua linha única (ver
-- 20260930190000); o whatsapp-service (service_role) nunca escreve estas
-- duas colunas — só o Next.js, pela RLS nova abaixo.
--
-- NOT NULL exige backfill: a linha única já existe (a conexão já rodou).
-- Backfill determinístico, só para a migration não falhar — o gerente ajusta
-- na tela depois:
--   funil_id               -> primeiro funil ativo com whatsapp_habilitado,
--                             por ordem de criação.
--   responsavel_padrao_id  -> primeiro profile ativo com role='gerente', por
--                             ordem de criação.
-- Aborta se não encontrar candidato (ambiente sem funil habilitado ou sem
-- gerente ativo) — não há valor seguro para inventar.
-- ===========================================================================

alter table public.whatsapp_conexoes
  add column funil_id uuid references public.funis (id) on delete restrict,
  add column responsavel_padrao_id uuid references public.profiles (id) on delete restrict;

update public.whatsapp_conexoes
   set funil_id = (
         select f.id from public.funis f
          where f.whatsapp_habilitado and f.ativo
          order by f.created_at
          limit 1
       ),
       responsavel_padrao_id = (
         select p.id from public.profiles p
          where p.role = 'gerente' and p.ativo
          order by p.created_at
          limit 1
       );

do $$
begin
  if exists (select 1 from public.whatsapp_conexoes where funil_id is null) then
    raise exception 'Migração abortada: nenhum funil ativo com whatsapp_habilitado para servir de padrão.';
  end if;
  if exists (select 1 from public.whatsapp_conexoes where responsavel_padrao_id is null) then
    raise exception 'Migração abortada: nenhum gerente ativo para servir de responsável padrão.';
  end if;
end;
$$;

alter table public.whatsapp_conexoes
  alter column funil_id set not null,
  alter column responsavel_padrao_id set not null;

comment on column public.whatsapp_conexoes.funil_id is
  'Funil que receberá o lead novo de uma conversa sem cliente vinculado (automação futura). Só funis com whatsapp_habilitado podem ser escolhidos, pela UI.';
comment on column public.whatsapp_conexoes.responsavel_padrao_id is
  'Dono (owner_id) do cliente/negociação que a automação futura criará a partir do WhatsApp. Escolhido pelo gerente na UI.';

-- ---------------------------------------------------------------------------
-- RLS: gerente passa a poder ATUALIZAR a linha única, só para configurar
-- funil_id/responsavel_padrao_id pela tela. status/numero/conectado_em
-- continuam exclusivos do whatsapp-service (service_role ignora RLS; a UI
-- do Next.js nunca envia essas colunas no update).
-- ---------------------------------------------------------------------------
create policy whatsapp_conexoes_update on public.whatsapp_conexoes
  for update to authenticated
  using (public.is_gerente())
  with check (public.is_gerente());

grant update on table public.whatsapp_conexoes to authenticated;
