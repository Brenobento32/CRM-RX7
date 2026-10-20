/**
 * Preferência "tema claro/escuro" do design system premium, guardada em
 * cookie (não em localStorage) pelo mesmo motivo do `preferencia-sidebar.ts`:
 * o servidor já renderiza o atributo certo (`data-theme`) sem a tela "piscar"
 * no tema errado ao carregar.
 */
export const COOKIE_TEMA = 'scorpion_tema'
export const TEMA_CLARO = 'claro'

/** Um ano. */
export const COOKIE_TEMA_MAX_AGE = 60 * 60 * 24 * 365
