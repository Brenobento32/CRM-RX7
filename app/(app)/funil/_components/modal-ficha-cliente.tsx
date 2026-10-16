'use client'

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from 'react'

import { CamposCliente, inputClassCliente } from '@/app/(app)/clientes/_components/cliente-form'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { obterClienteParaFichaAction } from '@/lib/actions/clientes'
import { listarTimelineNegociacaoAction, registrarObservacaoAction } from '@/lib/actions/atividades'
import { listarNichosAtivosAction, obterRespostasLeadAction, salvarFichaAction } from '@/lib/actions/funil'
import type { ClienteDetalhe } from '@/lib/dal/clientes'
import type { ItemTimeline } from '@/lib/dal/atividades'
import type { CardFunil } from '@/lib/dal/funil'
import type { Nicho } from '@/lib/dal/nichos'
import type { RespostaLead } from '@/lib/dal/negociacoes'
import { CAMPOS_CLIENTE, type CampoCliente } from '@/lib/validations/cliente'
import type { EtapaKanban } from '@/lib/utils/etapas'
import { formatarDataHoraCompleta, formatarMoeda } from '@/lib/utils/formatacao'
import { ROTULO_TIPO_ATIVIDADE } from '@/lib/validations/atividade'
import { ROTULO_ORIGEM } from '@/lib/validations/funil'
import { ROTULO_TEMPERATURA, TEMPERATURAS } from '@/lib/validations/negociacao'

import { FormObservacaoRapida } from './form-observacao-rapida'
import { ErroCampo } from './modal'

type Props = {
  card: CardFunil
  etapas: EtapaKanban[]
  /**
   * GERENTE sempre `true`; SDR/CLOSER só quando `pode_mover` está
   * configurado na etapa atual do card. Puramente UX — esconde/desabilita
   * o que o servidor (RPCs `atualizar_dados_operacionais_negociacao` e
   * `atualizar_cliente_do_card`, ambas GERENTE ou `pode_mover_etapa`) ia
   * recusar de qualquer forma, pra nem fazer a chamada. `pode_ver=true`
   * sozinho (que é como o usuário conseguiu abrir esta ficha) nunca é
   * suficiente aqui.
   */
  podeTrabalharCard: boolean
  onFechar: () => void
}

/** Mesmo formato de `modal-edicao-rapida.tsx` — sem decimal, campo começa vazio. */
function valorParaCampo(valor: number | null): string {
  return valor === null ? '' : valor.toFixed(2).replace('.', ',')
}

/**
 * Ficha do cliente dentro do Kanban — `<dialog>` nativo sobre o
 * `DrawerNegociacao` (mesma pilha de `PainelConversa`): fechar aqui revela o
 * drawer de novo, sozinho, sem navegar para `/clientes/[id]`.
 *
 * Dados do cliente (cadastro) e dados comerciais da negociação (nicho/
 * temperatura/proposta) são salvos juntos, num ÚNICO formulário/botão
 * "Salvar alterações" (`SecaoEdicao` abaixo) — nunca fecha a ficha: sucesso
 * e erro aparecem inline, embaixo do botão. Funil/etapa/responsável/origem
 * ficam só leitura: funil/etapa/responsável têm telas próprias (Mover no
 * Kanban, carteira do cliente); origem é fato histórico de como o lead
 * entrou — nunca editável por ninguém, nem gerente (trigger
 * `negociacoes_origem_imutavel`). Qualificação é só leitura: vem do
 * formulário externo, não existe fluxo de editar resposta. Observação
 * continua sendo uma ação SEPARADA (vira atividade/timeline, nunca mexe no
 * cadastro) — não faz parte deste formulário combinado.
 */
export function ModalFichaCliente({ card, etapas, podeTrabalharCard, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [cliente, setCliente] = useState<ClienteDetalhe | null | undefined>(undefined)
  const [respostas, setRespostas] = useState<RespostaLead[] | null>(null)
  const [nichos, setNichos] = useState<Nicho[]>([])
  const [timeline, setTimeline] = useState<ItemTimeline[] | null>(null)
  const [carregando, iniciarCarregamento] = useTransition()

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    iniciarCarregamento(async () => {
      const [c, r, n, t] = await Promise.all([
        obterClienteParaFichaAction(card.clienteId),
        obterRespostasLeadAction(card.id),
        listarNichosAtivosAction(),
        listarTimelineNegociacaoAction(card.id),
      ])
      setCliente(c)
      setRespostas(r)
      setNichos(n)
      setTimeline(t)
    })
  }, [card.clienteId, card.id])

  // Chamado depois de `registrarObservacaoAction` ter sucesso — o
  // formulário/estado dela fica em `FormObservacaoRapida` (não aqui), então
  // a timeline precisa ser buscada de novo explicitamente: ela veio de um
  // `useEffect` client-side, não de uma prop de RSC, e `revalidatePath` não
  // re-executa esse fetch por conta própria.
  function recarregarTimeline() {
    startTransition(async () => {
      setTimeline(await listarTimelineNegociacaoAction(card.id))
    })
  }

  const etapa = etapas.find((e) => e.id === card.etapaId)

  return (
    <dialog
      ref={ref}
      aria-labelledby="ficha-titulo"
      onCancel={(e) => {
        e.preventDefault()
        onFechar()
      }}
      className="m-auto w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="ficha-titulo" className="text-lg font-semibold">
            Ficha do cliente
          </h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar ficha"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </div>

        {carregando && cliente === undefined ? (
          <p className="mt-4 text-sm text-zinc-500">Carregando…</p>
        ) : !cliente ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">Cliente não encontrado.</p>
        ) : (
          <div className="mt-5 space-y-8">
            <SecaoEdicao
              card={card}
              etapa={etapa}
              nichos={nichos}
              cliente={cliente}
              podeTrabalharCard={podeTrabalharCard}
            />

            <SecaoAtribuicao card={card} />

            <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Qualificação</h3>
              {respostas === null ? (
                <p className="text-sm text-zinc-500">Carregando…</p>
              ) : respostas.length === 0 ? (
                <p className="text-sm text-zinc-500">Qualificação ainda não preenchida.</p>
              ) : (
                <dl className="space-y-3 text-sm">
                  {respostas.map((r) => (
                    <div key={r.pergunta}>
                      <dt className="text-zinc-500">{r.pergunta}</dt>
                      <dd className="mt-0.5 font-medium">{r.resposta}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Observações</h3>
              {podeTrabalharCard ? (
                <>
                  <p className="text-xs text-zinc-500">
                    Vira uma atividade ligada a esta negociação — nunca altera o cadastro do cliente.
                  </p>
                  <FormObservacaoRapida
                    action={registrarObservacaoAction.bind(null, cliente.id, card.id)}
                    onRegistrada={recarregarTimeline}
                  />
                </>
              ) : (
                <p className="text-sm text-zinc-500">
                  Você só pode visualizar este card — sem permissão para registrar observações nele.
                </p>
              )}

              <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Histórico
                </h4>
                {timeline === null ? (
                  <p className="text-sm text-zinc-500">Carregando…</p>
                ) : timeline.length === 0 ? (
                  <p className="text-sm text-zinc-500">Nenhuma atividade registrada nesta negociação.</p>
                ) : (
                  <ol className="relative space-y-4 border-l border-zinc-200 pl-4 dark:border-zinc-800">
                    {timeline.map((a) => (
                      <li key={a.id} className="relative">
                        <span
                          className="absolute top-1.5 -left-[21px] size-2 rounded-full border-2 border-white bg-zinc-400 dark:border-zinc-950"
                          aria-hidden
                        />
                        <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                            {ROTULO_TIPO_ATIVIDADE[a.tipo]}
                          </span>
                          <time dateTime={a.data}>{formatarDataHoraCompleta(a.data)}</time>
                          {a.usuario && <span>· {a.usuario}</span>}
                        </p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{a.descricao}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </dialog>
  )
}

/**
 * Formulário único: dados comerciais da negociação (nicho/temperatura/
 * proposta) + cadastro do cliente, um só `<form>`, um só botão "Salvar
 * alterações", nunca fecha a ficha. `salvarFichaAction` chama as duas RPCs
 * (cliente + negociação) e devolve sucesso/erro — mostrados inline embaixo
 * do botão, sem toast como única confirmação.
 *
 * Trava dupla, nunca só na UI: `bloqueadoComercial` é true em etapa
 * encerrada (ganha/perdida — o banco recusa via `negociacoes_encerrada_
 * somente_leitura`/a própria RPC) OU quando o chamador não tem `pode_mover_
 * etapa` na etapa atual (a RPC recusa com 42501). Cadastro do cliente só
 * trava por falta de `pode_mover_etapa` — negociação encerrada NÃO bloqueia
 * corrigir nome/telefone/e-mail do cliente (não é dado histórico da venda).
 */
function SecaoEdicao({
  card,
  etapa,
  nichos,
  cliente,
  podeTrabalharCard,
}: {
  card: CardFunil
  etapa: EtapaKanban | undefined
  nichos: Nicho[]
  cliente: ClienteDetalhe
  podeTrabalharCard: boolean
}) {
  const encerrada = card.etapaTipo !== 'aberta'
  const bloqueadoComercial = encerrada || !podeTrabalharCard

  const [estado, action, pendente] = useActionState(
    salvarFichaAction.bind(null, cliente.id, card.id),
    undefined,
  )

  const erro = (campo: string) => estado?.campos?.[campo]?.[0]
  const valorAtual = card.etapaTipo === 'ganha' ? card.valorVendido : card.valorEstimado

  const valoresCliente: Partial<Record<CampoCliente, string>> = Object.fromEntries(
    CAMPOS_CLIENTE.map((c) => [c, estado?.valores?.[c] ?? (cliente[c as keyof ClienteDetalhe] as string | null) ?? '']),
  )

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(() => action(formData))
      }}
    >
      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Dados comerciais</h3>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Funil</dt>
            <dd className="mt-0.5 font-medium">{card.funilNome ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Etapa</dt>
            <dd className="mt-0.5 flex items-center gap-2 font-medium">
              {etapa && <PontoEtapa cor={etapa.cor} />}
              {etapa?.nome ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Responsável</dt>
            <dd className="mt-0.5 font-medium">{card.responsavel ?? '—'}</dd>
          </div>
          <div>
            {/* Fato histórico de como o lead entrou — nunca editável por
                ninguém, nem gerente (trigger negociacoes_origem_imutavel). */}
            <dt className="text-zinc-500">Origem</dt>
            <dd className="mt-0.5 font-medium">{ROTULO_ORIGEM[card.origem]}</dd>
          </div>
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="nicho_id" className="mb-1.5 block text-sm font-medium">
              Nicho
            </label>
            {bloqueadoComercial ? (
              <>
                {/* Valor atual, sem alteração: a RPC operacional escreve os
                    8 campos juntos — omitir o campo mandaria `null` e
                    apagaria um valor que não mudou. */}
                <input type="hidden" name="nicho_id" value={card.nichoId ?? ''} />
                <p className="mt-2 text-sm">{card.nichoNome ?? 'Outros'}</p>
              </>
            ) : (
              <select id="nicho_id" name="nicho_id" defaultValue={card.nichoId ?? ''} className={inputClassCliente}>
                <option value="">Outros</option>
                {/* Nicho histórico desativado: mantém selecionado (se não tocar, salva
                    igual) e mostra o nome, mas nunca pode ser escolhido de novo —
                    `disabled` só permite ser a opção já selecionada. */}
                {card.nichoId && !nichos.some((n) => n.id === card.nichoId) && (
                  <option value={card.nichoId} disabled>
                    {card.nichoNome ?? 'Nicho desativado'} (desativado)
                  </option>
                )}
                {nichos.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nome}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label htmlFor="temperatura" className="mb-1.5 block text-sm font-medium">
              Temperatura
            </label>
            {bloqueadoComercial ? (
              <>
                {/* Mesmo motivo do hidden de nicho, acima. */}
                <input type="hidden" name="temperatura" value={card.temperatura ?? ''} />
                <p className="mt-2 text-sm">
                  {card.temperatura ? ROTULO_TEMPERATURA[card.temperatura] : '—'}
                </p>
              </>
            ) : (
              <select
                id="temperatura"
                name="temperatura"
                defaultValue={card.temperatura ?? ''}
                className={inputClassCliente}
              >
                <option value="">Não avaliada</option>
                {TEMPERATURAS.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TEMPERATURA[t]}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label htmlFor="valor_estimado" className="mb-1.5 block text-sm font-medium">
              Proposta (R$)
            </label>
            {bloqueadoComercial ? (
              <>
                {/* `valor_estimado` em si (não o vendido mostrado abaixo) —
                    mesmo motivo do hidden de nicho, acima. */}
                <input type="hidden" name="valor_estimado" value={valorParaCampo(card.valorEstimado)} />
                <p className="mt-2 text-sm">{valorAtual !== null ? formatarMoeda(valorAtual) : 'Sem valor'}</p>
              </>
            ) : (
              <>
                <input
                  id="valor_estimado"
                  name="valor_estimado"
                  inputMode="decimal"
                  placeholder="15.000,00"
                  defaultValue={valorParaCampo(card.valorEstimado)}
                  aria-invalid={erro('valor_estimado') ? true : undefined}
                  aria-describedby="valor_estimado-erro"
                  className={inputClassCliente}
                />
                <ErroCampo id="valor_estimado-erro" mensagem={erro('valor_estimado')} />
              </>
            )}
          </div>
        </div>

        {encerrada ? (
          <p
            role="note"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          >
            Negociação encerrada: nicho, temperatura e proposta não podem mais ser alterados.
          </p>
        ) : !podeTrabalharCard ? (
          <p role="note" className="text-xs text-zinc-500">
            Você só pode visualizar este card — sem permissão para editar os dados operacionais.
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Dados do cliente</h3>

        {podeTrabalharCard ? (
          <CamposCliente valores={valoresCliente} erro={erro} responsaveis={[]} mostrarObservacoes={false} />
        ) : (
          <>
            <p className="text-xs text-zinc-500">
              Você só pode visualizar este card — sem permissão para editar os dados cadastrais dele.
            </p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Nome</dt>
                <dd className="mt-0.5 font-medium">{cliente.nome}</dd>
              </div>
              {cliente.empresa && (
                <div>
                  <dt className="text-zinc-500">Empresa</dt>
                  <dd className="mt-0.5 font-medium">{cliente.empresa}</dd>
                </div>
              )}
              <div>
                <dt className="text-zinc-500">Telefone</dt>
                <dd className="mt-0.5 font-medium">{cliente.telefone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">E-mail</dt>
                <dd className="mt-0.5 font-medium">{cliente.email ?? '—'}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      {podeTrabalharCard && (
        <div className="space-y-2">
          <button
            type="submit"
            disabled={pendente}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pendente ? 'Salvando…' : 'Salvar alterações'}
          </button>

          {!pendente && estado?.sucesso && (
            <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
              ✓ Alterações salvas.
            </p>
          )}
          {!pendente && estado?.erro && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              ⚠ Não foi possível salvar: {estado.erro}
            </p>
          )}
        </div>
      )}
    </form>
  )
}

/**
 * Atribuição/campanha (item 10) — só os campos preenchidos; nunca uma linha
 * vazia por campo. IDs aparecem (diferente do card, que só mostra o nome da
 * campanha): aqui é onde a integração futura com Meta Ads vai precisar
 * deles. "Formulário" entra aqui (não em Dados comerciais) porque só faz
 * sentido pra lead de origem formulário — a mesma seção que já mostra o
 * resto da atribuição.
 */
function SecaoAtribuicao({ card }: { card: CardFunil }) {
  const atribuicao = card.atribuicao
  const campos: { rotulo: string; valor: string | null | undefined }[] = [
    { rotulo: 'Formulário', valor: card.formularioNome },
    { rotulo: 'Campaign ID', valor: atribuicao?.campaign_id },
    { rotulo: 'Campaign', valor: atribuicao?.campaign_name },
    { rotulo: 'Ad Set ID', valor: atribuicao?.adset_id },
    { rotulo: 'Ad Set', valor: atribuicao?.adset_name },
    { rotulo: 'Ad ID', valor: atribuicao?.ad_id },
    { rotulo: 'Ad', valor: atribuicao?.ad_name },
    { rotulo: 'UTM Source', valor: atribuicao?.utm_source },
    { rotulo: 'UTM Medium', valor: atribuicao?.utm_medium },
    { rotulo: 'UTM Campaign', valor: atribuicao?.utm_campaign },
    { rotulo: 'UTM Content', valor: atribuicao?.utm_content },
    { rotulo: 'UTM Term', valor: atribuicao?.utm_term },
  ].filter((c): c is { rotulo: string; valor: string } => Boolean(c.valor))

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Atribuição / Campanha</h3>
      {campos.length === 0 ? (
        <p className="text-sm text-zinc-500">Sem dados de campanha.</p>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {campos.map((c) => (
            <div key={c.rotulo}>
              <dt className="text-zinc-500">{c.rotulo}</dt>
              <dd className="mt-0.5 font-medium break-all">{c.valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
