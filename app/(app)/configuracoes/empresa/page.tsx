import type { Metadata } from 'next'
import Link from 'next/link'

import { CampoLogotipo } from '@/components/empresa/campo-logotipo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { salvarDadosEmpresaAction } from '@/lib/actions/empresa-dados'
import { exigirCargo } from '@/lib/dal/auth'
import { obterDadosEmpresa } from '@/lib/dal/empresa-dados'
import { formatarTelefone } from '@/lib/utils/documentos'

export const metadata: Metadata = {
  title: 'Dados da empresa',
}

/**
 * Gerente: logotipo, telefone, e-mail e responsável da própria empresa. Nome
 * comercial e endereço aparecem só para leitura — quem muda é a Rio X7
 * (Super Admin). O banco recusa qualquer outro campo.
 */
export default async function DadosEmpresaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await exigirCargo(['gerente'])
  const { ok, erro } = await searchParams
  const dados = await obterDadosEmpresa()
  const mensagemOk = typeof ok === 'string' ? ok : undefined
  const mensagemErro = typeof erro === 'string' ? erro : undefined

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Dados da empresa</h1>
      </div>

      {mensagemErro ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {mensagemErro}
        </p>
      ) : mensagemOk ? (
        <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {mensagemOk}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-zinc-200 p-4 text-sm sm:grid-cols-2 dark:border-zinc-800">
        <div>
          <p className="text-zinc-500">Nome comercial</p>
          <p className="mt-0.5 font-medium">{dados.nome}</p>
        </div>
        <div>
          <p className="text-zinc-500">Endereço no sistema</p>
          <p className="mt-0.5 font-medium">/{dados.slug}</p>
        </div>
        <p className="text-xs text-zinc-500 sm:col-span-2">
          Nome, endereço e plano são alterados pela Rio X7. Fale com o suporte se precisar mudar.
        </p>
      </section>

      <form
        action={salvarDadosEmpresaAction}
        className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900"
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
            <input name="telefone" inputMode="tel" defaultValue={dados.telefone ? formatarTelefone(dados.telefone) : ''} className={inputClass} />
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
