import type { CartaoCentral } from '@/lib/integracoes/central'

/** Ícones simples de cada integração (só identificação visual; não são as marcas oficiais completas). */
export function LogoIntegracao({ integracao, className = 'size-10' }: { integracao: CartaoCentral; className?: string }) {
  const caixa = `${className} shrink-0 rounded-xl p-2`
  switch (integracao) {
    case 'google_sheets':
      return (
        <span aria-hidden className={`${caixa} bg-[#0f9d58]/12`}>
          <svg viewBox="0 0 24 24" className="size-full">
            <path fill="#0f9d58" d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
            <path fill="#87ceac" d="M14 2v5h5Z" />
            <path fill="#fff" d="M7.5 10.5h9v7h-9Zm1.2 1.2v1.7h2.7v-1.7Zm3.9 0v1.7h2.7v-1.7Zm-3.9 2.9v1.7h2.7v-1.7Zm3.9 0v1.7h2.7v-1.7Z" />
          </svg>
        </span>
      )
    case 'whatsapp_app':
      return (
        <span aria-hidden className={`${caixa} bg-[#25d366]/12`}>
          <svg viewBox="0 0 24 24" className="size-full" fill="none" stroke="#128c7e" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
            <path d="M10.5 18.5h3" />
            <path d="M12 6.5a3.5 3.5 0 0 0-3 5.3L8.5 13.5l1.8-.5A3.5 3.5 0 1 0 12 6.5Z" fill="#25d366" stroke="#25d366" />
          </svg>
        </span>
      )
    case 'whatsapp_oficial':
      return (
        <span aria-hidden className={`${caixa} bg-[#25d366]/12`}>
          <svg viewBox="0 0 24 24" className="size-full">
            <path fill="#25d366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
            <path fill="#fff" d="M16.9 14.2c-.3-.1-1.6-.8-1.8-.9-.3-.1-.4-.1-.6.1l-.8 1c-.2.2-.3.2-.6.1a6.8 6.8 0 0 1-3.4-3c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.6-.6 1.8-1.3.2-.6.2-1.1.2-1.3l-.8-.3Z" />
          </svg>
        </span>
      )
    case 'meta_conversoes':
      return (
        <span aria-hidden className={`${caixa} bg-[#0866ff]/12`}>
          <svg viewBox="0 0 24 24" className="size-full" fill="none" stroke="#0866ff" strokeWidth={2.2} strokeLinecap="round">
            <path d="M3 15.5c0-4.2 2.1-8 4.6-8 3.4 0 5.4 9 8.8 9 1.7 0 2.6-1.5 2.6-3.6 0-3.6-2-7.4-4.6-7.4-2.5 0-4.4 4-6.8 8.2-1.3 2.3-2.4 2.8-3.4 2.8C3.6 16.5 3 16.1 3 15.5Z" />
          </svg>
        </span>
      )
    default:
      return (
        <span aria-hidden className={`${caixa} bg-premium-acento/12`}>
          <svg viewBox="0 0 24 24" className="size-full text-premium-acento" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 8h8M8 12h8M8 16h5" />
          </svg>
        </span>
      )
  }
}
