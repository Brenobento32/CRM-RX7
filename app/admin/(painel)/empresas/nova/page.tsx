import type { Metadata } from 'next'

import { botaoPrimarioClass, inputClass, arquivoClass, cartaoClass, labelClass, legendaClass } from '@/components/ui/estilos'
import { criarEmpresaAction } from '@/lib/actions/super-admin'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

import { Aviso } from '@/app/admin/_components/aviso'

export const metadata: Metadata = {
  title: 'Nova empresa',
}

type Busca = Promise<Record<string, string | string[] | undefined>>

const secaoClass = `${cartaoClass} space-y-4 p-5`
const ajudaClass = 'mt-1.5 block text-xs text-premium-mudo'

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
      <PageHeaderPremium titulo="Nova empresa" voltar={{ href: '/admin', rotulo: 'Empresas' }} />

      <Aviso ok={params.ok} erro={params.erro} />

      <form action={criarEmpresaAction} className="space-y-4">
        <fieldset className={secaoClass}>
          <legend className="sr-only">Empresa</legend>
          <h2 className={legendaClass}>Empresa</h2>
          <label className="block text-sm">
            <span className={labelClass}>Nome comercial</span>
            <input name="nome" required maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className={labelClass}>Endereço da empresa</span>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-sm text-premium-mudo">avante.riox7comunicacao.com.br/</span>
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
              Letras minúsculas, números e hífens. Nomes do sistema (agenda, login, admin…) não podem ser usados. Trocar depois só pelo
              Super Admin, com registro.
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className={labelClass}>Telefone (opcional)</span>
              <input name="telefone" inputMode="tel" placeholder="(11) 99999-9999" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className={labelClass}>E-mail da empresa (opcional)</span>
              <input name="email" type="email" className={inputClass} />
            </label>
          </div>
          <label className="block text-sm">
            <span className={labelClass}>Nome do responsável (opcional)</span>
            <input name="responsavel_nome" maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className={labelClass}>Logotipo (opcional)</span>
            <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className={arquivoClass} />
            <span className={ajudaClass}>PNG, JPG ou WebP, até 2 MB. Aparece no menu da empresa.</span>
          </label>
        </fieldset>

        <fieldset className={secaoClass}>
          <legend className="sr-only">Administrador inicial</legend>
          <h2 className={legendaClass}>Administrador inicial</h2>
          <p className="text-xs text-premium-mudo">
            Administra só esta empresa: cadastra os usuários dela e configura integrações. Nunca vê outras empresas.
          </p>
          <label className="block text-sm">
            <span className={labelClass}>Nome</span>
            <input name="admin_nome" required maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className={labelClass}>E-mail</span>
            <input name="admin_email" type="email" required className={inputClass} />
            <span className={ajudaClass}>Se o e-mail já tiver conta, ela é reaproveitada (só ganha o vínculo).</span>
          </label>
          <label className="block text-sm">
            <span className={labelClass}>Senha inicial (opcional)</span>
            <input name="admin_senha" type="password" minLength={8} autoComplete="new-password" className={inputClass} />
            <span className={ajudaClass}>Vazio: o administrador recebe convite por e-mail para criar a senha.</span>
          </label>
        </fieldset>

        <div className="flex justify-end">
          <button type="submit" className={botaoPrimarioClass}>
            Criar empresa
          </button>
        </div>
      </form>
    </div>
  )
}
