import { caminhoInternoSeguro } from '@/lib/utils/redirect'

/**
 * Dois portais de entrada sobre a MESMA autenticação (um Supabase Auth, os
 * mesmos usuários):
 *
 * - clientes: `/login` → empresa do usuário (Gerente, Vendedor, Atendente, SDR, Closer);
 * - administração: `/admin` → painel global do Super Admin da Rio X7.
 *
 * Estas funções só decidem PARA ONDE mandar alguém. Nenhuma delas autoriza:
 * o privilégio de Super Admin é sempre conferido no banco (`is_super_admin`),
 * e os dados de empresa continuam protegidos por vínculo + RLS.
 */
export type Portal = 'clientes' | 'admin'

export function ehRotaAdmin(caminho: string): boolean {
  const semBusca = caminho.split(/[?#]/)[0]
  return semBusca === '/admin' || semBusca.startsWith('/admin/')
}

/** Retorno depois do login administrativo: só caminhos do painel; o resto vira `/admin`. */
export function destinoAdminSeguro(next: unknown): string {
  const caminho = caminhoInternoSeguro(primeiro(next), '/admin')
  return ehRotaAdmin(caminho) ? caminho : '/admin'
}

/**
 * Retorno depois do login de clientes: qualquer caminho interno, menos o
 * painel administrativo (o portal de clientes nunca leva ao `/admin`).
 */
export function destinoClienteSeguro(next: unknown): string {
  const caminho = caminhoInternoSeguro(primeiro(next), '/')
  return ehRotaAdmin(caminho) ? '/' : caminho
}

export function portalValido(valor: unknown): Portal {
  return primeiro(valor) === 'admin' ? 'admin' : 'clientes'
}

/** Tela de entrada de cada portal (logout, senha redefinida, sessão ausente). */
export function entradaDoPortal(portal: Portal): string {
  return portal === 'admin' ? '/admin' : '/login'
}

function primeiro(valor: unknown): unknown {
  return Array.isArray(valor) ? valor[0] : valor
}
