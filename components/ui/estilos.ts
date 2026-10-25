/**
 * Classes de formulário compartilhadas entre as telas. Usam os tokens do tema
 * (`premium-*`), então seguem o interruptor claro/escuro em qualquer página.
 * Verde (`premium-acento`) é a cor principal de ação nos dois modos.
 */

export const inputClass =
  'w-full rounded-md border border-premium-borda bg-premium-card px-3 py-2 text-sm text-premium-texto outline-none transition placeholder:text-premium-mudo focus:border-premium-acento focus:ring-2 focus:ring-premium-acento/20 aria-invalid:border-red-500 disabled:opacity-60'

export const botaoPrimarioClass =
  'inline-flex items-center justify-center gap-2 rounded-md bg-premium-acento px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-premium-acento disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-950'

export const botaoSecundarioClass =
  'inline-flex items-center justify-center gap-2 rounded-md border border-premium-borda px-3 py-1.5 text-sm text-premium-texto transition hover:bg-premium-elevado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-premium-acento disabled:opacity-60'

/** Cartão padrão (listas, formulários, painéis). */
export const cartaoClass = 'rounded-xl border border-premium-borda bg-premium-card'
