'use client'

import { useActionState } from 'react'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { ajudaClass, botaoSecundarioClass, caixaErroClass, caixaSucessoClass, inputClass, labelClass } from '@/components/ui/estilos'
import type { EstadoOposicaoMedicao } from '@/lib/actions/clientes'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'
import { CANAIS_OPOSICAO, ROTULO_CANAL_OPOSICAO, type CanalOposicao } from '@/lib/validations/oposicao-medicao'

type Props = {
  registradaEm: string | null
  canal: CanalOposicao | null
  action: (estado: EstadoOposicaoMedicao | undefined, formData: FormData) => Promise<EstadoOposicaoMedicao>
}

/**
 * Oposição do titular à medição de anúncios (Meta). Só o Administrador vê.
 * Registrada, nenhum evento das negociações deste cliente sai mais; o que a
 * Meta já recebeu não volta. Não se desfaz pela tela.
 */
export function OposicaoMedicao({ registradaEm, canal, action }: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)

  if (registradaEm) {
    return (
      <p className="text-sm text-premium-texto">
        Oposição registrada em {formatarDataHoraCompleta(registradaEm)}
        {canal ? ` (pedido por ${ROTULO_CANAL_OPOSICAO[canal].toLowerCase()})` : ''}. Nenhum evento deste cliente é enviado à Meta.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <p className={ajudaClass}>
        Use quando o titular pedir para não ter o atendimento usado na medição dos anúncios. A partir do registro, nenhum
        evento deste cliente sai para a Meta. O que já foi enviado não é desfeito.
      </p>
      <div>
        <label htmlFor="oposicao-canal" className={labelClass}>
          Canal do pedido
        </label>
        <select id="oposicao-canal" name="canal" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Escolha…
          </option>
          {CANAIS_OPOSICAO.map((c) => (
            <option key={c} value={c}>
              {ROTULO_CANAL_OPOSICAO[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="oposicao-observacao" className={labelClass}>
          Observação (opcional)
        </label>
        <input id="oposicao-observacao" name="observacao" maxLength={300} className={inputClass} placeholder="Ex.: pedido recebido no suporte em 10/11" />
        <p className={ajudaClass}>Não escreva dados pessoais aqui.</p>
      </div>
      <BotaoConfirmar
        pergunta="Registrar a oposição deste titular? Nenhum evento dele será enviado à Meta, e o registro não se desfaz pela tela."
        className={botaoSecundarioClass}
      >
        {pendente ? 'Registrando…' : 'Registrar oposição'}
      </BotaoConfirmar>
      {estado?.erro && (
        <p role="alert" className={caixaErroClass}>
          {estado.erro}
        </p>
      )}
      {estado?.ok && <p className={caixaSucessoClass}>Oposição registrada.</p>}
    </form>
  )
}
