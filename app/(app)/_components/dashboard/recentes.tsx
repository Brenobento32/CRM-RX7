import Link from 'next/link'

import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { AtividadeRecente, Movimentacao } from '@/lib/dal/dashboard'
import { formatarDataHora } from '@/lib/utils/formatacao'
import { ROTULO_TIPO_ATIVIDADE } from '@/lib/validations/atividade'

function LinkCliente({ id, nome }: { id: string | null; nome: string | null }) {
  if (!id || !nome) return <span className="text-premium-mudo">Cliente</span>
  return (
    <Link href={`/clientes/${id}`} className="font-medium hover:underline">
      {nome}
    </Link>
  )
}

export function AtividadesRecentes({ itens }: { itens: AtividadeRecente[] }) {
  if (itens.length === 0) {
    return <p className="text-sm text-premium-mudo">Nenhuma atividade registrada ainda. Ligações, reuniões e mensagens aparecem aqui.</p>
  }

  return (
    <ul className="space-y-3">
      {itens.map((a) => (
        <li key={a.id} className="text-sm">
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="rounded bg-premium-bg px-1.5 py-0.5 text-xs text-premium-secundario">
              {ROTULO_TIPO_ATIVIDADE[a.tipo]}
            </span>
            <LinkCliente id={a.clienteId} nome={a.clienteNome} />
          </p>
          <p className="mt-0.5 line-clamp-2 text-premium-secundario">{a.descricao}</p>
          <p className="mt-0.5 text-xs text-premium-mudo">
            {formatarDataHora(a.data)}
            {a.usuario && ` · ${a.usuario}`}
          </p>
        </li>
      ))}
    </ul>
  )
}

function Etapa({ etapa }: { etapa: Movimentacao['etapaNova'] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PontoEtapa cor={etapa.cor} className="size-2" />
      {etapa.nome}
    </span>
  )
}

export function UltimasMovimentacoes({ itens }: { itens: Movimentacao[] }) {
  if (itens.length === 0) {
    return <p className="text-sm text-premium-mudo">Nenhuma movimentação no funil ainda. As mudanças de etapa aparecem aqui.</p>
  }

  return (
    <ul className="space-y-3">
      {itens.map((m) => (
        <li key={m.id} className="text-sm">
          <p>
            <LinkCliente id={m.clienteId} nome={m.clienteNome} />
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-premium-secundario">
            {m.etapaAnterior ? (
              <>
                <Etapa etapa={m.etapaAnterior} />
                <span aria-label="para">→</span>
                <Etapa etapa={m.etapaNova} />
              </>
            ) : (
              <>
                Nova negociação em <Etapa etapa={m.etapaNova} />
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-premium-mudo">
            {formatarDataHora(m.data)}
            {m.usuario && ` · ${m.usuario}`}
          </p>
        </li>
      ))}
    </ul>
  )
}
