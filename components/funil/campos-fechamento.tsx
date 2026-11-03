'use client'

import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass, opcaoClass } from '@/components/ui/estilos'
import type { Servico } from '@/lib/dal/servicos'
import type { RegraCampo } from '@/lib/utils/regras-comerciais'
import {
  ROTULO_STATUS_ONBOARDING,
  ROTULO_STATUS_PAGAMENTO,
  ROTULO_TIPO_VENDA,
  STATUS_ONBOARDING,
  STATUS_PAGAMENTO_FECHAMENTO,
  TIPOS_VENDA,
  type RegrasFechamento,
} from '@/lib/validations/funil'

type TipoVenda = (typeof TIPOS_VENDA)[number]

/** Valores iniciais (edição) ou devolvidos pela Server Action depois de um erro. */
export type ValoresFechamento = {
  tipo_venda?: string
  contrato_enviado?: string
  contrato_assinado?: string
  link_contrato?: string | null
  status_pagamento?: string | null
  status_onboarding?: string | null
  servico_ids?: string[]
  observacoes?: string | null
}

const opcional = <span className="font-normal text-premium-mudo">(opcional)</span>

function Rotulo({ htmlFor, regra, children }: { htmlFor?: string; regra: RegraCampo; children: React.ReactNode }) {
  const Tag = htmlFor ? 'label' : 'span'
  return (
    <Tag {...(htmlFor ? { htmlFor } : {})} className="mb-1.5 block text-sm font-medium">
      {children} {regra === 'opcional' && opcional}
      {regra === 'confirmar' && <span className="font-normal text-premium-mudo">(precisa ser Sim)</span>}
    </Tag>
  )
}

/**
 * Tipo da venda entre os liberados para a empresa. Fechamento novo: escolha
 * obrigatória, sem pré-marcar (com um tipo só, ele já vem escolhido).
 * Edição: "Manter" o tipo gravado (nunca reclassifica sozinho).
 */
export function CampoTipoVenda({
  regras,
  modo,
  tipoAtual,
  valor,
  erro,
}: {
  regras: RegrasFechamento
  modo: 'novo' | 'edicao'
  tipoAtual?: TipoVenda | null
  valor?: string
  erro?: string
}) {
  const tipos = TIPOS_VENDA.filter((t) => (regras.tiposVenda as readonly string[]).includes(t))
  if (modo === 'edicao') {
    return (
      <div>
        <label htmlFor="tipo_venda" className="mb-1.5 block text-sm font-medium">
          Tipo da venda
        </label>
        <select
          id="tipo_venda"
          name="tipo_venda"
          defaultValue={valor ?? ''}
          aria-invalid={erro ? true : undefined}
          aria-describedby="tipo_venda-erro"
          className={inputClass}
        >
          <option value="">{tipoAtual ? `Manter (${ROTULO_TIPO_VENDA[tipoAtual]})` : 'Manter (não classificado)'}</option>
          {tipos.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO_VENDA[t]}
            </option>
          ))}
        </select>
        <ErroCampo id="tipo_venda-erro" mensagem={erro} />
      </div>
    )
  }
  if (tipos.length === 1) {
    return (
      <div>
        <input type="hidden" name="tipo_venda" value={tipos[0]} />
        <p className="text-sm">
          <span className="font-medium">Tipo da venda:</span> {ROTULO_TIPO_VENDA[tipos[0]]}
        </p>
        <ErroCampo id="tipo_venda-erro" mensagem={erro} />
      </div>
    )
  }
  return (
    <fieldset id="tipo_venda" aria-describedby="tipo_venda-erro">
      <legend className="mb-1.5 text-sm font-medium">Tipo da venda</legend>
      <div className="flex gap-2">
        {tipos.map((v) => (
          <label key={v} className={`${opcaoClass} flex-1 justify-center`}>
            <input type="radio" name="tipo_venda" value={v} defaultChecked={valor === v} className="sr-only" />
            {ROTULO_TIPO_VENDA[v]}
          </label>
        ))}
      </div>
      <ErroCampo id="tipo_venda-erro" mensagem={erro} />
    </fieldset>
  )
}

function SimNao({ nome, rotulo, regra, valorInicial, erro }: { nome: string; rotulo: string; regra: RegraCampo; valorInicial?: string; erro?: string }) {
  return (
    <fieldset id={nome} aria-describedby={`${nome}-erro`}>
      <legend className="mb-1.5 text-sm font-medium">
        {rotulo} {regra === 'opcional' && opcional}
        {regra === 'confirmar' && <span className="font-normal text-premium-mudo">(precisa ser Sim)</span>}
      </legend>
      <div className="flex gap-2">
        {(['sim', 'nao'] as const).map((v) => (
          <label key={v} className={`${opcaoClass} flex-1 justify-center`}>
            <input type="radio" name={nome} value={v} defaultChecked={valorInicial === v} className="sr-only" />
            {v === 'sim' ? 'Sim' : 'Não'}
          </label>
        ))}
      </div>
      <ErroCampo id={`${nome}-erro`} mensagem={erro} />
    </fieldset>
  )
}

/**
 * Itens do fechamento além de tipo, valor e data — cada um conforme a regra da
 * empresa: oculto (não aparece e não é enviado), opcional, obrigatório ou
 * "precisa ser Sim". Serviços ocultos seguem como estão (campos escondidos com
 * os atuais), para o fechamento nunca desvincular nada sem querer.
 */
export function CamposComplementaresFechamento({
  regras,
  valores,
  servicos,
  servicoIdsAtuais,
  erro,
}: {
  regras: RegrasFechamento
  valores?: ValoresFechamento
  servicos: Servico[]
  servicoIdsAtuais: string[]
  erro: (campo: string) => string | undefined
}) {
  const c = regras.campos
  const marcados = new Set(valores?.servico_ids ?? servicoIdsAtuais)
  const mostrarContrato = c.contrato_enviado !== 'oculto' || c.contrato_assinado !== 'oculto'
  const mostrarStatus = c.status_pagamento !== 'oculto' || c.status_onboarding !== 'oculto'

  return (
    <>
      {mostrarContrato && (
        <div className="grid gap-5 sm:grid-cols-2">
          {c.contrato_enviado !== 'oculto' && (
            <SimNao nome="contrato_enviado" rotulo="Contrato enviado?" regra={c.contrato_enviado} valorInicial={valores?.contrato_enviado} erro={erro('contrato_enviado')} />
          )}
          {c.contrato_assinado !== 'oculto' && (
            <SimNao nome="contrato_assinado" rotulo="Contrato assinado?" regra={c.contrato_assinado} valorInicial={valores?.contrato_assinado} erro={erro('contrato_assinado')} />
          )}
        </div>
      )}

      {c.link_contrato !== 'oculto' && (
        <div>
          <Rotulo htmlFor="link_contrato" regra={c.link_contrato}>
            Link do contrato
          </Rotulo>
          <input
            id="link_contrato"
            name="link_contrato"
            type="url"
            placeholder="https://"
            defaultValue={valores?.link_contrato ?? ''}
            aria-invalid={erro('link_contrato') ? true : undefined}
            aria-describedby="link_contrato-erro"
            className={inputClass}
          />
          <ErroCampo id="link_contrato-erro" mensagem={erro('link_contrato')} />
        </div>
      )}

      {mostrarStatus && (
        <div className="grid gap-5 sm:grid-cols-2">
          {c.status_pagamento !== 'oculto' && (
            <div>
              <Rotulo htmlFor="status_pagamento" regra={c.status_pagamento}>
                Status do pagamento
              </Rotulo>
              <select
                id="status_pagamento"
                name="status_pagamento"
                defaultValue={valores?.status_pagamento ?? ''}
                aria-invalid={erro('status_pagamento') ? true : undefined}
                aria-describedby="status_pagamento-erro"
                className={inputClass}
              >
                <option value="" disabled={c.status_pagamento !== 'opcional'}>
                  {c.status_pagamento === 'opcional' ? 'Não informar' : 'Selecione…'}
                </option>
                {STATUS_PAGAMENTO_FECHAMENTO.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS_PAGAMENTO[s]}
                  </option>
                ))}
              </select>
              <ErroCampo id="status_pagamento-erro" mensagem={erro('status_pagamento')} />
            </div>
          )}
          {c.status_onboarding !== 'oculto' && (
            <div>
              <Rotulo htmlFor="status_onboarding" regra={c.status_onboarding}>
                Status do onboarding
              </Rotulo>
              <select
                id="status_onboarding"
                name="status_onboarding"
                defaultValue={valores?.status_onboarding ?? ''}
                aria-invalid={erro('status_onboarding') ? true : undefined}
                aria-describedby="status_onboarding-erro"
                className={inputClass}
              >
                <option value="" disabled={c.status_onboarding !== 'opcional'}>
                  {c.status_onboarding === 'opcional' ? 'Não informar' : 'Selecione…'}
                </option>
                {STATUS_ONBOARDING.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS_ONBOARDING[s]}
                  </option>
                ))}
              </select>
              <ErroCampo id="status_onboarding-erro" mensagem={erro('status_onboarding')} />
            </div>
          )}
        </div>
      )}

      {c.servicos === 'oculto' ? (
        [...marcados].map((id) => <input key={id} type="hidden" name="servico_ids" value={id} />)
      ) : (
        <fieldset id="servico_ids" aria-describedby={erro('servico_ids') ? 'servicos-erro' : undefined}>
          <legend className="mb-1.5 block text-sm font-medium">
            Serviços contratados {c.servicos === 'opcional' && opcional}
          </legend>
          {servicos.length === 0 ? (
            <p className="text-sm text-premium-mudo">Nenhum serviço cadastrado. O administrador cadastra em Configurações → Serviços.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {servicos.map((s) => (
                <label key={s.id} className={opcaoClass}>
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
      )}

      {c.observacoes !== 'oculto' && (
        <div>
          <Rotulo htmlFor="observacoes" regra={c.observacoes}>
            Observações
          </Rotulo>
          <textarea
            id="observacoes"
            name="observacoes"
            rows={3}
            maxLength={2000}
            defaultValue={valores?.observacoes ?? ''}
            placeholder="Condições combinadas, ressalvas…"
            aria-invalid={erro('observacoes') ? true : undefined}
            aria-describedby="observacoes-erro"
            className={inputClass}
          />
          <ErroCampo id="observacoes-erro" mensagem={erro('observacoes')} />
        </div>
      )}
    </>
  )
}

/** Rótulos dos campos do fechamento para o resumo de erros perto do botão. */
export const ROTULOS_CAMPOS_FECHAMENTO: Record<string, string> = {
  tipo_venda: 'Tipo da venda',
  valor_vendido: 'Valor vendido',
  data_fechamento: 'Data de fechamento',
  contrato_enviado: 'Contrato enviado',
  contrato_assinado: 'Contrato assinado',
  link_contrato: 'Link do contrato',
  status_pagamento: 'Status do pagamento',
  status_onboarding: 'Status do onboarding',
  servico_ids: 'Serviços contratados',
  observacoes: 'Observações',
}

const simNaoDe = (v: boolean | null) => (v === null ? '' : v ? 'sim' : 'nao')

/**
 * Valores iniciais da edição: o que a Server Action devolveu depois de um erro
 * (nada se perde) ou, na primeira abertura, o fechamento gravado.
 */
export function valoresIniciaisFechamento(
  fechamento: {
    contratoEnviado: boolean | null
    contratoAssinado: boolean | null
    linkContrato: string | null
    statusPagamento: string | null
    statusOnboarding: string | null
    observacoes: string | null
  },
  valores?: Partial<Record<keyof ValoresFechamento, string | string[] | null | undefined>>,
): ValoresFechamento {
  const texto = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return {
    contrato_enviado: texto(valores?.contrato_enviado) ?? simNaoDe(fechamento.contratoEnviado),
    contrato_assinado: texto(valores?.contrato_assinado) ?? simNaoDe(fechamento.contratoAssinado),
    link_contrato: texto(valores?.link_contrato) ?? fechamento.linkContrato,
    status_pagamento: texto(valores?.status_pagamento) ?? fechamento.statusPagamento,
    status_onboarding: texto(valores?.status_onboarding) ?? fechamento.statusOnboarding,
    servico_ids: Array.isArray(valores?.servico_ids) ? valores.servico_ids : undefined,
    observacoes: texto(valores?.observacoes) ?? fechamento.observacoes,
  }
}
