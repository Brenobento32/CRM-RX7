import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'

export type PermissoesFunil = {
  /** Gerente, ou linha explícita de acesso a este funil (`etapa_id is null`). */
  acessoFunil: boolean
  /** Etapas que o usuário pode VER — vazio quando `acessoFunil` é falso. Gerente: todas (`etapaIds` recebido). */
  etapasVisiveis: Set<string>
  /** Etapas que o usuário pode MOVIMENTAR (origem ou destino) — mesma regra. */
  etapasMovimentaveis: Set<string>
}

/**
 * Permissões do usuário ATUAL num funil — para o Kanban decidir quais
 * colunas mostrar e quais destinos aceitar no "Mover para"/drag
 * (`20261014160000_permissoes_colaborador.sql`).
 *
 * Gerente: acesso total, sem consultar a tabela (ele nunca tem linha nela —
 * o trigger `permissoes_colaborador_valida` recusa configurar um gerente).
 *
 * SDR/CLOSER: esta tabela é a ÚNICA fonte de verdade — owner_id não conta
 * pra nada aqui. Sem a linha de acesso ao funil (`etapa_id is null`), as
 * duas listas vêm vazias; com ela, cada etapa só entra se tiver a própria
 * linha com `pode_ver`/`pode_mover` explícitos (acesso ao funil nunca herda
 * pra etapa nenhuma).
 */
export async function obterPermissoesFunil(funilId: string, etapaIds: string[]): Promise<PermissoesFunil> {
  const usuario = await getUsuarioAtual()

  if (usuario.role === 'gerente') {
    const todas = new Set(etapaIds)
    return { acessoFunil: true, etapasVisiveis: todas, etapasMovimentaveis: todas }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('permissoes_colaborador')
    .select('etapa_id, pode_ver, pode_mover')
    .eq('usuario_id', usuario.id)
    .eq('funil_id', funilId)

  if (error) throw new Error('Não foi possível carregar as permissões do funil.', { cause: error })

  const acessoFunil = data.some((p) => p.etapa_id === null)
  if (!acessoFunil) return { acessoFunil: false, etapasVisiveis: new Set(), etapasMovimentaveis: new Set() }

  return {
    acessoFunil: true,
    etapasVisiveis: new Set(data.flatMap((p) => (p.etapa_id && p.pode_ver ? [p.etapa_id] : []))),
    etapasMovimentaveis: new Set(data.flatMap((p) => (p.etapa_id && p.pode_mover ? [p.etapa_id] : []))),
  }
}

// ---------------------------------------------------------------------------
// Configuração — somente gerente. Tela "Configurações -> Usuários -> editar
// -> Permissões comerciais".
// ---------------------------------------------------------------------------

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente administradores configuram permissões comerciais.')
  return usuario
}

/** Uma linha crua de `permissoes_colaborador` — `etapaId === null` = acesso ao funil. */
export type PermissaoColaboradorLinha = {
  funilId: string
  etapaId: string | null
  podeVer: boolean | null
  podeMover: boolean | null
}

/** Todas as permissões de UM colaborador, em todos os funis — pra hidratar a tela de configuração. */
export async function listarPermissoesDoColaborador(usuarioId: string): Promise<PermissaoColaboradorLinha[]> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('permissoes_colaborador')
    .select('funil_id, etapa_id, pode_ver, pode_mover')
    .eq('usuario_id', usuarioId)

  if (error) throw new Error('Não foi possível carregar as permissões do colaborador.', { cause: error })
  return data.map((p) => ({ funilId: p.funil_id, etapaId: p.etapa_id, podeVer: p.pode_ver, podeMover: p.pode_mover }))
}

/** O que a tela manda salvar: o conjunto FINAL e completo de permissões do colaborador (substitui tudo). */
export type ItemPermissao = {
  funilId: string
  etapaId: string | null
  podeVer: boolean | null
  podeMover: boolean | null
}

export type ResultadoPermissoes = { ok: true } | { ok: false; mensagem: string }

/**
 * Substitui TODAS as permissões de `usuarioId` pelo conjunto enviado, numa
 * transação só (`salvar_permissoes_colaborador`, DELETE + INSERT na mesma
 * chamada de função — nunca fica parcialmente salvo). Mandar `[]` remove
 * todas as permissões do colaborador.
 *
 * Não concede nada administrativo: a RLS de `permissoes_colaborador` (só
 * gerente insere/apaga) e os triggers/constraints da tabela (mover exige
 * ver, etapa pertence ao funil, nunca um usuário gerente) continuam sendo a
 * autorização real — esta função só evita a viagem para quem não é gerente
 * e traduz o erro.
 */
export async function salvarPermissoesColaborador(
  usuarioId: string,
  itens: ItemPermissao[],
): Promise<ResultadoPermissoes> {
  await exigirGerente()
  const supabase = await createClient()

  const { error } = await supabase.rpc('salvar_permissoes_colaborador', {
    p_usuario_id: usuarioId,
    p_permissoes: itens.map((i) => ({
      funil_id: i.funilId,
      etapa_id: i.etapaId,
      pode_ver: i.podeVer,
      pode_mover: i.podeMover,
    })),
  })

  if (error) return traduzirErroPermissoes(error)
  return { ok: true }
}

function traduzirErroPermissoes(error: PostgrestError): Extract<ResultadoPermissoes, { ok: false }> {
  switch (error.code) {
    case '23514':
      // Mensagens dos triggers/constraints de permissoes_colaborador já são para o usuário.
      return { ok: false, mensagem: error.message }
    case '42501':
      return { ok: false, mensagem: 'Somente administradores configuram permissões comerciais.' }
    default:
      console.error('Erro ao salvar permissões comerciais', error)
      return { ok: false, mensagem: 'Não foi possível salvar as permissões. Tente novamente.' }
  }
}
