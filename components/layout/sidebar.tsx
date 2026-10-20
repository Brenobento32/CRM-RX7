import type { UsuarioAtual } from '@/lib/dal/auth'

import { BotaoRecolherSidebar } from './shell-app'
import { SidebarNav } from './sidebar-nav'

/**
 * Conteúdo da sidebar. A largura e o `<aside>` ficam no ShellApp; aqui cada
 * texto some com a sidebar recolhida — `sr-only` onde precisa continuar
 * acessível, `hidden` onde é só decoração.
 *
 * Sem card de usuário no rodapé (removido — ver referência visual): nome,
 * avatar e "Sair" agora vivem só na topbar (`components/layout/topbar.tsx`),
 * pra não duplicar a mesma informação em dois lugares da tela. O rodapé
 * daqui guarda só a ação de recolher/expandir o menu.
 */
export function Sidebar({ usuario }: { usuario: UsuarioAtual }) {
  return (
    <>
      <div className="flex h-16 items-center gap-2.5 border-b border-premium-borda px-4 group-data-[sidebar=recolhida]/shell:justify-center group-data-[sidebar=recolhida]/shell:px-0">
        <LogoScorpion />
        <span className="truncate text-base font-semibold tracking-tight text-premium-texto group-data-[sidebar=recolhida]/shell:hidden">
          Scorpion CRM
        </span>
      </div>

      <SidebarNav papel={usuario.role} />

      <div className="border-t border-premium-borda p-3">
        <BotaoRecolherSidebar variant="linha" />
      </div>
    </>
  )
}

/**
 * Marca simples — quadrado com a cor de destaque + "S" (nenhum logo-arquivo
 * da Scorpion existe no repositório hoje). Decorativo. Usa `bg-premium-acento`
 * (nunca uma cor literal) de propósito: é a mesma variável usada em todo o
 * resto do design system — no dia em que a cor de destaque virar configurável
 * por RGB da marca/logo (ver `app/globals.css`), a logo já muda junto, sem
 * precisar editar este arquivo.
 */
function LogoScorpion() {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-premium-acento text-sm font-bold text-zinc-950"
    >
      S
    </span>
  )
}
