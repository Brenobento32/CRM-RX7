import 'server-only'

import { connection } from 'next/server'
import { cache } from 'react'

import { createPublicClient } from '@/lib/supabase/publico'

/**
 * Identidade GLOBAL do AVANTE CRM (a marca da plataforma, não a da empresa
 * cliente): logo para fundo claro e logo para fundo escuro, trocadas só pelo
 * Super Admin em /admin/identidade.
 *
 * Fallback previsível, por variante: sem logo configurado (ou se o banco não
 * responder), vale a logo OFICIAL embutida da MESMA variante — nunca a do
 * outro tema (uma logo branca some no fundo claro, e vice-versa).
 */
export const BUCKET_MARCA = 'plataforma-marca'

export const LOGO_OFICIAL = {
  claro: '/marca/avante-crm-claro.png',
  escuro: '/marca/avante-crm-escuro.png',
} as const

/** Emblema (menu recolhido e telas pequenas): sempre o oficial. */
export const ICONE_OFICIAL = {
  claro: '/marca/avante-icone-claro.png',
  escuro: '/marca/avante-icone-escuro.png',
} as const

export type VarianteLogo = keyof typeof LOGO_OFICIAL

export type IdentidadeAvante = {
  /** URL a exibir em cada tema (personalizada ou a oficial). */
  claro: string
  escuro: string
  /** URL da logo personalizada, se houver (nulo = usando a oficial). */
  personalizada: { claro: string | null; escuro: string | null }
}

function urlPublica(caminho: string | null, versao: string): string | null {
  if (!caminho) return null
  const { data } = createPublicClient().storage.from(BUCKET_MARCA).getPublicUrl(caminho)
  return `${data.publicUrl}?v=${encodeURIComponent(versao)}`
}

/** Leitura pública (login inclusive, sem sessão) via `identidade_plataforma()`. */
export const obterIdentidadeAvante = cache(async (): Promise<IdentidadeAvante> => {
  // Sempre na hora do pedido: uma página estática congelaria a logo do build
  // (troca feita pelo Super Admin não apareceria até o próximo deploy).
  await connection()
  const { data, error } = await createPublicClient().rpc('identidade_plataforma')
  const linha = error ? null : (data?.[0] ?? null)
  if (error) console.error('identidade_plataforma', error.code)
  const claro = urlPublica(linha?.logo_claro_path ?? null, linha?.atualizado_em ?? '')
  const escuro = urlPublica(linha?.logo_escuro_path ?? null, linha?.atualizado_em ?? '')
  return {
    claro: claro ?? LOGO_OFICIAL.claro,
    escuro: escuro ?? LOGO_OFICIAL.escuro,
    personalizada: { claro, escuro },
  }
})
