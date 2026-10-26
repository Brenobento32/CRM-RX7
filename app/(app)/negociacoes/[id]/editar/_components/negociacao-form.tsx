'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass, botaoFantasmaClass, opcaoClass, caixaErroClass, legendaClass } from '@/components/ui/estilos'
import type { EstadoFormNegociacao } from '@/lib/actions/negociacoes'
import type { Servico } from '@/lib/dal/servicos'
import {
  FORMAS_PAGAMENTO,
  ROTULO_FORMA_PAGAMENTO,
  ROTULO_TEMPERATURA,
  TEMPERATURAS,
  type CampoEdicaoNegociacao,
} from '@/lib/validations/negociacao'

type Valores = NonNullable<EstadoFormNegociacao['valores']>

type Props = {
  action: (estado: EstadoFormNegociacao | undefined, formData: FormData) => Promise<EstadoFormNegociacao>
  valoresIniciais: Valores
  /** Ativos + desativados que já estão nesta negociação. */
  servicos: Servico[]
  cancelarHref: string
}


export function NegociacaoForm({ action, valoresIniciais, servicos, cancelarHref }: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: CampoEdicaoNegociacao) => estado?.campos?.[campo]?.[0]
  const marcados = new Set(valores.servico_ids ?? [])

  return (
    <form action={formAction} noValidate className="space-y-8">
      {estado?.erro && (
        <div
          role="alert"
          className={caixaErroClass}
        >
          {estado.erro}
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className={legendaClass}>Qualificação</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="valor_estimado" rotulo="Valor estimado (R$)" erro={erro('valor_estimado')}>
            <input
              id="valor_estimado"
              name="valor_estimado"
              inputMode="decimal"
              placeholder="15.000,00"
              defaultValue={valores.valor_estimado}
              aria-invalid={erro('valor_estimado') ? true : undefined}
              className={inputClass}
            />
          </Campo>

          <Campo id="temperatura" rotulo="Temperatura" erro={erro('temperatura')}>
            <select id="temperatura" name="temperatura" defaultValue={valores.temperatura} className={inputClass}>
              <option value="">Não avaliada</option>
              {TEMPERATURAS.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TEMPERATURA[t]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="data_primeira_reuniao" rotulo="Primeira reunião" erro={erro('data_primeira_reuniao')}>
            <input
              id="data_primeira_reuniao"
              name="data_primeira_reuniao"
              type="date"
              defaultValue={valores.data_primeira_reuniao}
              aria-invalid={erro('data_primeira_reuniao') ? true : undefined}
              className={inputClass}
            />
          </Campo>

          <Campo id="data_proposta" rotulo="Data da proposta" erro={erro('data_proposta')}>
            <input
              id="data_proposta"
              name="data_proposta"
              type="date"
              defaultValue={valores.data_proposta}
              aria-invalid={erro('data_proposta') ? true : undefined}
              className={inputClass}
            />
          </Campo>
        </div>

        <Campo id="objecao_principal" rotulo="Objeção principal" erro={erro('objecao_principal')}>
          <textarea
            id="objecao_principal"
            name="objecao_principal"
            rows={3}
            maxLength={2000}
            defaultValue={valores.objecao_principal}
            aria-invalid={erro('objecao_principal') ? true : undefined}
            className={inputClass}
          />
        </Campo>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className={legendaClass}>Proposta</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="valor_proposta" rotulo="Valor da proposta (R$)" erro={erro('valor_proposta')}>
            <input
              id="valor_proposta"
              name="valor_proposta"
              inputMode="decimal"
              placeholder="12.000,00"
              defaultValue={valores.valor_proposta}
              aria-invalid={erro('valor_proposta') ? true : undefined}
              className={inputClass}
            />
          </Campo>

          <Campo id="forma_pagamento" rotulo="Forma de pagamento" erro={erro('forma_pagamento')}>
            <select
              id="forma_pagamento"
              name="forma_pagamento"
              defaultValue={valores.forma_pagamento}
              className={inputClass}
            >
              <option value="">Não definida</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FORMA_PAGAMENTO[f]}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </fieldset>

      <fieldset className="space-y-4" aria-describedby={erro('servico_ids') ? 'servicos-erro' : undefined}>
        <legend className={legendaClass}>Serviços</legend>

        {servicos.length === 0 ? (
          <p className="text-sm text-premium-mudo">Nenhum serviço cadastrado. O administrador cadastra em Configurações → Serviços.</p>
        ) : (
          agrupar(servicos).map(([categoria, lista]) => (
            <div key={categoria ?? ''} className="space-y-2">
              {categoria && <p className="text-xs font-medium uppercase tracking-wide text-premium-mudo">{categoria}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {lista.map((s) => (
                  <label
                    key={s.id}
                    className={opcaoClass}
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
                      <span
                        title="Desmarcado, não poderá ser marcado de novo."
                        className="rounded bg-premium-bg px-1.5 py-0.5 text-xs text-premium-secundario"
                      >
                        desativado
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
        <ErroCampo id="servicos-erro" mensagem={erro('servico_ids')} />
      </fieldset>

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

function Campo({
  id,
  rotulo,
  erro,
  children,
}: {
  id: string
  rotulo: string
  erro?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {rotulo}
      </label>
      {children}
      <ErroCampo mensagem={erro} />
    </div>
  )
}

/** Mantém a ordem recebida (categoria, nome); sem categoria por último. */
function agrupar(servicos: Servico[]): [string | null, Servico[]][] {
  const grupos = new Map<string | null, Servico[]>()
  for (const s of servicos) {
    grupos.set(s.categoria, [...(grupos.get(s.categoria) ?? []), s])
  }
  return [...grupos]
}
