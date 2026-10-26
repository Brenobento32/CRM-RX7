'use client'

import { useState, useTransition } from 'react'

import { botaoPrimarioClass, caixaErroClass, caixaSucessoClass, theadClass, tbodyClass } from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { salvarPermissoesColaboradorAction } from '@/lib/actions/permissoes'
import type { PermissaoColaboradorLinha } from '@/lib/dal/permissoes'
import type { CorEtapa, TipoEtapa } from '@/lib/utils/etapas'
import { estadoInicial, paraItens, type Estado, type FunilOpcao } from '@/lib/utils/permissoes-comerciais'

export type { FunilOpcao } from '@/lib/utils/permissoes-comerciais'
export type EtapaOpcao = { id: string; nome: string; cor: CorEtapa; tipo: TipoEtapa; ordem: number }

/**
 * "Permissões comerciais" — Configurações -> Usuários -> editar um SDR/
 * CLOSER. Grava tudo de uma vez (`salvarPermissoesColaboradorAction`,
 * substitui o conjunto inteiro numa transação só) quando o gerente aperta
 * "Salvar permissões" — nada é persistido a cada clique de checkbox.
 *
 * Regras de UX (nunca a segurança real, que é RLS/RPC/trigger no banco):
 *  - funil desmarcado esconde a tabela de etapas dele;
 *  - marcar "Movimentar" liga "Visualizar" automaticamente;
 *  - desmarcar "Visualizar" desliga "Movimentar" (não dá pra mover o que não vê).
 */
export function PermissoesComerciais({
  usuarioId,
  funis,
  etapasPorFunil,
  permissoesAtuais,
}: {
  usuarioId: string
  funis: FunilOpcao[]
  etapasPorFunil: Record<string, EtapaOpcao[]>
  permissoesAtuais: PermissaoColaboradorLinha[]
}) {
  const [estado, setEstado] = useState<Estado>(() => estadoInicial(funis, permissoesAtuais))
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)
  const [salvando, startTransition] = useTransition()

  function alternarFunil(funilId: string, acesso: boolean) {
    setSucesso(false)
    setEstado((atual) => ({ ...atual, [funilId]: { ...atual[funilId], acesso } }))
  }

  function alternarVer(funilId: string, etapaId: string, podeVer: boolean) {
    setSucesso(false)
    setEstado((atual) => {
      const etapaAtual = atual[funilId].etapas[etapaId] ?? { podeVer: false, podeMover: false }
      return {
        ...atual,
        [funilId]: {
          ...atual[funilId],
          etapas: {
            ...atual[funilId].etapas,
            // Desmarcar "Visualizar" desliga "Movimentar" — não dá pra mover o que não se vê.
            [etapaId]: { podeVer, podeMover: podeVer ? etapaAtual.podeMover : false },
          },
        },
      }
    })
  }

  function alternarMover(funilId: string, etapaId: string, podeMover: boolean) {
    setSucesso(false)
    setEstado((atual) => {
      const etapaAtual = atual[funilId].etapas[etapaId] ?? { podeVer: false, podeMover: false }
      return {
        ...atual,
        [funilId]: {
          ...atual[funilId],
          etapas: {
            ...atual[funilId].etapas,
            // Marcar "Movimentar" liga "Visualizar" automaticamente (preferência confirmada).
            [etapaId]: { podeVer: podeMover ? true : etapaAtual.podeVer, podeMover },
          },
        },
      }
    })
  }

  function salvar() {
    setErro(null)
    setSucesso(false)
    startTransition(async () => {
      const resultado = await salvarPermissoesColaboradorAction(usuarioId, paraItens(estado))
      if (resultado.erro) setErro(resultado.erro)
      else setSucesso(true)
    })
  }

  return (
    <section className="space-y-4 pt-2">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-premium-texto">Permissões comerciais</h2>
        <p className="text-sm text-premium-secundario">
          Quais funis e etapas este colaborador pode ver e movimentar no Kanban. Sem nenhuma permissão aqui, ele não
          vê nenhum lead.
        </p>
      </div>

      {erro && (
        <div
          role="alert"
          className={caixaErroClass}
        >
          {erro}
        </div>
      )}
      {sucesso && (
        <div
          role="status"
          className={caixaSucessoClass}
        >
          Permissões salvas.
        </div>
      )}

      <div className="space-y-4">
        {funis.map((funil) => {
          const funilEstado = estado[funil.id]
          const etapas = etapasPorFunil[funil.id] ?? []
          return (
            <div key={funil.id} className="rounded-lg border border-premium-borda">
              <label className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={funilEstado?.acesso ?? false}
                  onChange={(e) => alternarFunil(funil.id, e.target.checked)}
                  className="size-4 accent-zinc-900 dark:accent-zinc-100"
                />
                {funil.nome}
              </label>

              {funilEstado?.acesso && (
                <div className="overflow-x-auto border-t border-premium-borda">
                  <table className="w-full text-left text-sm">
                    <thead className={theadClass}>
                      <tr>
                        <th className="px-4 py-2 font-medium">Etapa</th>
                        <th className="px-4 py-2 text-center font-medium">Visualizar</th>
                        <th className="px-4 py-2 text-center font-medium">Movimentar</th>
                      </tr>
                    </thead>
                    <tbody className={tbodyClass}>
                      {etapas.map((etapa) => {
                        const etapaEstado = funilEstado.etapas[etapa.id] ?? { podeVer: false, podeMover: false }
                        return (
                          <tr key={etapa.id}>
                            <td className="flex items-center gap-2 px-4 py-2">
                              <PontoEtapa cor={etapa.cor} />
                              {etapa.nome}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Visualizar ${etapa.nome}`}
                                checked={etapaEstado.podeVer}
                                onChange={(e) => alternarVer(funil.id, etapa.id, e.target.checked)}
                                className="size-4 accent-zinc-900 dark:accent-zinc-100"
                              />
                            </td>
                            <td className="px-4 py-2 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Movimentar ${etapa.nome}`}
                                checked={etapaEstado.podeMover}
                                onChange={(e) => alternarMover(funil.id, etapa.id, e.target.checked)}
                                className="size-4 accent-zinc-900 dark:accent-zinc-100"
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button type="button" disabled={salvando} onClick={salvar} className={botaoPrimarioClass}>
        {salvando ? 'Salvando…' : 'Salvar permissões'}
      </button>
    </section>
  )
}
