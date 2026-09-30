-- ===========================================================================
-- Flag por funil: permite conversa WhatsApp naquele funil.
--
-- Só a coluna e o default. Nenhuma tabela de conexão/conversa/mensagem é
-- criada aqui — isso é o WhatsApp real, numa fase futura. RLS de `funis` já
-- cobre a tabela inteira (funis_update exige is_gerente()), então nenhuma
-- policy nova é necessária.
-- ===========================================================================
alter table public.funis
  add column whatsapp_habilitado boolean not null default false;

comment on column public.funis.whatsapp_habilitado is
  'Libera a seção/drawer de conversa WhatsApp no Kanban deste funil. Somente a flag — sem integração ainda.';
