import type { UsuarioAtual } from '@/lib/dal/auth'
import type { EmpresaAtual } from '@/lib/dal/empresa'

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
export function Sidebar({
  usuario,
  empresa,
  superAdmin = false,
}: {
  usuario: UsuarioAtual
  empresa: EmpresaAtual
  /** Só o Super Admin da Rio X7 troca de empresa pelo menu; contratantes nem veem o link. */
  superAdmin?: boolean
}) {
  return (
    <>
      {/* Mesma altura do cabeçalho (h-14): as duas bordas inferiores formam uma linha só. */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-premium-borda bg-premium-topo px-4 group-data-[sidebar=recolhida]/shell:justify-center group-data-[sidebar=recolhida]/shell:px-0">
        <LogoMarca />
        <span className="truncate text-base font-semibold tracking-tight text-premium-texto group-data-[sidebar=recolhida]/shell:hidden">
          AVANTE
        </span>
      </div>

      {/* Empresa ativa desta aba. Trocar é navegação completa (outra empresa,
          outra árvore de dados), por isso <a> e não <Link>. */}
      <div className="flex items-center gap-2.5 border-b border-premium-borda px-4 py-2.5 group-data-[sidebar=recolhida]/shell:hidden">
        {empresa.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- logo público do Storage, tamanho fixo
          <img
            src={empresa.logoUrl}
            alt=""
            className="size-8 shrink-0 rounded-md border border-premium-borda bg-white object-contain p-0.5"
          />
        )}
        <div className="min-w-0">
        <p className="truncate text-xs font-medium text-premium-texto" title={empresa.nome}>
          {empresa.nome}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-premium-mudo">
          {empresa.somenteLeitura ? <span>Somente leitura</span> : null}
          {superAdmin && (
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- troca de empresa recarrega tudo de propósito
            <a href="/empresas" className="underline-offset-2 hover:underline">
              Trocar empresa
            </a>
          )}
        </div>
        </div>
      </div>

      <SidebarNav papel={usuario.role} />

      <div className="border-t border-premium-borda p-3">
        <BotaoRecolherSidebar variant="linha" />
      </div>
    </>
  )
}

/**
 * Marca simples — quadrado com a cor de destaque + "A" de AVANTE (nenhum logo-arquivo
 * existe no repositório hoje). Decorativo. Usa `bg-premium-acento`
 * (nunca uma cor literal) de propósito: é a mesma variável usada em todo o
 * resto do design system — no dia em que a cor de destaque virar configurável
 * por RGB da marca/logo (ver `app/globals.css`), a logo já muda junto, sem
 * precisar editar este arquivo.
 */
function LogoMarca() {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-premium-acento text-sm font-bold text-premium-acento-texto"
    >
      A
    </span>
  )
}
