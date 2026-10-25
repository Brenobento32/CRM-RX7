import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { criarEmpresaAction } from '@/lib/actions/super-admin'

import { Aviso } from '../../_components/aviso'

export const metadata: Metadata = {
  title: 'Nova empresa',
}

type Busca = Promise<Record<string, string | string[] | undefined>>

const secaoClass = 'space-y-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900'
const ajudaClass = 'mt-1 block text-xs text-zinc-500'

/**
 * Onboarding (só Super Admin): cria a empresa, vincula (ou convida) o gerente
 * inicial, monta o funil principal com as etapas padrão, abre a assinatura de
 * teste no Starter e grava o cadastro (contato, responsável, logo). Repetir
 * com o mesmo endereço não duplica nada.
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

      <form action={criarEmpresaAction} className="space-y-4">
        <fieldset className={secaoClass}>
          <legend className="sr-only">Empresa</legend>
          <h2 className="font-semibold">Empresa</h2>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Nome comercial</span>
            <input name="nome" required maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Endereço da empresa</span>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-sm text-zinc-500">avante.riox7comunicacao.com.br/</span>
              <input
                name="slug"
                required
                maxLength={63}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="minha-empresa"
                className={inputClass}
              />
            </div>
            <span className={ajudaClass}>
              Letras minúsculas, números e hífens. Nomes do sistema (agenda, login, admin…) não podem ser usados.
              Trocar depois só pelo Super Admin, com registro.
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Telefone (opcional)</span>
              <input name="telefone" inputMode="tel" placeholder="(11) 99999-9999" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">E-mail da empresa (opcional)</span>
              <input name="email" type="email" className={inputClass} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Nome do responsável (opcional)</span>
            <input name="responsavel_nome" maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Logotipo (opcional)</span>
            <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm" />
            <span className={ajudaClass}>PNG, JPG ou WebP, até 2 MB. Aparece no menu da empresa.</span>
          </label>
        </fieldset>

        <fieldset className={secaoClass}>
          <legend className="sr-only">Gerente inicial</legend>
          <h2 className="font-semibold">Gerente inicial</h2>
          <p className="text-xs text-zinc-500">
            Administra só esta empresa: cadastra os usuários dela e configura integrações. Nunca vê outras empresas.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block">Nome</span>
            <input name="admin_nome" required maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">E-mail</span>
            <input name="admin_email" type="email" required className={inputClass} />
            <span className={ajudaClass}>Se o e-mail já tiver conta, ela é reaproveitada (só ganha o vínculo).</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Senha inicial (opcional)</span>
            <input name="admin_senha" type="password" minLength={8} autoComplete="new-password" className={inputClass} />
            <span className={ajudaClass}>Vazio: o gerente recebe convite por e-mail para criar a senha.</span>
          </label>
        </fieldset>

        <button type="submit" className={botaoPrimarioClass}>
          Criar empresa
        </button>
      </form>
    </div>
  )
}
