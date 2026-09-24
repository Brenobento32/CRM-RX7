import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import {
  concluirProximaAcaoAction,
  criarProximaAcaoAction,
  registrarAtividadeAction,
} from '@/lib/actions/atividades'
import { LIMITE_TIMELINE, listarProximasAcoes, listarTimeline } from '@/lib/dal/atividades'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterCliente, type NegociacaoDoCliente } from '@/lib/dal/clientes'
import { listarEventosDoCliente } from '@/lib/dal/eventos'
import {
  formatarCnpj,
  formatarCpf,
  formatarTelefone,
  linkWhatsapp,
} from '@/lib/utils/documentos'
import {
  agoraSaoPauloLocal,
  formatarData,
  formatarMoeda,
  formatarDataHoraCompleta,
  formatarDia,
  hojeSaoPaulo,
} from '@/lib/utils/formatacao'
import { ROTULO_TIPO_ATIVIDADE } from '@/lib/validations/atividade'
import { ROTULO_TIPO_CLIENTE } from '@/lib/validations/cliente'
import { ROTULO_FORMA_PAGAMENTO, ROTULO_TEMPERATURA } from '@/lib/validations/negociacao'

import { EventoItem, ListaEventos } from '@/components/agenda/evento-item'

import { FormAtividade } from './_components/form-atividade'
import { FormProximaAcao } from './_components/form-proxima-acao'

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
  const [timeline, proximasAcoes, eventos] = await Promise.all([
    listarTimeline(cliente.id),
    listarProximasAcoes(cliente.id),
    listarEventosDoCliente(cliente.id),
  ])

  const data = formatarDataHoraCompleta
  const hoje = hojeSaoPaulo()

  const opcoesNegociacao = cliente.negociacoes.map((n) => ({
    id: n.id,
    rotulo: `${n.etapa.nome} · aberta em ${formatarData(n.created_at)}`,
  }))
  const etapaDaNegociacao = new Map(cliente.negociacoes.map((n) => [n.id, n.etapa]))

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
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-2 font-medium">
                      <PontoEtapa cor={n.etapa.cor} />
                      {n.etapa.nome}
                    </span>
                    <span className="text-zinc-500">Aberta em {data(n.created_at)}</span>
                  </p>
                  <ResumoNegociacao negociacao={n} />
                </div>
                <Link href={`/negociacoes/${n.id}/editar`} className={botaoSecundarioClass}>
                  {n.etapa.tipo === 'aberta' ? 'Editar' : 'Ver'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Agenda</h2>
          <Link href={`/agenda/novo?cliente=${cliente.id}`} className={botaoSecundarioClass}>
            Agendar evento
          </Link>
        </div>
        {eventos.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum compromisso agendado.</p>
        ) : (
          <ListaEventos>
            {eventos.map((e) => (
              <EventoItem
                key={e.id}
                evento={e}
                mostrarData
                mostrarResponsavel={usuario.role === 'gerente'}
              />
            ))}
          </ListaEventos>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Próximas ações</h2>

        {proximasAcoes.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma próxima ação pendente.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {proximasAcoes.map((a) => {
              const atrasada = a.data < hoje
              const etapa = a.negociacaoId ? etapaDaNegociacao.get(a.negociacaoId) : undefined
              return (
                <li key={a.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{a.titulo}</p>
                    <p className="text-xs text-zinc-500">
                      <span
                        className={
                          atrasada
                            ? 'font-medium text-red-600 dark:text-red-400'
                            : a.data === hoje
                              ? 'font-medium text-amber-700 dark:text-amber-400'
                              : undefined
                        }
                      >
                        {a.data === hoje ? 'Hoje' : formatarDia(a.data)}
                        {atrasada && ' · atrasada'}
                      </span>
                      {etapa && ` · ${etapa.nome}`}
                    </p>
                    {a.observacao && (
                      <p className="mt-1 text-zinc-600 dark:text-zinc-400">{a.observacao}</p>
                    )}
                  </div>
                  <form action={concluirProximaAcaoAction.bind(null, a.id, cliente.id)}>
                    <button type="submit" className={botaoSecundarioClass}>
                      Concluir
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>
        )}

        <details className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <summary className="cursor-pointer text-sm font-medium">Agendar próxima ação</summary>
          <div className="mt-4">
            <FormProximaAcao
              action={criarProximaAcaoAction.bind(null, cliente.id)}
              negociacoes={opcoesNegociacao}
              hoje={hoje}
            />
          </div>
        </details>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Atividades</h2>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <FormAtividade
            action={registrarAtividadeAction.bind(null, cliente.id)}
            negociacoes={opcoesNegociacao}
            agora={agoraSaoPauloLocal()}
          />
        </div>

        {timeline.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma atividade registrada.</p>
        ) : (
          <ol className="relative space-y-5 border-l border-zinc-200 pl-5 dark:border-zinc-800">
            {timeline.map((a) => (
              <li key={a.id} className="relative">
                <span
                  className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-white bg-zinc-400 dark:border-zinc-950"
                  aria-hidden
                />
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {ROTULO_TIPO_ATIVIDADE[a.tipo]}
                  </span>
                  <time dateTime={a.data}>{data(a.data)}</time>
                  {a.usuario && <span>· {a.usuario}</span>}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{a.descricao}</p>
              </li>
            ))}
          </ol>
        )}
        {timeline.length === LIMITE_TIMELINE && (
          <p className="text-xs text-zinc-500">
            Mostrando as {LIMITE_TIMELINE} atividades mais recentes.
          </p>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        Cadastrado em {data(cliente.created_at)} · atualizado em {data(cliente.updated_at)}
      </p>
    </div>
  )
}

/** Valores, proposta e serviços de uma negociação; some quando não há nada. */
function ResumoNegociacao({ negociacao: n }: { negociacao: NegociacaoDoCliente }) {
  const dados = [
    n.valor_estimado !== null && `Estimado ${formatarMoeda(n.valor_estimado)}`,
    n.temperatura && ROTULO_TEMPERATURA[n.temperatura],
    (n.valor_proposta !== null || n.forma_pagamento) &&
      `Proposta ${[
        n.valor_proposta !== null && formatarMoeda(n.valor_proposta),
        n.forma_pagamento && ROTULO_FORMA_PAGAMENTO[n.forma_pagamento],
      ]
        .filter(Boolean)
        .join(' · ')}`,
  ].filter(Boolean)

  if (dados.length === 0 && n.servicos.length === 0) return null

  return (
    <>
      {dados.length > 0 && <p className="text-zinc-600 dark:text-zinc-400">{dados.join(' · ')}</p>}
      {n.servicos.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Serviços">
          {n.servicos.map((s) => (
            <li
              key={s.nome}
              className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {s.nome}
              {!s.ativo && <span className="text-zinc-500"> (desativado)</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
