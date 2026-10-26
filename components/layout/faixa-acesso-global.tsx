import { botaoCompactoClass } from '@/components/ui/estilos'
import { encerrarAcessoEmpresaAction } from '@/lib/actions/super-admin'

/**
 * Contexto explícito do acesso global: o Super Admin está no CRM desta
 * empresa pelo painel (janela auditada), como Administrador, sem vínculo.
 * Encerrar fecha a janela no banco e volta ao painel.
 */
export function FaixaAcessoGlobal({ empresa }: { empresa: string }) {
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-600/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
    >
      <p className="min-w-0">
        <span className="font-semibold">Acesso global de Super Admin</span> ao CRM de <span className="font-semibold">{empresa}</span>, como
        Administrador. Ações registradas na auditoria.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- voltar ao painel recarrega fora da empresa */}
        <a href="/admin" className={botaoCompactoClass}>
          Voltar ao painel
        </a>
        <form action={encerrarAcessoEmpresaAction}>
          <button type="submit" className={botaoCompactoClass}>
            Encerrar acesso
          </button>
        </form>
      </div>
    </div>
  )
}
