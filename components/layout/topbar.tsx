'use client'

import Link from 'next/link'
import { useEffect, useId, useRef } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { logout } from '@/lib/actions/auth'
import type { UsuarioAtual } from '@/lib/dal/auth'
import { ROTULO_PAPEL } from '@/lib/validations/usuario'

import { IconeConfiguracoes, IconeEditar, IconeLua, IconeSair, IconeSetaBaixo, IconeSino, IconeSol } from './icones'
import { useTemaPremium } from './shell-app'

const LARGURA_MENU = 208

/** Mesmo padrão de `SeletorPeriodoFunil#posicionarSobBotao`: popover `fixed`, ancorado sob o botão, com clamp na borda da tela. */
function posicionarSobBotao(popover: HTMLElement, botao: HTMLElement) {
  const r = botao.getBoundingClientRect()
  popover.style.top = `${r.bottom + 6}px`
  popover.style.left = `${Math.min(r.right - LARGURA_MENU, window.innerWidth - LARGURA_MENU - 8)}px`
}

/**
 * Cluster do usuário logado — sino de notificação, avatar, nome e papel,
 * seta de menu. Mesmo componente em toda página que já tem `usuario`
 * (`getUsuarioAtual()`, que toda página autenticada já chama) — pensado
 * pra virar o cabeçalho padrão, junto de `PageHeaderPremium`.
 *
 * Sem campo de "empresa/unidade" em `UsuarioAtual` (CRM de uma agência só,
 * não multi-tenant): a segunda linha usa o papel (`ROTULO_PAPEL`), o dado
 * real mais próximo disso que já existe — nunca um texto inventado.
 *
 * "Sair" vivia num card no rodapé da sidebar; foi removido de lá (ver
 * `components/layout/sidebar.tsx`) pra não duplicar nome/avatar em dois
 * lugares — agora mora neste menu (Popover API nativa, mesmo padrão de
 * `SeletorPeriodoFunil`), junto de "Configurações", alternância de tema e,
 * só pra gerente, "Editar perfil". O sino é só visual (sem sistema de
 * notificações no CRM hoje) — tem `aria-label` e não finge nenhuma
 * contagem/alerta.
 *
 * "Editar perfil" só aparece pro papel `gerente`: é a única role com acesso
 * à tela de edição de usuário hoje (`/configuracoes/usuarios/[id]/editar`
 * barra `notFound()` pra quem não é gerente — ver o próprio arquivo). SDR e
 * CLOSER não têm autoedição no código atual ("fale com o gerente", já dito
 * em `/configuracoes`) — por isso o item some pra eles, em vez de apontar
 * pra uma rota que devolveria 404.
 */
export function Topbar({ usuario }: { usuario: UsuarioAtual }) {
  const id = useId()
  const botaoRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const tema = useTemaPremium()

  useEffect(() => {
    const popover = popoverRef.current
    const botao = botaoRef.current
    if (!popover || !botao) return

    const fechar = () => popover.hidePopover()
    const aoAlternar = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        posicionarSobBotao(popover, botao)
        window.addEventListener('scroll', fechar, true)
        window.addEventListener('resize', fechar)
      } else {
        window.removeEventListener('scroll', fechar, true)
        window.removeEventListener('resize', fechar)
      }
    }
    popover.addEventListener('toggle', aoAlternar)
    return () => {
      popover.removeEventListener('toggle', aoAlternar)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
    }
  }, [])

  return (
    <div className="flex shrink-0 items-center gap-4">
      <button
        type="button"
        title="Notificações"
        aria-label="Notificações (sem notificações pendentes)"
        className="text-premium-mudo transition hover:text-premium-texto"
      >
        <IconeSino className="size-5" />
      </button>

      <span aria-hidden className="h-6 w-px bg-premium-borda" />

      <button
        ref={botaoRef}
        type="button"
        popoverTarget={`${id}-menu`}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-0.5 transition hover:bg-premium-card"
      >
        <Avatar nome={usuario.nome} fotoUrl={usuario.fotoUrl} tamanho="sm" variant="premium" />
        <span className="min-w-0 text-left leading-tight">
          <span className="block truncate text-sm font-medium text-premium-texto">{usuario.nome}</span>
          <span className="block truncate text-xs text-premium-mudo">{ROTULO_PAPEL[usuario.role]}</span>
        </span>
        <IconeSetaBaixo className="size-4 shrink-0 text-premium-mudo" />
      </button>

      <div
        ref={popoverRef}
        id={`${id}-menu`}
        popover="auto"
        role="menu"
        aria-label="Menu do usuário"
        className="fixed m-0 rounded-lg border border-premium-borda bg-premium-card p-1 text-sm text-premium-texto shadow-lg shadow-black/40"
        style={{ width: LARGURA_MENU, inset: 'auto' }}
      >
        {usuario.role === 'gerente' && (
          <Link
            href={`/configuracoes/usuarios/${usuario.id}/editar`}
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 transition hover:bg-premium-borda"
          >
            <IconeEditar className="size-4 text-premium-mudo" />
            Editar perfil
          </Link>
        )}
        <Link
          href="/configuracoes"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 transition hover:bg-premium-borda"
        >
          <IconeConfiguracoes className="size-4 text-premium-mudo" />
          Configurações
        </Link>

        {tema && (
          <button
            type="button"
            role="menuitem"
            onClick={tema.alternar}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition hover:bg-premium-borda"
          >
            {/* Mostra o destino da troca (pra onde o clique leva), não o estado atual. */}
            {tema.claro ? (
              <IconeLua className="size-4 text-premium-mudo" />
            ) : (
              <IconeSol className="size-4 text-premium-mudo" />
            )}
            {tema.claro ? 'Modo escuro' : 'Modo claro'}
          </button>
        )}

        <span aria-hidden className="my-1 block h-px bg-premium-borda" />

        <form action={logout}>
          <button
            type="submit"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition hover:bg-premium-acento-suave hover:text-premium-acento"
          >
            <IconeSair className="size-4" />
            Sair
          </button>
        </form>
      </div>
    </div>
  )
}
