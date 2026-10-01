/**
 * Extrai o telefone (só dígitos) de um JID individual do WhatsApp.
 * Ignora grupos (`@g.us`), broadcast/status e qualquer JID que não seja de
 * conversa 1:1 — fase 1 não trata mensagem de grupo.
 */
export function telefoneDoJid(jid: string | undefined | null): string | null {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null
  const digitos = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
  return digitos.length >= 10 ? digitos : null
}

/**
 * O WhatsApp sempre inclui o DDI (55 no Brasil); o cadastro do CRM às vezes
 * foi digitado sem ele. Gera as variações plausíveis para casar com
 * `clientes.telefone`/`clientes.whatsapp` — nunca um telefone diferente.
 */
export function candidatosTelefone(digitos: string): string[] {
  const candidatos = new Set([digitos])
  if (digitos.startsWith('55') && digitos.length > 11) candidatos.add(digitos.slice(2))
  return [...candidatos]
}
