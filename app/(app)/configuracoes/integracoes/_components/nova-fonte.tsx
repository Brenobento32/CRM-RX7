'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { botaoPrimarioClass, inputClass, caixaErroClass, caixaSucessoClass } from '@/components/ui/estilos'
import { criarFonteAction, type EstadoToken } from '@/lib/actions/fontes-leads'
import type { OpcoesFonte } from '@/lib/dal/fontes-leads'
import { CATALOGO, TIPOS_FONTE, type TipoFonte } from '@/lib/integracoes/catalogo'

import { CamposFonte } from './campos-fonte'
import { TokenUmaVez } from './token-uma-vez'

export function NovaFonte({ opcoes, responsaveis }: { opcoes: OpcoesFonte; responsaveis: { id: string; nome: string }[] }) {
  const [tipo, setTipo] = useState<TipoFonte>('formulario_rx7')
  const [estado, acao, enviando] = useActionState<EstadoToken, FormData>(criarFonteAction, {})

  if (estado.id) {
    return (
      <div className="space-y-3">
        <p role="status" className={caixaSucessoClass}>Fonte criada.</p>
        {estado.token && <TokenUmaVez token={estado.token} />}
        <Link href={`/configuracoes/integracoes/${estado.id}`} className="text-sm font-medium text-premium-acento hover:underline">
          Ver instruções de conexão
        </Link>
      </div>
    )
  }

  return (
    <form action={acao} className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">Tipo</span>
        <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoFonte)} className={inputClass}>
          {TIPOS_FONTE.map((t) => (
            <option key={t} value={t}>
              {CATALOGO.find((i) => i.tipo === t)?.nome}
            </option>
          ))}
        </select>
      </label>
      <CamposFonte key={tipo} tipo={tipo} opcoes={opcoes} responsaveis={responsaveis} />
      {estado.erro && <p role="alert" className={`${caixaErroClass} sm:col-span-2`}>{estado.erro}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={enviando} className={botaoPrimarioClass}>
          {enviando ? 'Criando…' : 'Criar fonte'}
        </button>
      </div>
    </form>
  )
}
