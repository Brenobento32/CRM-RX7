'use client'

import { usePathname } from 'next/navigation'

import { separarPrefixo } from '@/lib/empresa/rota'

/** Caminho sem o prefixo `/<slug>` — para comparar com as rotas do menu. */
export function useRotaInterna(): string {
  const pathname = usePathname()
  return separarPrefixo(pathname)?.resto ?? pathname
}
