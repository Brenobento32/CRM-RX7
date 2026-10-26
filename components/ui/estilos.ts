/**
 * AVANTE — Precision Green. Classes compartilhadas de formulário, botão,
 * tabela e cartão. Usam só tokens do tema (`premium-*`), então seguem o
 * claro/escuro em qualquer página. Verde = ação principal (uma por tela);
 * vermelho = ação destrutiva, sempre com confirmação.
 *
 * Regra: telas não inventam estilos próprios para estes papéis — usam estas
 * classes ou os componentes de `components/ui/*`.
 */

/** Campo de texto, select e textarea. `aria-invalid` pinta a borda de vermelho. */
export const inputClass =
  'w-full rounded-lg border border-premium-borda bg-premium-card px-3 py-2 text-sm text-premium-texto shadow-premium outline-none transition placeholder:text-premium-mudo hover:border-premium-mudo/60 focus:border-premium-acento focus:ring-3 focus:ring-premium-acento/20 aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/20 disabled:cursor-not-allowed disabled:opacity-60'

/** Campo de arquivo (`<input type="file">`): botão no padrão AVANTE, nome do arquivo ao lado. */
export const arquivoClass =
  'block w-full text-sm text-premium-secundario file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-premium-borda file:bg-premium-card file:px-3.5 file:text-sm file:font-medium file:text-premium-texto file:transition hover:file:bg-premium-bg'

/** Rótulo de campo. */
export const labelClass = 'mb-1.5 block text-sm font-medium text-premium-texto'

/** Texto de ajuda/exemplo abaixo do campo. */
export const ajudaClass = 'mt-1.5 text-xs text-premium-mudo'

/** Mensagem de erro do campo (ligue com `aria-describedby`). */
export const erroCampoClass = 'mt-1.5 text-sm font-medium text-red-600 dark:text-red-400'

/**
 * Caixas de retorno em linha (mesmos tons do `<Aviso>`). Para mensagens que
 * já vêm montadas pelo formulário; telas novas preferem `<Aviso>`.
 */
export const caixaErroClass = 'rounded-lg border border-red-600/25 bg-red-600/8 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-200'
export const caixaSucessoClass = 'rounded-lg border border-emerald-600/25 bg-emerald-600/8 px-3.5 py-2.5 text-sm text-emerald-800 dark:text-emerald-200'
export const caixaAlertaClass = 'rounded-lg border border-amber-600/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-200'

/** Título de um grupo de campos (`<legend>`/`<h2>` dentro do formulário). */
export const legendaClass = 'text-[15px] font-semibold tracking-tight text-premium-texto'

/**
 * Opção selecionável — um `<label>` com radio/checkbox escondido (`sr-only`)
 * dentro. Selecionada = verde AVANTE (borda, fundo suave e texto), visível nos
 * dois temas; o foco do teclado aparece no anel.
 */
export const opcaoClass =
  'flex cursor-pointer items-center gap-2 rounded-lg border border-premium-borda bg-premium-card px-3 py-2 text-sm text-premium-texto transition hover:border-premium-mudo/60 has-checked:border-premium-acento has-checked:bg-premium-acento-suave has-checked:font-medium has-checked:text-premium-acento has-focus-visible:ring-3 has-focus-visible:ring-premium-acento/25 has-disabled:cursor-not-allowed has-disabled:opacity-60'

const botaoBase =
  'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-premium-acento disabled:cursor-not-allowed disabled:opacity-60'

/** Ação principal da tela (uma por página). */
export const botaoPrimarioClass = `${botaoBase} bg-premium-acento px-4 text-premium-acento-texto shadow-premium hover:bg-premium-acento-forte`

/** Ação secundária. */
export const botaoSecundarioClass = `${botaoBase} border border-premium-borda bg-premium-card px-3.5 text-premium-texto shadow-premium hover:border-premium-mudo/60 hover:bg-premium-bg`

/** Ação discreta (cancelar, links de ação em linha). */
export const botaoFantasmaClass = `${botaoBase} px-3.5 text-premium-secundario hover:bg-premium-bg hover:text-premium-texto`

/** Ação destrutiva — sempre atrás de confirmação (`BotaoConfirmar`). */
export const botaoPerigoClass = `${botaoBase} border border-red-600/30 bg-red-600/10 px-3.5 text-red-700 hover:bg-red-600/15 dark:text-red-300`

/** Ação pequena em linha de tabela/lista (editar, mover, remover). */
export const botaoCompactoClass =
  'inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-premium-borda bg-premium-card px-2.5 text-xs font-medium text-premium-texto transition hover:border-premium-mudo/60 hover:bg-premium-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-premium-acento disabled:cursor-not-allowed disabled:opacity-40'

/** Cartão padrão (listas, formulários, painéis). */
export const cartaoClass = 'rounded-xl border border-premium-borda bg-premium-card shadow-premium'

/**
 * Tabelas de dados (NN/g): cabeçalho fixo e discreto, primeira coluna legível,
 * linhas com hover para acompanhar a leitura, números alinhados à direita
 * (`tdNumeroClass`). Envolva com `tabelaCaixaClass` para a borda e a rolagem.
 */
export const tabelaCaixaClass = 'overflow-x-auto rounded-xl border border-premium-borda bg-premium-card shadow-premium'
export const tabelaClass = 'w-full text-left text-sm'
export const theadClass = 'sticky top-0 z-10 border-b border-premium-borda bg-premium-bg/80 text-xs font-medium text-premium-mudo backdrop-blur'
export const thClass = 'px-4 py-2.5 font-medium whitespace-nowrap'
/** Corpo da tabela: divisórias suaves e hover na linha, sem precisar de classe em cada `<tr>`. */
export const tbodyClass = 'divide-y divide-premium-borda-suave [&>tr]:transition-colors [&>tr:hover]:bg-premium-bg/60'
export const linhaClass = 'border-b border-premium-borda-suave last:border-0 transition-colors hover:bg-premium-bg/60'
export const tdClass = 'px-4 py-3 text-premium-texto'
export const tdNumeroClass = 'px-4 py-3 text-right tabular-nums text-premium-texto'

/** Abas/segmentos (filtros curtos, ex.: Ativos · Arquivados). */
export const segmentoClass = 'inline-flex rounded-lg border border-premium-borda bg-premium-bg p-0.5'
export const segmentoItemClass = (ativo: boolean) =>
  `rounded-md px-3 py-1.5 text-sm transition ${ativo ? 'bg-premium-card font-medium text-premium-texto shadow-premium' : 'text-premium-secundario hover:text-premium-texto'}`
