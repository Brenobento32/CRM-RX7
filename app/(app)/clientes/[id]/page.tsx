import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterCliente } from '@/lib/dal/clientes'
import {
  formatarCnpj,
  formatarCpf,
  formatarTelefone,
  linkWhatsapp,
} from '@/lib/utils/documentos'
import { COR_ETAPA, ROTULO_ETAPA } from '@/lib/utils/etapas'
import { ROTULO_TIPO_CLIENTE } from '@/lib/validations/cliente'

const FUSO = 'America/Sao_Paulo'

async function carregar(id: string) {
  if (!z.uuid().safeParse(id).success) notFound()
  const cliente = await obterCliente(id)
  if (!cliente) notFound()
  return cliente
}

export async function generateMetadata({
  params,
}: PageProps<'/clientes/[id]'>): Promise<Metadata> {
  const { id } = await params
  const cliente = await carregar(id)
  return { title: cliente.nome }
}

export default async function ClientePage({ params }: PageProps<'/clientes/[id]'>) {
  const usuario = await getUsuarioAtual()
  const { id } = await params
  const cliente = await carregar(id)

  const data = (iso: string) =>
    formatInTimeZone(iso, FUSO, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })

  const itens: { rotulo: string; valor: React.ReactNode }[] = [
    { rotulo: 'Tipo', valor: ROTULO_TIPO_CLIENTE[cliente.tipo_cliente] },
    { rotulo: 'Empresa', valor: cliente.empresa },
    cliente.tipo_cliente === 'empresa'
      ? { rotulo: 'CNPJ', valor: cliente.cnpj && formatarCnpj(cliente.cnpj) }
      : { rotulo: 'CPF', valor: cliente.cpf && formatarCpf(cliente.cpf) },
    ...(cliente.tipo_cliente === 'empresa'
      ? [
          { rotulo: 'Responsável', valor: cliente.responsavel },
          { rotulo: 'Cargo', valor: cliente.cargo },
        ]
      : []),
    { rotulo: 'Telefone', valor: cliente.telefone && formatarTelefone(cliente.telefone) },
    {
      rotulo: 'WhatsApp',
      valor: cliente.whatsapp && (
        <a
          href={linkWhatsapp(cliente.whatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {formatarTelefone(cliente.whatsapp)}
        </a>
      ),
    },
    {
      rotulo: 'E-mail',
      valor: cliente.email && (
        <a href={`mailto:${cliente.email}`} className="underline underline-offset-2">
          {cliente.email}
        </a>
      ),
    },
    ...(usuario.role === 'gerente' ? [{ rotulo: 'Carteira de', valor: cliente.dono }] : []),
  ]

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href="/clientes" className="text-sm text-zinc-500 hover:underline">
          ← Clientes
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{cliente.nome}</h1>
            {cliente.empresa && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{cliente.empresa}</p>
            )}
          </div>
          <Link
            href={`/clientes/${cliente.id}/editar`}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Editar
          </Link>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-4 rounded-lg border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
        {itens.map((item) => (
          <div key={item.rotulo}>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">{item.rotulo}</dt>
            <dd className="mt-1 text-sm">{item.valor || '—'}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Observações</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm">{cliente.observacoes || '—'}</dd>
        </div>
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Negociações</h2>
        {cliente.negociacoes.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma negociação.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {cliente.negociacoes.map((n) => (
              <li key={n.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${COR_ETAPA[n.etapa]}`} aria-hidden />
                  {ROTULO_ETAPA[n.etapa]}
                </span>
                <span className="text-zinc-500">Aberta em {data(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        Cadastrado em {data(cliente.created_at)} · atualizado em {data(cliente.updated_at)}
      </p>
    </div>
  )
}
