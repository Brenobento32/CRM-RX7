'use client'

import { ErroCampo } from '@/components/ui/erro-campo'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { ResponsavelAgenda } from '@/lib/dal/eventos'
import { responsaveisElegiveis } from '@/lib/utils/agenda'

const opcaoClass =
  'flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-focus-visible:ring-2 has-focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:ring-zinc-100'

function Ponto({ cor }: { cor: ResponsavelAgenda['cor'] }) {
  return cor ? (
    <PontoEtapa cor={cor} />
  ) : (
    <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full border border-dashed border-zinc-400" />
  )
}

/**
 * Gerente: radios com os responsáveis possíveis para o cliente escolhido.
 * Closer: sempre ele mesmo — o campo nem vai no formulário (o servidor usa
 * o usuário logado).
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
      </div>
    )
  }

  const elegiveis = responsaveisElegiveis(responsaveis, ownerId)

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Responsável</legend>
      {!ownerId ? (
        <p className="text-sm text-zinc-500">Escolha o cliente para ver quem pode ser responsável.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {elegiveis.map((r) => (
            <label key={r.id} className={opcaoClass}>
              <input
                type="radio"
                name="usuario_id"
                value={r.id}
                checked={valor === r.id}
                onChange={() => onChange(r.id)}
                className="sr-only"
              />
              <Ponto cor={r.cor} />
              {r.nome}
              <span className="text-xs text-zinc-500">
                {r.id === ownerId ? '(dono do cliente)' : '(gerente)'}
              </span>
            </label>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-xs text-zinc-500">
        Só quem tem acesso ao cliente: o dono da carteira ou um gerente. A cor do evento é a do responsável.
      </p>
      <ErroCampo mensagem={erro} />
    </fieldset>
  )
}
