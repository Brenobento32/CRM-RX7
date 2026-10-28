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

export const IconeConversas = (p: Props) => (
  <Svg {...p}>
    <path d="M4 5.5h16v10H9l-5 4v-14Z" />
    <path d="M8 9.5h8M8 12.5h5" />
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

/** CRM — agrupa funil, métricas, leads e as configurações do funil. */
export const IconeCrm = (p: Props) => (
  <Svg {...p}>
    <path d="M3 5h18l-7 8v5l-4 2v-7z" />
  </Svg>
)

/** Kanban — colunas do funil. */
export const IconeKanban = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
  </Svg>
)

/** Métricas — tendência. */
export const IconeMetricas = (p: Props) => (
  <Svg {...p}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Svg>
)

/** Leads — caixa de entrada. */
export const IconeLeads = (p: Props) => (
  <Svg {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
  </Svg>
)

/** Etapas — lista ordenada. */
export const IconeEtapas = (p: Props) => (
  <Svg {...p}>
    <path d="M10 6h11M10 12h11M10 18h11" />
    <path d="M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </Svg>
)

/** Nichos — etiqueta. */
export const IconeNichos = (p: Props) => (
  <Svg {...p}>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </Svg>
)

/** Serviços — maleta. */
export const IconeServicos = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
  </Svg>
)

/** Propostas abertas — documento com relógio. */
export const IconeAbertas = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)

/** Propostas fechadas — confirmação. */
export const IconeFechadas = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </Svg>
)

/** Vendas — cifrão. */
export const IconeVendas = (p: Props) => (
  <Svg {...p}>
    <path d="M12 2v20" />
    <path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </Svg>
)

/** Conversão — percentual. */
export const IconeConversao = (p: Props) => (
  <Svg {...p}>
    <path d="M19 5 5 19" />
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </Svg>
)

/** Exportação — download. */
export const IconeExportacao = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </Svg>
)

/** Dados da empresa — prédio. */
export const IconeEmpresa = (p: Props) => (
  <Svg {...p}>
    <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20" />
    <path d="M8 7h4M8 11h4M8 15h4" />
  </Svg>
)

/** Integrações — conector. */
export const IconeIntegracoes = (p: Props) => (
  <Svg {...p}>
    <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z" />
    <path d="M12 18v4" />
  </Svg>
)

/** Assinatura — cartão. */
export const IconeAssinatura = (p: Props) => (
  <Svg {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20M6 15h4" />
  </Svg>
)
