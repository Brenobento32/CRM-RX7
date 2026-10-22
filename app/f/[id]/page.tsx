import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { enviarFormularioPublicoAction } from '@/lib/actions/formulario-publico'
import { createPublicClient } from '@/lib/supabase/publico'

export const metadata: Metadata = {
  title: 'Fale conosco',
  robots: { index: false, follow: false },
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Formulário público de captação de uma fonte "Formulário AVANTE". Não expõe
 * nada da empresa além do nome; o envio cai no funil/etapa da fonte.
 */
export default async function FormularioPublicoPage({ params, searchParams }: Props) {
  const [{ id }, busca] = await Promise.all([params, searchParams])
  if (!UUID.test(id)) notFound()

  const supabase = createPublicClient()
  const { data } = await supabase.rpc('formulario_rx7_publico', { p_fonte: id })
  const form = data?.[0]
  if (!form) notFound()

  const enviado = busca.enviado === '1'
  const erro = typeof busca.erro === 'string' ? busca.erro : null

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs uppercase tracking-wide text-zinc-500">{form.empresa}</p>
        <h1 className="mt-1 text-xl font-semibold">{form.nome}</h1>

        {!form.ativo ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Este formulário não está recebendo respostas no momento.</p>
        ) : enviado ? (
          <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">
            Recebemos seus dados. Em breve entraremos em contato.
          </p>
        ) : (
          <form action={enviarFormularioPublicoAction} className="mt-6 space-y-4">
            <input type="hidden" name="fonte" value={id} />
            <input type="hidden" name="envio" value={crypto.randomUUID()} />
            {/* Isca para robôs: invisível para pessoas. */}
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Site
                <input name="site" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <Campo rotulo="Nome">
              <input name="nome" required minLength={2} maxLength={200} autoComplete="name" className={inputClass} />
            </Campo>
            <Campo rotulo="WhatsApp / telefone">
              <input name="telefone" type="tel" maxLength={40} autoComplete="tel" className={inputClass} />
            </Campo>
            <Campo rotulo="E-mail">
              <input name="email" type="email" maxLength={200} autoComplete="email" className={inputClass} />
            </Campo>
            <Campo rotulo="Empresa (opcional)">
              <input name="empresa" maxLength={200} autoComplete="organization" className={inputClass} />
            </Campo>
            <Campo rotulo="Mensagem (opcional)">
              <textarea name="mensagem" rows={3} maxLength={2000} className={inputClass} />
            </Campo>
            {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
            <button type="submit" className={`${botaoPrimarioClass} w-full`}>
              Enviar
            </button>
            <p className="text-xs text-zinc-500">Seus dados são usados só para este contato.</p>
          </form>
        )}
      </div>
    </main>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{rotulo}</span>
      {children}
    </label>
  )
}
