import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { criarEmpresaAction } from '@/lib/actions/super-admin'

import { Aviso } from '../../_components/aviso'

export const metadata: Metadata = {
  title: 'Nova empresa',
}

type Busca = Promise<Record<string, string | string[] | undefined>>

/**
 * Onboarding: cria a empresa, vincula (ou convida) o administrador, monta o
 * funil principal com as etapas padrão e abre a assinatura de teste no
 * Starter. Repetir com o mesmo identificador não duplica nada.
 */
export default async function NovaEmpresaPage({ searchParams }: { searchParams: Busca }) {
  const params = await searchParams

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <Link href="/admin" className="text-sm text-zinc-500 hover:underline">
          ← Empresas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nova empresa</h1>
      </div>

      <Aviso ok={params.ok} erro={params.erro} />

      <form action={criarEmpresaAction} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nome da empresa</span>
          <input name="nome" required maxLength={120} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Identificador na URL</span>
          <input name="slug" required maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="minha-empresa" className={inputClass} />
          <span className="mt-1 block text-xs text-zinc-500">Vira /e/minha-empresa. Não muda depois.</span>
        </label>
        <fieldset className="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <legend className="text-sm font-medium">Administrador da empresa</legend>
          <label className="block text-sm">
            <span className="mb-1 block">Nome</span>
            <input name="admin_nome" required maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">E-mail</span>
            <input name="admin_email" type="email" required className={inputClass} />
            <span className="mt-1 block text-xs text-zinc-500">Se o e-mail já tiver conta, ela é reaproveitada.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Senha inicial (opcional)</span>
            <input name="admin_senha" type="password" minLength={8} autoComplete="new-password" className={inputClass} />
            <span className="mt-1 block text-xs text-zinc-500">Vazio: o administrador recebe convite por e-mail.</span>
          </label>
        </fieldset>
        <button type="submit" className={botaoPrimarioClass}>
          Criar empresa
        </button>
      </form>
    </div>
  )
}
