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
import { arquivarClienteAction } from '@/lib/actions/clientes'
import { LIMITE_TIMELINE, listarProximasAcoes, listarTimeline } from '@/lib/dal/atividades'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { Secao } from '@/components/ui/secao'
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
import { ROTULO_ORIGEM } from '@/lib/validations/funil'
import { ROTULO_FORMA_PAGAMENTO, ROTULO_TEMPERATURA } from '@/lib/validations/negociacao'

import { EventoItem, ListaEventos } from '@/components/agenda/evento-item'

import { BotaoArquivarCliente } from './_components/botao-arquivar'
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
    <div className="space-y-6">
      <div>
        <Link href="/clientes" className="mb-2 inline-flex items-center gap-1 text-sm text-premium-mudo transition hover:text-premium-texto">
          <span aria-hidden>←</span> Clientes
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-premium-acento-suave text-lg font-semibold text-premium-acento">
              {cliente.nome.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-premium-texto">{cliente.nome}</h1>
              <p className="text-sm text-premium-secundario">
                {[cliente.empresa, ROTULO_TIPO_CLIENTE[cliente.tipo_cliente]].filter(Boolean).join(' · ') || 'Cliente'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <Link href={`/clientes/${cliente.id}/editar`} className={botaoSecundarioClass}>
              Editar cliente
            </Link>
            {/* Atendente não arquiva clientes (o banco também recusa). */}
            {usuario.role !== 'atendente' && <BotaoArquivarCliente action={arquivarClienteAction.bind(null, cliente.id)} />}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Secao
            titulo="Negociações"
            descricao={`${cliente.negociacoes.length} ${cliente.negociacoes.length === 1 ? 'negociação' : 'negociações'}`}
            semPadding
          >
            <div className="p-2">
            {cliente.negociacoes.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhuma negociação" descricao="Crie uma entrada no funil para começar a acompanhar este cliente." acao={{ href: '/funil/nova', rotulo: 'Nova entrada no funil' }} />
            ) : (
              <ul className="divide-y divide-premium-borda-suave">
                {cliente.negociacoes.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 space-y-1.5">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex items-center gap-2 font-medium">
                          <PontoEtapa cor={n.etapa.cor} />
                          {n.etapa.nome}
                        </span>
                        {n.funilNome && <span className="text-premium-mudo">{n.funilNome}</span>}
                        <span className="rounded bg-premium-bg px-1.5 py-0.5 text-xs text-premium-secundario">
                          {ROTULO_ORIGEM[n.origem]}
                        </span>
                        <span className="text-premium-mudo">Aberta em {data(n.created_at)}</span>
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
                </div>
          </Secao>

          <Secao titulo="Atividades" descricao="Registre ligações, reuniões e mensagens — tudo fica na linha do tempo.">
            <div className="space-y-5">
              <div className="rounded-lg border border-premium-borda-suave bg-premium-bg/50 p-4">
                <FormAtividade
                  action={registrarAtividadeAction.bind(null, cliente.id)}
                  negociacoes={opcoesNegociacao}
                  agora={agoraSaoPauloLocal()}
                />
              </div>
      
              {timeline.length === 0 ? (
                <EstadoVazio compacto titulo="Nenhuma atividade ainda" descricao="A primeira atividade registrada aparece aqui." />
              ) : (
                <ol className="relative space-y-5 border-l border-premium-borda pl-5">
                  {timeline.map((a) => (
                    <li key={a.id} className="relative">
                      <span
                        className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-premium-card bg-premium-acento"
                        aria-hidden
                      />
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-premium-mudo">
                        <span className="rounded bg-premium-bg px-1.5 py-0.5 font-medium text-premium-secundario">
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
                <p className="text-xs text-premium-mudo">
                  Mostrando as {LIMITE_TIMELINE} atividades mais recentes.
                </p>
              )}
                  </div>
          </Secao>
        </div>

        <div className="space-y-6">
          <Secao titulo="Dados de contato">
            <dl className="space-y-3">
              {itens.map((item) => (
                <div key={item.rotulo} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="shrink-0 text-premium-mudo">{item.rotulo}</dt>
                  <dd className="min-w-0 truncate text-right text-premium-texto">{item.valor || '—'}</dd>
                </div>
              ))}
              <div className="border-t border-premium-borda-suave pt-3 text-sm">
                <dt className="text-premium-mudo">Observações</dt>
                <dd className="mt-1 whitespace-pre-wrap text-premium-texto">{cliente.observacoes || '—'}</dd>
              </div>
            </dl>
          </Secao>

          <Secao titulo="Próximas ações">
            <div className="space-y-4">
              {proximasAcoes.length === 0 ? (
                <p className="text-sm text-premium-mudo">Nenhuma ação pendente. Registre abaixo o próximo passo com este cliente.</p>
              ) : (
                <ul className="divide-y divide-premium-borda-suave">
                  {proximasAcoes.map((a) => {
                    const atrasada = a.data < hoje
                    const etapa = a.negociacaoId ? etapaDaNegociacao.get(a.negociacaoId) : undefined
                    return (
                      <li key={a.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">{a.titulo}</p>
                          <p className="text-xs text-premium-mudo">
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
                            <p className="mt-1 text-premium-secundario">{a.observacao}</p>
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
      
              <details className="rounded-lg border border-premium-borda-suave bg-premium-bg/50 p-3">
                <summary className="cursor-pointer text-sm font-medium">Agendar próxima ação</summary>
                <div className="mt-4">
                  <FormProximaAcao
                    action={criarProximaAcaoAction.bind(null, cliente.id)}
                    negociacoes={opcoesNegociacao}
                    hoje={hoje}
                  />
                </div>
              </details>
                  </div>
          </Secao>

          <Secao
            titulo="Agenda"
            acoes={
              <Link href={`/agenda/novo?cliente=${cliente.id}`} className="text-sm font-medium text-premium-acento hover:underline">
                Agendar
              </Link>
            }
          >
            {eventos.length === 0 ? (
              <p className="text-sm text-premium-mudo">Nenhum compromisso com este cliente. Use “Agendar” para marcar uma reunião.</p>
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
              </Secao>

          <p className="text-xs text-premium-mudo">
            Cadastrado em {data(cliente.created_at)} · atualizado em {data(cliente.updated_at)}
          </p>
        </div>
      </div>
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
      {dados.length > 0 && <p className="text-premium-secundario">{dados.join(' · ')}</p>}
      {n.servicos.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Serviços">
          {n.servicos.map((s) => (
            <li
              key={s.nome}
              className="rounded bg-premium-bg px-1.5 py-0.5 text-xs text-premium-secundario"
            >
              {s.nome}
              {!s.ativo && <span className="text-premium-mudo"> (desativado)</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
