'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { salvarPermissoesColaborador, type ItemPermissao } from '@/lib/dal/permissoes'
import { permissoesColaboradorSchema } from '@/lib/validations/permissao'

export type EstadoPermissoes = { erro?: string; sucesso?: boolean }

/**
 * Grava a tela "Permissões comerciais" (Configurações -> Usuários -> editar)
 * — chamada direta do client (não é `<form action>` com FormData, porque os
 * dados são uma grade de checkboxes por funil/etapa, não um formulário
 * plano). `itens` é o conjunto FINAL e completo: a Server Action substitui
 * tudo numa transação só (`salvar_permissoes_colaborador`).
 */
export async function salvarPermissoesColaboradorAction(
  usuarioId: string,
  itens: ItemPermissao[],
): Promise<EstadoPermissoes> {
  if (!z.uuid().safeParse(usuarioId).success) return { erro: 'Usuário inválido.' }

  const parsed = permissoesColaboradorSchema.safeParse(itens)
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados de permissão inválidos.' }
  }

  const resultado = await salvarPermissoesColaborador(usuarioId, parsed.data)
  if (!resultado.ok) return { erro: resultado.mensagem }

  revalidatePath(`/configuracoes/usuarios/${usuarioId}/editar`)
  revalidatePath('/funil')
  return { sucesso: true }
}
