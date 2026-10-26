import type { Metadata } from 'next'

import { CampoLogotipo } from '@/components/empresa/campo-logotipo'
import { botaoPrimarioClass, inputClass, caixaErroClass, caixaSucessoClass, cartaoClass } from '@/components/ui/estilos'
import { salvarDadosEmpresaAction } from '@/lib/actions/empresa-dados'
import { exigirCargo } from '@/lib/dal/auth'
import { obterDadosEmpresa } from '@/lib/dal/empresa-dados'
import { formatarTelefone } from '@/lib/utils/documentos'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

export const metadata: Metadata = {
  title: 'Dados da empresa',
}

/**
 * Gerente: logotipo, telefone, e-mail e responsável da própria empresa. Nome
 * comercial e endereço aparecem só para leitura — quem muda é a Rio X7
 * (Super Admin). O banco recusa qualquer outro campo.
 */
export default async function DadosEmpresaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirCargo(['gerente'])
  const { ok, erro } = await searchParams
  const dados = await obterDadosEmpresa()
  const mensagemOk = typeof ok === 'string' ? ok : undefined
  const mensagemErro = typeof erro === 'string' ? erro : undefined

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeaderPremium titulo="Dados da empresa" voltar={{ href: '/configuracoes', rotulo: 'Configurações' }} />

      {mensagemErro ? (
        <p role="alert" className={caixaErroClass}>
          {mensagemErro}
        </p>
      ) : mensagemOk ? (
        <p role="status" className={caixaSucessoClass}>
          {mensagemOk}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-premium-borda p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-premium-mudo">Nome comercial</p>
          <p className="mt-0.5 font-medium">{dados.nome}</p>
        </div>
        <div>
          <p className="text-premium-mudo">Endereço no sistema</p>
          <p className="mt-0.5 font-medium">/{dados.slug}</p>
        </div>
        <p className="text-xs text-premium-mudo sm:col-span-2">
          Nome, endereço e plano são alterados pela Rio X7. Fale com o suporte se precisar mudar.
        </p>
      </section>

      <form
        action={salvarDadosEmpresaAction}
        className={`${cartaoClass} divide-y divide-premium-borda-suave`}
      >
        <section className="space-y-3 p-5">
          <h2 className="font-semibold">Identidade visual</h2>
          <CampoLogotipo logoUrl={dados.logoUrl} nome={dados.nome} />
        </section>

        <section className="space-y-4 p-5">
          <h2 className="font-semibold">Contato</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Telefone</span>
              <input
                name="telefone"
                inputMode="tel"
                defaultValue={dados.telefone ? formatarTelefone(dados.telefone) : ''}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">E-mail da empresa</span>
              <input name="email" type="email" maxLength={254} defaultValue={dados.email ?? ''} className={inputClass} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Nome do responsável</span>
            <input name="responsavel_nome" maxLength={120} defaultValue={dados.responsavelNome ?? ''} className={inputClass} />
          </label>
        </section>

        <div className="flex justify-end p-4">
          <button type="submit" className={botaoPrimarioClass}>
            Salvar dados
          </button>
        </div>
      </form>
    </div>
  )
}
