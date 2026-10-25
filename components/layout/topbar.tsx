'use client'

import Link from 'next/link'
import { useEffect, useId, useRef } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { logout } from '@/lib/actions/auth'
import type { UsuarioAtual } from '@/lib/dal/auth'
import { ROTULO_PAPEL } from '@/lib/validations/usuario'

import { IconeEditar, IconeLua, IconeSair, IconeSetaBaixo, IconeSino, IconeSol } from './icones'
import { useTemaPremium } from './shell-app'

const LARGURA_MENU = 208

/** Mesmo padrão de `SeletorPeriodoFunil#posicionarSobBotao`: popover `fixed`, ancorado sob o botão, com clamp na borda da tela. */
function posicionarSobBotao(popover: HTMLElement, botao: HTMLElement) {
  const r = botao.getBoundingClientRect()
  popover.style.top = `${r.bottom + 6}px`
  popover.style.left = `${Math.min(r.right - LARGURA_MENU, window.innerWidth - LARGURA_MENU - 8)}px`
}

/**
 * Cabeçalho global do usuário logado (renderizado pela casca em TODA página
 * autenticada): sino, avatar, nome e papel, e o menu do perfil com
 * "Editar perfil" (`/perfil`, o próprio usuário), o interruptor "Modo
 * escuro" e "Sair". O sino ainda é só visual (não há notificações no CRM) —
 * tem `aria-label` e não finge contagem.
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
        <Link
          href="/perfil"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 transition hover:bg-premium-borda"
        >
          <IconeEditar className="size-4 text-premium-mudo" />
          Editar perfil
        </Link>

        {tema && (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={!tema.claro}
            onClick={tema.alternar}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition hover:bg-premium-borda"
          >
            {tema.claro ? <IconeSol className="size-4 text-premium-mudo" /> : <IconeLua className="size-4 text-premium-mudo" />}
            <span className="flex-1">Modo escuro</span>
            {/* Interruptor: ligado = escuro. */}
            <span
              aria-hidden
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                tema.claro ? 'bg-premium-borda' : 'bg-premium-acento'
              }`}
            >
              <span
                className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
                  tema.claro ? 'translate-x-0.5' : 'translate-x-[18px]'
                }`}
              />
            </span>
            <span className="sr-only">{tema.claro ? 'desligado' : 'ligado'}</span>
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
