/**
 * State do OAuth assinado (HMAC-SHA256) com a empresa que iniciou.
 *
 * `base64url(JSON {n: nonce, t: tenant_id}) + "." + base64url(assinatura)`.
 * A assinatura só prova que o state saiu desta Edge Function; quem decide a
 * empresa no retorno é o estado gravado no banco (uso único, 10 min), e a
 * empresa do state precisa bater com ele.
 *
 * Puro (Web Crypto): roda no Deno (Edge Function) e no Node (testes).
 */

export type DadosEstado = { n: string; t: string }

const codificador = new TextEncoder()

function paraBase64Url(bytes: Uint8Array): string {
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function deBase64Url(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(texto)) return null
  try {
    const normal = texto.replaceAll('-', '+').replaceAll('_', '/')
    const binario = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4))
    return Uint8Array.from(binario, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function chave(segredo: string) {
  if (segredo.length < 32) throw new Error('Segredo do state OAuth curto demais (mínimo 32 caracteres).')
  return crypto.subtle.importKey('raw', codificador.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function assinarEstado(segredo: string, dados: DadosEstado): Promise<string> {
  const corpo = paraBase64Url(codificador.encode(JSON.stringify({ n: dados.n, t: dados.t })))
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', await chave(segredo), codificador.encode(corpo)))
  return `${corpo}.${paraBase64Url(assinatura)}`
}

/** Devolve os dados só se a assinatura conferir; qualquer outra coisa → null. */
export async function verificarEstado(segredo: string, state: string): Promise<DadosEstado | null> {
  const partes = state.split('.')
  if (partes.length !== 2 || partes[0].length > 512) return null
  const assinatura = deBase64Url(partes[1])
  const corpo = deBase64Url(partes[0])
  if (!assinatura || !corpo) return null

  // verify do Web Crypto compara em tempo constante.
  const valido = await crypto.subtle.verify('HMAC', await chave(segredo), assinatura, codificador.encode(partes[0]))
  if (!valido) return null

  try {
    const dados = JSON.parse(new TextDecoder().decode(corpo)) as Partial<DadosEstado>
    if (typeof dados.n !== 'string' || !/^[0-9a-f]{64}$/.test(dados.n)) return null
    if (typeof dados.t !== 'string' || !/^[0-9a-f-]{36}$/.test(dados.t)) return null
    return { n: dados.n, t: dados.t }
  } catch {
    return null
  }
}
