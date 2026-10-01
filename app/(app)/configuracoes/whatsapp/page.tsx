import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { listarResponsaveis } from '@/lib/dal/clientes'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarFunis } from '@/lib/dal/funis'
import { obterConfiguracaoWhatsapp } from '@/lib/dal/whatsapp'

import { WhatsappForm } from './_components/whatsapp-form'

export const metadata: Metadata = {
  title: 'WhatsApp',
}

const ROTULO_STATUS: Record<string, string> = {
  conectado: 'Conectado',
  conectando: 'Conectando…',
  desconectado: 'Desconectado',
}

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ salvo?: string }>
}) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const params = await searchParams
  const salvo = params.salvo === '1'

  const [configuracao, funis, responsaveis] = await Promise.all([
    obterConfiguracaoWhatsapp(),
    listarFunis(),
    listarResponsaveis(),
  ])
  const funisHabilitados = funis.filter((f) => f.whatsappHabilitado && f.ativo)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">WhatsApp</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Funil e responsável padrão usados quando a criação automática de lead a partir do WhatsApp existir.
          Nenhuma automação está ativa ainda — esta tela só guarda a configuração.
        </p>
      </div>

      {salvo && (
        <div
          role="status"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
        >
          Configuração salva.
        </div>
      )}

      {configuracao ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Status da conexão: <span className="font-medium">{ROTULO_STATUS[configuracao.status]}</span>
          {configuracao.numero ? ` — número ${configuracao.numero}` : ''}
        </p>
      ) : (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          A conexão WhatsApp ainda não foi iniciada — rode o whatsapp-service pelo menos uma vez antes de
          configurar.
        </div>
      )}

      {funisHabilitados.length === 0 ? (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          Nenhum funil tem a conversa WhatsApp habilitada ainda. Habilite em{' '}
          <Link href="/configuracoes/funis" className="underline">
            Configurações → Funis
          </Link>{' '}
          antes de escolher aqui.
        </div>
      ) : (
        <WhatsappForm
          desabilitado={!configuracao}
          funis={funisHabilitados}
          responsaveis={responsaveis}
          valoresIniciais={{
            funilId: configuracao?.funilId ?? '',
            responsavelPadraoId: configuracao?.responsavelPadraoId ?? '',
          }}
        />
      )}
    </div>
  )
}
