'use client'

import { useState } from 'react'

import { inputClass, labelClass } from '@/components/ui/estilos'

export type OpcoesDestino = { funis: { id: string; nome: string; etapas: { id: string; nome: string; inicial: boolean }[] }[] }
export type Destino = { funilId: string; etapaId: string; responsavelId: string }

/**
 * Funil → etapa de entrada (só etapas abertas DESSE funil) → responsável.
 * As listas vêm do servidor já restritas à empresa da aba; o banco confere de
 * novo (funil/etapa da empresa, etapa do funil, responsável ativo, não Super Admin).
 * Dentro de um <form>, envia `destino` ("funil|etapa") e `responsavel_id`.
 */
export function SeletorDestino({
  opcoes,
  responsaveis,
  inicial,
  onChange,
  compacto = false,
}: {
  opcoes: OpcoesDestino
  responsaveis: { id: string; nome: string }[]
  inicial?: Partial<Destino>
  onChange?: (d: Destino) => void
  compacto?: boolean
}) {
  const etapaPadrao = (funilId: string) => {
    const f = opcoes.funis.find((x) => x.id === funilId)
    return f?.etapas.find((e) => e.inicial)?.id ?? f?.etapas[0]?.id ?? ''
  }
  const [funilId, setFunil] = useState(inicial?.funilId ?? opcoes.funis[0]?.id ?? '')
  const [etapaId, setEtapa] = useState(inicial?.etapaId ?? etapaPadrao(inicial?.funilId ?? opcoes.funis[0]?.id ?? ''))
  const [responsavelId, setResponsavel] = useState(inicial?.responsavelId ?? '')
  const funil = opcoes.funis.find((f) => f.id === funilId)

  const avisar = (d: Partial<Destino>) => onChange?.({ funilId, etapaId, responsavelId, ...d })

  if (opcoes.funis.length === 0) {
    return <p className="text-sm text-premium-secundario">Nenhum funil ativo com etapa aberta nesta empresa. Crie um funil em CRM › Configurações › Etapas.</p>
  }

  return (
    <div className={`grid gap-3 ${compacto ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      <label className="block text-sm">
        <span className={labelClass}>Funil</span>
        <select
          className={inputClass}
          value={funilId}
          onChange={(e) => {
            const etapa = etapaPadrao(e.target.value)
            setFunil(e.target.value)
            setEtapa(etapa)
            avisar({ funilId: e.target.value, etapaId: etapa })
          }}
        >
          {opcoes.funis.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className={labelClass}>Etapa de entrada</span>
        <select
          className={inputClass}
          value={etapaId}
          onChange={(e) => {
            setEtapa(e.target.value)
            avisar({ etapaId: e.target.value })
          }}
        >
          {(funil?.etapas ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
              {e.inicial ? ' (inicial)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className={`block text-sm ${compacto ? '' : 'sm:col-span-2'}`}>
        <span className={labelClass}>Responsável pelos leads novos</span>
        <select
          className={inputClass}
          value={responsavelId}
          required
          onChange={(e) => {
            setResponsavel(e.target.value)
            avisar({ responsavelId: e.target.value })
          }}
        >
          <option value="" disabled>
            Escolha…
          </option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="destino" value={funilId && etapaId ? `${funilId}|${etapaId}` : ''} />
      <input type="hidden" name="responsavel_id" value={responsavelId} />
    </div>
  )
}
