/**
 * Preferência "tema claro/escuro" do AVANTE, guardada em cookie (não em
 * localStorage): o script do `<head>` (app/layout.tsx) lê o cookie e põe
 * `data-tema` no <html> antes de pintar, então a tela não "pisca" no tema
 * errado e a escolha vale em todas as páginas e recarregamentos.
 */
export const COOKIE_TEMA = 'scorpion_tema'
export const TEMA_CLARO = 'claro'
export const TEMA_ESCURO = 'escuro'

/** Um ano. */
export const COOKIE_TEMA_MAX_AGE = 60 * 60 * 24 * 365

/** Aplica e grava o tema (chamado pelo interruptor "Modo escuro"). */
export function aplicarTema(claro: boolean) {
  const tema = claro ? TEMA_CLARO : TEMA_ESCURO
  document.documentElement.setAttribute('data-tema', tema)
  document.cookie = `${COOKIE_TEMA}=${tema}; path=/; max-age=${COOKIE_TEMA_MAX_AGE}; samesite=lax`
}
