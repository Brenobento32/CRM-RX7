'use client'

import { createContext, useContext } from 'react'

/** Empresa da aba, vinda do servidor (já conferida no banco). Só identifica; não autoriza. */
export type EmpresaDaAba = { id: string; slug: string }

const Contexto = createContext<EmpresaDaAba | null>(null)

export function EmpresaAtualProvider({ empresa, children }: { empresa: EmpresaDaAba; children: React.ReactNode }) {
  return <Contexto.Provider value={empresa}>{children}</Contexto.Provider>
}

export function useEmpresaAtual(): EmpresaDaAba {
  const empresa = useContext(Contexto)
  if (!empresa) throw new Error('useEmpresaAtual fora da área interna.')
  return empresa
}

/** Canal privado do Realtime de uma conversa (mesmo formato de `public.topico_conversa`). */
export function topicoConversa(tenantId: string, conversaId: string): string {
  return `empresa:${tenantId}:conversa:${conversaId}`
}
