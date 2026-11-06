/**
 * Oposição do titular à medição de anúncios (Conversões do CRM, LGPD art. 18 § 2º).
 * Os mesmos canais que o banco aceita em `capi_registrar_oposicao`.
 */
export const CANAIS_OPOSICAO = ['email', 'whatsapp', 'telefone', 'presencial', 'outro'] as const
export type CanalOposicao = (typeof CANAIS_OPOSICAO)[number]

export const ROTULO_CANAL_OPOSICAO: Record<CanalOposicao, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  presencial: 'Presencial',
  outro: 'Outro',
}

export const ehCanalOposicao = (v: unknown): v is CanalOposicao =>
  typeof v === 'string' && (CANAIS_OPOSICAO as readonly string[]).includes(v)
