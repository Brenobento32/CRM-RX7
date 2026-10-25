'use client'

import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass } from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { ResponsavelAgenda } from '@/lib/dal/eventos'
import { responsaveisElegiveis } from '@/lib/utils/agenda'

const ROTULO_PAPEL: Record<ResponsavelAgenda['role'], string> = {
  gerente: 'Gerente',
  closer: 'Closer',
  sdr: 'SDR',
}

function Ponto({ cor }: { cor: ResponsavelAgenda['cor'] }) {
  return cor ? (
    <PontoEtapa cor={cor} />
  ) : (
    <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full border border-dashed border-zinc-400" />
  )
}

/**
 * Responsável pela reunião, entre os usuários ativos da própria empresa.
 *
 * - Gerente: escolhe qualquer pessoa da equipe. Se a reunião estiver ligada a
 *   um cliente (aberta pela ficha do cliente), só quem enxerga esse cliente —
 *   o dono da carteira ou um gerente — mesma regra do banco
 *   (`agenda_valida_responsavel`).
 * - Closer/SDR: sempre ele mesmo (a RLS não deixa agendar para outra pessoa).
 */
export function CampoResponsavel({
  souGerente,
  eu,
  responsaveis,
  ownerId,
  valor,
  onChange,
  erro,
}: {
  souGerente: boolean
  eu: ResponsavelAgenda
  responsaveis: ResponsavelAgenda[]
  /** Dono do cliente vinculado, quando houver. */
  ownerId: string | undefined
  valor: string
  onChange: (id: string) => void
  erro?: string
}) {
  if (!souGerente) {
    return (
      <div>
        <p className="mb-1.5 text-sm font-medium">Responsável</p>
        <p className="flex items-center gap-2 text-sm">
          <Ponto cor={eu.cor} />
          Você ({eu.nome})
        </p>
        <input type="hidden" name="usuario_id" value={eu.id} />
      </div>
    )
  }

  const elegiveis = ownerId ? responsaveisElegiveis(responsaveis, ownerId) : responsaveis
  const escolhido = elegiveis.find((r) => r.id === valor)

  return (
    <div>
      <label htmlFor="usuario_id" className="mb-1.5 block text-sm font-medium">
        Responsável
      </label>
      <div className="flex items-center gap-2">
        {escolhido && <Ponto cor={escolhido.cor} />}
        <select
          id="usuario_id"
          name="usuario_id"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={erro ? true : undefined}
          className={inputClass}
        >
          {elegiveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id === eu.id ? `${r.nome} (você)` : r.nome} · {ROTULO_PAPEL[r.role]}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        {ownerId
          ? 'Reunião ligada a um cliente: só o dono da carteira ou um gerente.'
          : 'Qualquer usuário ativo da sua empresa. A cor da reunião é a do responsável.'}
      </p>
      <ErroCampo mensagem={erro} />
    </div>
  )
}
