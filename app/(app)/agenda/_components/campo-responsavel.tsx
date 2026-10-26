'use client'

import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass } from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { ResponsavelAgenda } from '@/lib/dal/eventos'
import { responsaveisElegiveis } from '@/lib/utils/agenda'
import { CARGOS_QUE_AGENDAM_PARA_CLOSER, ROTULO_CARGO } from '@/lib/validations/usuario'

const ROTULO_PAPEL: Record<ResponsavelAgenda['role'], string> = ROTULO_CARGO

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
 * - SDR/Atendente: ele mesmo ou um Closer ativo da empresa (o banco recusa
 *   qualquer outro cargo ou empresa).
 * - Vendedor/Closer: sempre ele mesmo.
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
  const agendaParaCloser = !souGerente && CARGOS_QUE_AGENDAM_PARA_CLOSER.includes(eu.role) && responsaveis.length > 1
  if (!souGerente && !agendaParaCloser) {
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

  const elegiveis = souGerente && ownerId ? responsaveisElegiveis(responsaveis, ownerId) : responsaveis
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
          {!escolhido && <option value="">Selecione o responsável…</option>}
          {elegiveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id === eu.id ? `${r.nome} (você)` : r.nome} · {ROTULO_PAPEL[r.role]}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1.5 text-xs text-premium-mudo">
        {agendaParaCloser
          ? 'Você ou um Closer ativo da sua empresa. O aviso de conflito usa a agenda dele (só horários).'
          : ownerId
            ? 'Reunião ligada a um cliente: só o dono da carteira ou um administrador.'
            : 'Qualquer usuário ativo da sua empresa. A cor da reunião é a do responsável.'}
      </p>
      <ErroCampo mensagem={erro} />
    </div>
  )
}
