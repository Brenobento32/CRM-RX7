'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass, botaoFantasmaClass, caixaErroClass, caixaAlertaClass } from '@/components/ui/estilos'
import type { EstadoFormFechamento } from '@/lib/actions/negociacoes'
import type { FechamentoEdicao } from '@/lib/dal/negociacoes'
import type { Servico } from '@/lib/dal/servicos'
import { CampoTipoVenda, CamposComplementaresFechamento, ROTULOS_CAMPOS_FECHAMENTO, valoresIniciaisFechamento } from '@/components/funil/campos-fechamento'
import { ResumoErros } from '@/components/ui/resumo-erros'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
import type { RegrasFechamento } from '@/lib/validations/funil'

type Props = {
  action: (estado: EstadoFormFechamento | undefined, formData: FormData) => Promise<EstadoFormFechamento>
  fechamento: FechamentoEdicao
  /** Serviços já vinculados à negociação (`negociacao_servicos`), pra pré-marcar. */
  servicoIdsAtuais: string[]
  servicos: Servico[]
  /** Regras comerciais da empresa (tipos de venda e itens do fechamento). */
  regras: RegrasFechamento
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
  regras,
  cancelarHref,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]
  const hoje = hojeSaoPaulo()

  if (fechamento.anuladoEm) {
    return (
      <div
        role="alert"
        className={`${caixaAlertaClass} space-y-2`}
      >
        <p className="font-medium">Este fechamento foi anulado — não conta mais em TCV/MRR/metas/realizado.</p>
        {fechamento.motivoAnulacao && <p>Motivo: {fechamento.motivoAnulacao}</p>}
        <p className="text-amber-800 dark:text-amber-300">
          Não é possível editá-lo por aqui. Reativação ainda não é um fluxo disponível.
        </p>
        <Link href={cancelarHref} className="inline-block font-medium underline">
          Voltar
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} noValidate className="space-y-6">
      {estado?.erro && (
        <div
          role="alert"
          className={caixaErroClass}
        >
          {estado.erro}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <CampoTipoVenda regras={regras} modo="edicao" tipoAtual={fechamento.tipoVenda} valor={valores?.tipo_venda} erro={erro('tipo_venda')} />

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

      <CamposComplementaresFechamento
        regras={regras}
        valores={valoresIniciaisFechamento(fechamento, valores)}
        servicos={servicos}
        servicoIdsAtuais={servicoIdsAtuais}
        erro={erro}
      />

      <ResumoErros campos={estado?.campos} rotulos={ROTULOS_CAMPOS_FECHAMENTO} erro={estado?.erro} />

      <div className="flex items-center gap-3 border-t border-premium-borda pt-6">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
        <Link
          href={cancelarHref}
          className={botaoFantasmaClass}
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
