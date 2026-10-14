'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormFechamento } from '@/lib/actions/negociacoes'
import type { FechamentoEdicao } from '@/lib/dal/negociacoes'
import type { Servico } from '@/lib/dal/servicos'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
import {
  ROTULO_STATUS_ONBOARDING,
  ROTULO_STATUS_PAGAMENTO,
  ROTULO_TIPO_VENDA,
  STATUS_ONBOARDING,
  STATUS_PAGAMENTO_FECHAMENTO,
  TIPOS_VENDA,
} from '@/lib/validations/funil'

type Props = {
  action: (estado: EstadoFormFechamento | undefined, formData: FormData) => Promise<EstadoFormFechamento>
  fechamento: FechamentoEdicao
  /** Serviços já vinculados à negociação (`negociacao_servicos`), pra pré-marcar. */
  servicoIdsAtuais: string[]
  servicos: Servico[]
  cancelarHref: string
}

/**
 * Edição de um fechamento já existente — mesmos campos de `ModalFechamento`,
 * como página em vez de modal (a negociação já está em `ganha`, não há
 * "mover pra etapa" nem `posicao` aqui). `atualizarFechamentoAction` nunca
 * toca `negociacoes` nem `fechado_em`/`fechado_por`.
 */
export function EditarFechamentoForm({
  action,
  fechamento,
  servicoIdsAtuais,
  servicos,
  cancelarHref,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]
  const marcados = new Set(valores?.servico_ids ?? servicoIdsAtuais)
  const hoje = hojeSaoPaulo()

  return (
    <form action={formAction} noValidate className="space-y-6">
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

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
            aria-invalid={erro('status_pagamento') ? true : undefined}
            aria-describedby="status_pagamento-erro"
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
            aria-invalid={erro('status_onboarding') ? true : undefined}
            aria-describedby="status_onboarding-erro"
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

      <fieldset aria-describedby={erro('servico_ids') ? 'servicos-erro' : undefined}>
        <legend className="mb-1.5 block text-sm font-medium">Serviços contratados</legend>
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
              </label>
            ))}
          </div>
        )}
        <ErroCampo id="servicos-erro" mensagem={erro('servico_ids')} />
      </fieldset>

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

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
        <Link
          href={cancelarHref}
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}

/** Sim/Não com o valor atual pré-marcado (diferente do modal de fechamento novo, que nunca tem valor prévio). */
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
