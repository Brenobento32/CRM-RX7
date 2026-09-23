/**
 * Preferência "sidebar recolhida", guardada em cookie (e não em
 * localStorage) para o servidor já renderizar a largura certa — sem a
 * sidebar "pular" depois de carregar.
 */
export const COOKIE_SIDEBAR = 'scorpion_sidebar'
export const SIDEBAR_RECOLHIDA = 'recolhida'

/** Um ano. */
export const COOKIE_SIDEBAR_MAX_AGE = 60 * 60 * 24 * 365
