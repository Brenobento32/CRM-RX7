'use client'

import { startTransition, useActionState, useEffect, useState } from 'react'

import {
  atualizarFechamentoRapidoAction,
  obterNegociacaoEdicaoAction,
  salvarNegociacaoRapidaAction,
  type EstadoEdicaoRapidaFechamento,
  type EstadoEdicaoRapidaNegociacao,
} from '@/lib/actions/negociacoes'
import type { CardFunil } from '@/lib/dal/funil'
import type { FechamentoEdicao, NegociacaoEdicao } from '@/lib/dal/negociacoes'
import type { Servico } from '@/lib/dal/servicos'
import { formatarDia, formatarMoeda, hojeSaoPaulo } from '@/lib/utils/formatacao'
import {
  ROTULO_STATUS_ONBOARDING,
  ROTULO_STATUS_PAGAMENTO,
  ROTULO_TIPO_VENDA,
  STATUS_ONBOARDING,
  STATUS_PAGAMENTO_FECHAMENTO,
  TIPOS_VENDA,
} from '@/lib/validations/funil'
import {
  FORMAS_PAGAMENTO,
  ROTULO_FORMA_PAGAMENTO,
  ROTULO_TEMPERATURA,
  TEMPERATURAS,
  type CampoEdicaoNegociacao,
} from '@/lib/validations/negociacao'

import { BotoesModal, ErroCampo, ErroGeral, inputClass, Modal } from './modal'

/** Mesma frase de `NEGOCIACAO_ENCERRADA` em lib/dal/negociacoes.ts — esse arquivo é server-only, não dá pra importar valores dele aqui. */
const NEGOCIACAO_ENCERRADA_MSG = 'Negociação encerrada: dados comerciais não podem ser alterados.'

function valorParaCampo(valor: number | null): string {
  return valor === null ? '' : valor.toFixed(2).replace('.', ',')
}

type Props = {
  card: CardFunil
  /** Catálogo ativo; os desativados que já estão nesta negociação entram depois de carregar os dados. */
  servicosAtivos: Servico[]
  onCancelar: () => void
  onConcluido: () => void
}

/**
 * Edição rápida do lápis: busca a negociação ao abrir e mostra o formulário
 * certo pra etapa dela, sem sair do Kanban — mesmo padrão de `ModalFechamento`
 * e `ModalPerda`, mas com um fetch antes do formulário aparecer.
 */
export function ModalEdicaoRapida({ card, servicosAtivos, onCancelar, onConcluido }: Props) {
  const [dados, setDados] = useState<NegociacaoEdicao | null>(null)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    startTransition(async () => {
      const resultado = await obterNegociacaoEdicaoAction(card.id)
      if (resultado) setDados(resultado)
      else setErroCarregar('Não foi possível carregar a negociação.')
      setCarregando(false)
    })
  }, [card.id])

  const titulo =
    dados?.etapa.tipo === 'ganha'
      ? 'Editar fechamento'
      : dados?.etapa.tipo === 'perdida'
        ? 'Negociação'
        : 'Editar negociação'

  const descricao = (
    <>
      {card.clienteNome}
      {card.clienteEmpresa && ` · ${card.clienteEmpresa}`}
    </>
  )

  const servicos = dados
    ? [...servicosAtivos, ...dados.servicos.filter((s) => !servicosAtivos.some((a) => a.id === s.id))].sort(
        (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
      )
    : servicosAtivos

  return (
    <Modal titulo={titulo} descricao={descricao} onCancelar={onCancelar}>
      {carregando && <p className="text-sm text-zinc-500">Carregando…</p>}

      {erroCarregar && (
        <div className="space-y-5">
          <ErroGeral mensagem={erroCarregar} />
          <div className="flex justify-end border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <BotaoFechar onClick={onCancelar} />
          </div>
        </div>
      )}

      {dados && dados.etapa.tipo === 'aberta' && (
        <FormularioAberta dados={dados} servicos={servicos} onCancelar={onCancelar} onConcluido={onConcluido} />
      )}

      {dados && dados.etapa.tipo === 'ganha' && dados.fechamento && (
        <FormularioFechamento
          dados={dados}
          fechamento={dados.fechamento}
          servicos={servicos}
          onCancelar={onCancelar}
          onConcluido={onConcluido}
        />
      )}

      {dados && dados.etapa.tipo === 'perdida' && <ResumoSomenteLeitura dados={dados} onFechar={onCancelar} />}
    </Modal>
  )
}

function BotaoFechar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-md bg-premium-acento px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-950"
    >
      Fechar
    </button>
  )
}

/** Etapa aberta: qualificação, proposta e serviços — mesmos campos de `NegociacaoForm`, sem navegar. */
function FormularioAberta({
  dados,
  servicos,
  onCancelar,
  onConcluido,
}: {
  dados: NegociacaoEdicao
  servicos: Servico[]
  onCancelar: () => void
  onConcluido: () => void
}) {
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoEdicaoRapidaNegociacao | undefined, formData: FormData) => {
      const resultado = await salvarNegociacaoRapidaAction(dados.id, anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    undefined,
  )

  const valores = estado?.valores
  const erro = (campo: CampoEdicaoNegociacao) => estado?.campos?.[campo]?.[0]
  const marcados = new Set(valores?.servico_ids ?? dados.servicos.map((s) => s.id))

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(() => action(formData))
      }}
    >
      <ErroGeral mensagem={estado?.erro} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="valor_estimado" className="mb-1.5 block text-sm font-medium">
            Valor estimado (R$)
          </label>
          <input
            id="valor_estimado"
            name="valor_estimado"
            inputMode="decimal"
            placeholder="15.000,00"
            defaultValue={valores?.valor_estimado ?? valorParaCampo(dados.valorEstimado)}
            aria-invalid={erro('valor_estimado') ? true : undefined}
            aria-describedby="valor_estimado-erro"
            className={inputClass}
            autoFocus
          />
          <ErroCampo id="valor_estimado-erro" mensagem={erro('valor_estimado')} />
        </div>

        <div>
          <label htmlFor="temperatura" className="mb-1.5 block text-sm font-medium">
            Temperatura
          </label>
          <select
            id="temperatura"
            name="temperatura"
            defaultValue={valores?.temperatura ?? dados.temperatura ?? ''}
            className={inputClass}
          >
            <option value="">Não avaliada</option>
            {TEMPERATURAS.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TEMPERATURA[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="data_primeira_reuniao" className="mb-1.5 block text-sm font-medium">
            Primeira reunião
          </label>
          <input
            id="data_primeira_reuniao"
            name="data_primeira_reuniao"
            type="date"
            defaultValue={valores?.data_primeira_reuniao ?? dados.dataPrimeiraReuniao ?? ''}
            aria-invalid={erro('data_primeira_reuniao') ? true : undefined}
            aria-describedby="data_primeira_reuniao-erro"
            className={inputClass}
          />
          <ErroCampo id="data_primeira_reuniao-erro" mensagem={erro('data_primeira_reuniao')} />
        </div>

        <div>
          <label htmlFor="data_proposta" className="mb-1.5 block text-sm font-medium">
            Data da proposta
          </label>
          <input
            id="data_proposta"
            name="data_proposta"
            type="date"
            defaultValue={valores?.data_proposta ?? dados.dataProposta ?? ''}
            aria-invalid={erro('data_proposta') ? true : undefined}
            aria-describedby="data_proposta-erro"
            className={inputClass}
          />
          <ErroCampo id="data_proposta-erro" mensagem={erro('data_proposta')} />
        </div>
      </div>

      <div>
        <label htmlFor="objecao_principal" className="mb-1.5 block text-sm font-medium">
          Objeção principal
        </label>
        <textarea
          id="objecao_principal"
          name="objecao_principal"
          rows={2}
          maxLength={2000}
          defaultValue={valores?.objecao_principal ?? dados.objecaoPrincipal ?? ''}
          aria-invalid={erro('objecao_principal') ? true : undefined}
          aria-describedby="objecao_principal-erro"
          className={inputClass}
        />
        <ErroCampo id="objecao_principal-erro" mensagem={erro('objecao_principal')} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="valor_proposta" className="mb-1.5 block text-sm font-medium">
            Valor da proposta (R$)
          </label>
          <input
            id="valor_proposta"
            name="valor_proposta"
            inputMode="decimal"
            placeholder="12.000,00"
            defaultValue={valores?.valor_proposta ?? valorParaCampo(dados.valorProposta)}
            aria-invalid={erro('valor_proposta') ? true : undefined}
            aria-describedby="valor_proposta-erro"
            className={inputClass}
          />
          <ErroCampo id="valor_proposta-erro" mensagem={erro('valor_proposta')} />
        </div>

        <div>
          <label htmlFor="forma_pagamento" className="mb-1.5 block text-sm font-medium">
            Forma de pagamento
          </label>
          <select
            id="forma_pagamento"
            name="forma_pagamento"
            defaultValue={valores?.forma_pagamento ?? dados.formaPagamento ?? ''}
            className={inputClass}
          >
            <option value="">Não definida</option>
            {FORMAS_PAGAMENTO.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FORMA_PAGAMENTO[f]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ListaServicos servicos={servicos} marcados={marcados} erro={erro('servico_ids')} />

      <BotoesModal pendente={pendente} rotulo="Salvar" onCancelar={onCancelar} />
    </form>
  )
}

/** Etapa ganha: mesmos campos de `EditarFechamentoForm`, sem navegar. */
function FormularioFechamento({
  dados,
  fechamento,
  servicos,
  onCancelar,
  onConcluido,
}: {
  dados: NegociacaoEdicao
  fechamento: FechamentoEdicao
  servicos: Servico[]
  onCancelar: () => void
  onConcluido: () => void
}) {
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoEdicaoRapidaFechamento | undefined, formData: FormData) => {
      const resultado = await atualizarFechamentoRapidoAction(dados.id, anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    undefined,
  )

  const valores = estado?.valores
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]
  const marcados = new Set(valores?.servico_ids ?? dados.servicos.map((s) => s.id))
  const hoje = hojeSaoPaulo()

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(() => action(formData))
      }}
    >
      <ErroGeral mensagem={estado?.erro} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="tipo_venda" className="mb-1.5 block text-sm font-medium">
            Tipo da venda
          </label>
          <select
            id="tipo_venda"
            name="tipo_venda"
            defaultValue={valores?.tipo_venda ?? ''}
            aria-invalid={erro('tipo_venda') ? true : undefined}
            aria-describedby="tipo_venda-erro"
            className={inputClass}
          >
            <option value="">
              {fechamento.tipoVenda ? `Manter (${ROTULO_TIPO_VENDA[fechamento.tipoVenda]})` : 'Manter (não classificado)'}
            </option>
            {TIPOS_VENDA.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_VENDA[t]}
              </option>
            ))}
          </select>
          <ErroCampo id="tipo_venda-erro" mensagem={erro('tipo_venda')} />
        </div>

        <div>
          <label htmlFor="valor_vendido" className="mb-1.5 block text-sm font-medium">
            Valor vendido (R$)
          </label>
          <input
            id="valor_vendido"
            name="valor_vendido"
            inputMode="decimal"
            defaultValue={
              valores?.valor_vendido ??
              fechamento.valorVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
            }
            aria-invalid={erro('valor_vendido') ? true : undefined}
            aria-describedby="valor_vendido-erro"
            className={inputClass}
            autoFocus
          />
          <ErroCampo id="valor_vendido-erro" mensagem={erro('valor_vendido')} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="data_fechamento" className="mb-1.5 block text-sm font-medium">
            Data de fechamento
          </label>
          <input
            id="data_fechamento"
            name="data_fechamento"
            type="date"
            max={hoje}
            defaultValue={valores?.data_fechamento ?? fechamento.dataFechamento}
            aria-invalid={erro('data_fechamento') ? true : undefined}
            aria-describedby="data_fechamento-erro"
            className={inputClass}
          />
          <ErroCampo id="data_fechamento-erro" mensagem={erro('data_fechamento')} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <SimNao
          nome="contrato_enviado"
          rotulo="Contrato enviado?"
          valorInicial={valores?.contrato_enviado ?? (fechamento.contratoEnviado ? 'sim' : 'nao')}
          erro={erro('contrato_enviado')}
        />
        <SimNao
          nome="contrato_assinado"
          rotulo="Contrato assinado?"
          valorInicial={valores?.contrato_assinado ?? (fechamento.contratoAssinado ? 'sim' : 'nao')}
          erro={erro('contrato_assinado')}
        />
      </div>

      <div>
        <label htmlFor="link_contrato" className="mb-1.5 block text-sm font-medium">
          Link do contrato <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <input
          id="link_contrato"
          name="link_contrato"
          type="url"
          placeholder="https://"
          defaultValue={valores?.link_contrato ?? fechamento.linkContrato ?? ''}
          aria-invalid={erro('link_contrato') ? true : undefined}
          aria-describedby="link_contrato-erro"
          className={inputClass}
        />
        <ErroCampo id="link_contrato-erro" mensagem={erro('link_contrato')} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="status_pagamento" className="mb-1.5 block text-sm font-medium">
            Status do pagamento
          </label>
          <select
            id="status_pagamento"
            name="status_pagamento"
            defaultValue={valores?.status_pagamento ?? fechamento.statusPagamento}
            className={inputClass}
          >
            {STATUS_PAGAMENTO_FECHAMENTO.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS_PAGAMENTO[s]}
              </option>
            ))}
          </select>
          <ErroCampo id="status_pagamento-erro" mensagem={erro('status_pagamento')} />
        </div>

        <div>
          <label htmlFor="status_onboarding" className="mb-1.5 block text-sm font-medium">
            Status do onboarding
          </label>
          <select
            id="status_onboarding"
            name="status_onboarding"
            defaultValue={valores?.status_onboarding ?? fechamento.statusOnboarding}
            className={inputClass}
          >
            {STATUS_ONBOARDING.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS_ONBOARDING[s]}
              </option>
            ))}
          </select>
          <ErroCampo id="status_onboarding-erro" mensagem={erro('status_onboarding')} />
        </div>
      </div>

      <ListaServicos servicos={servicos} marcados={marcados} erro={erro('servico_ids')} legenda="Serviços contratados" />

      <div>
        <label htmlFor="observacoes" className="mb-1.5 block text-sm font-medium">
          Observações <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <textarea
          id="observacoes"
          name="observacoes"
          rows={3}
          maxLength={2000}
          defaultValue={valores?.observacoes ?? fechamento.observacoes ?? ''}
          aria-invalid={erro('observacoes') ? true : undefined}
          aria-describedby="observacoes-erro"
          className={inputClass}
        />
        <ErroCampo id="observacoes-erro" mensagem={erro('observacoes')} />
      </div>

      <BotoesModal pendente={pendente} rotulo="Salvar" onCancelar={onCancelar} />
    </form>
  )
}

/** Etapa perdida: o banco recusa qualquer alteração comercial — só leitura, igual à página /negociacoes/[id]/editar. */
function ResumoSomenteLeitura({ dados, onFechar }: { dados: NegociacaoEdicao; onFechar: () => void }) {
  const moeda = (v: number | null) => (v === null ? null : formatarMoeda(v))
  const dia = (d: string | null) => (d === null ? null : formatarDia(d))

  const itens: [string, React.ReactNode][] = [
    ['Valor estimado', moeda(dados.valorEstimado)],
    ['Temperatura', dados.temperatura && ROTULO_TEMPERATURA[dados.temperatura]],
    ['Primeira reunião', dia(dados.dataPrimeiraReuniao)],
    ['Data da proposta', dia(dados.dataProposta)],
    ['Valor da proposta', moeda(dados.valorProposta)],
    ['Forma de pagamento', dados.formaPagamento && ROTULO_FORMA_PAGAMENTO[dados.formaPagamento]],
  ]

  return (
    <div className="space-y-5">
      <p
        role="note"
        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
      >
        {NEGOCIACAO_ENCERRADA_MSG}
      </p>
      <dl className="grid gap-4 sm:grid-cols-2">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo}>
            <dt className="text-sm text-zinc-500">{rotulo}</dt>
            <dd className="mt-0.5 text-sm">{valor || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end border-t border-zinc-200 pt-5 dark:border-zinc-800">
        <BotaoFechar onClick={onFechar} />
      </div>
    </div>
  )
}

function ListaServicos({
  servicos,
  marcados,
  erro,
  legenda = 'Serviços',
}: {
  servicos: Servico[]
  marcados: Set<string>
  erro?: string
  legenda?: string
}) {
  return (
    <fieldset aria-describedby={erro ? 'servicos-erro' : undefined}>
      <legend className="mb-1.5 block text-sm font-medium">{legenda}</legend>
      {servicos.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum serviço cadastrado.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {servicos.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm has-checked:border-zinc-900 has-checked:bg-zinc-50 dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:bg-zinc-900"
            >
              <input
                type="checkbox"
                name="servico_ids"
                value={s.id}
                defaultChecked={marcados.has(s.id)}
                className="size-4 accent-zinc-900 dark:accent-zinc-100"
              />
              <span className="flex-1">{s.nome}</span>
              {!s.ativo && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  desativado
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      <ErroCampo id="servicos-erro" mensagem={erro} />
    </fieldset>
  )
}

/** Sim/Não com o valor atual pré-marcado — igual ao de `EditarFechamentoForm`. */
function SimNao({
  nome,
  rotulo,
  valorInicial,
  erro,
}: {
  nome: string
  rotulo: string
  valorInicial: string
  erro?: string
}) {
  return (
    <fieldset aria-describedby={`${nome}-erro`}>
      <legend className="mb-1.5 text-sm font-medium">{rotulo}</legend>
      <div className="flex gap-2">
        {(['sim', 'nao'] as const).map((v) => (
          <label
            key={v}
            className="flex flex-1 cursor-pointer items-center justify-center rounded-md border border-zinc-300 px-3 py-2 text-sm has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:bg-zinc-100 dark:has-checked:text-zinc-900"
          >
            <input
              type="radio"
              name={nome}
              value={v}
              defaultChecked={valorInicial === v}
              className="sr-only"
            />
            {v === 'sim' ? 'Sim' : 'Não'}
          </label>
        ))}
      </div>
      <ErroCampo id={`${nome}-erro`} mensagem={erro} />
    </fieldset>
  )
}
