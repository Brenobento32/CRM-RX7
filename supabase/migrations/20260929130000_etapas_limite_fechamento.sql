-- ===========================================================================
-- Corrige `etapas_funil_regras()`: o limite de posição das etapas abertas
-- deixa de usar a etapa de chave 'negociacao' como marco especial do Funil
-- Principal. Passa a ser sempre a menor `ordem` entre as etapas ganha/perdida
-- do próprio funil — igual ao que já valia para os demais funis.
--
-- Antes: uma etapa aberta não podia ter `ordem >= ordem(Negociação)`, mesmo
-- estando bem abaixo de Fechado/Perdido — Negociação funcionava como teto
-- fixo, mesmo sendo, como as outras, uma etapa `tipo = 'aberta'`.
-- Depois: Negociação vira uma etapa aberta comum — participa do bloco
-- reordenável como qualquer personalizada (só não ganha setas na UI por ser
-- `sistema`), e o único teto real volta a ser Fechado/Perdido.
--
-- Única mudança: a sub-select por `chave = 'negociacao'` sai; o que era o
-- fallback (`min(ordem)` de ganha/perdida) vira a única regra, para todos os
-- funis. Todo o resto da função (DELETE, proteção de sistema, proteção de
-- desativação com negociação atual) fica idêntico.
-- ===========================================================================
create or replace function public.etapas_funil_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limite numeric;
begin
  if tg_op = 'DELETE' then
    if old.sistema then
      raise exception 'Etapas padrão do funil não podem ser excluídas.' using errcode = '23514';
    end if;
    if exists (select 1 from public.negociacoes n where n.etapa_id = old.id)
       or exists (
         select 1 from public.historico_etapas h
         where h.etapa_nova_id = old.id or h.etapa_anterior_id = old.id
       )
    then
      raise exception 'A etapa "%" já teve negociações. Desative-a em vez de excluir.', old.nome
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.sistema then
    -- Sistema: só a cor muda (nem o funil de uma etapa de sistema muda).
    if new.nome is distinct from old.nome
       or new.ordem is distinct from old.ordem
       or new.tipo is distinct from old.tipo
       or new.sistema is distinct from old.sistema
       or new.chave is distinct from old.chave
       or new.ativo is distinct from old.ativo
       or new.funil_id is distinct from old.funil_id
    then
      raise exception 'Nas etapas padrão do funil só a cor pode ser alterada.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Personalizada (inserção ou edição) — inclusive ganha/perdida de um funil novo.
  if new.sistema or new.chave is not null then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;

  if new.tipo = 'aberta' then
    select min(e.ordem) into v_limite
      from public.etapas_funil e
     where e.funil_id = new.funil_id
       and e.tipo in ('ganha', 'perdida');

    if v_limite is not null and new.ordem >= v_limite then
      raise exception 'Etapas abertas ficam antes das etapas de fechamento do funil.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.ativo and not new.ativo
     and exists (select 1 from public.negociacoes n where n.etapa_id = new.id)
  then
    raise exception 'Mova as negociações da etapa "%" antes de desativá-la.', new.nome
      using errcode = '23514';
  end if;

  return new;
end;
$$;
