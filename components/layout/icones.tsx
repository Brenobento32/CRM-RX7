/**
 * Ícones da navegação, em SVG inline (traço de 2px, 24×24). Decorativos:
 * o texto ao lado — visível ou `sr-only` com a sidebar recolhida — é quem
 * nomeia o item para leitores de tela.
 */

type Props = { className?: string }

function Svg({ className = 'size-5', children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  )
}

export const IconeInicio = (p: Props) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9v11h14V9" />
    <path d="M10 20v-6h4v6" />
  </Svg>
)

export const IconeAgenda = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </Svg>
)

export const IconeFunil = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="5" height="18" rx="1.5" />
    <rect x="10" y="3" width="5" height="12" rx="1.5" />
    <rect x="17" y="3" width="4" height="7" rx="1.5" />
  </Svg>
)

export const IconeClientes = (p: Props) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.6 3 5.2" />
  </Svg>
)

export const IconeRelatorios = (p: Props) => (
  <Svg {...p}>
    <path d="M3 3v18h18" />
    <path d="M7 16v-4M12 16V8M17 16v-7" />
  </Svg>
)

export const IconeConfiguracoes = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </Svg>
)

export const IconeSair = (p: Props) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </Svg>
)

/** Painel lateral com a seta indicando a direção do movimento. */
export const IconeRecolher = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M16 9l-3 3 3 3" />
  </Svg>
)

export const IconeExpandir = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M13 9l3 3-3 3" />
  </Svg>
)

export const IconeMetas = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </Svg>
)

export const IconePropostas = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
)

/** Seta de submenu: aponta para a direita; gira 90° quando aberto. */
export const IconeSeta = (p: Props) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
)

/** Sino de notificação — decorativo (sem backend de notificações hoje). */
export const IconeSino = (p: Props) => (
  <Svg {...p}>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Svg>
)

/** Seta pequena para baixo — dropdown do usuário, conectores do funil. */
export const IconeSetaBaixo = (p: Props) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

/** Sol — alternância de tema, estado "modo claro". */
export const IconeSol = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </Svg>
)

/** Lua — alternância de tema, estado "modo escuro". */
export const IconeLua = (p: Props) => (
  <Svg {...p}>
    <path d="M20.8 14.5A8.5 8.5 0 1 1 9.5 3.2a7 7 0 0 0 11.3 11.3Z" />
  </Svg>
)

/** Lápis — "Editar perfil" no menu do usuário (mesmo traço do botão "Editar proposta" do card do Kanban). */
export const IconeEditar = (p: Props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={`shrink-0 ${p.className ?? 'size-5'}`}>
    <path d="M16.862 4.487a1.875 1.875 0 1 1 2.652 2.652L7.5 19.153l-4.243 1.06 1.06-4.242 12.545-12.484Z" />
  </svg>
)
