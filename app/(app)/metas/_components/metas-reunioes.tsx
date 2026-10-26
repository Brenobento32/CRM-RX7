import { inputClass as inputBase, botaoPrimarioClass, tabelaCaixaClass, theadClass, tbodyClass } from '@/components/ui/estilos'
import { salvarMetasReunioesAction } from '@/lib/actions/metas'
import type { ProgressoReunioesSdr } from '@/lib/dal/metas-reunioes'

import { BarraProgresso, CardMeta, TextoPercentual } from './progresso'

const inputClass = `${inputBase} w-24 py-1.5 text-right tabular-nums`
const botaoClass = botaoPrimarioClass

const AJUDA =
  'Conta reuniões e apresentações marcadas pelo SDR para um Closer ou com cliente, uma vez por série. Agendadas: pela data em que foram marcadas (sem as canceladas). Realizadas: pela data da reunião, com status "realizado". Separado das metas de vendas.'

/** Gerente: equipe inteira com campos de meta. SDR: só os próprios números. */
export function SecaoMetasReunioes({
  mes,
  sdrs,
  gerente,
  euId,
}: {
  mes: string
  sdrs: ProgressoReunioesSdr[]
  gerente: boolean
  euId: string
}) {
  if (!gerente) {
    const eu = sdrs.find((s) => s.usuarioId === euId)
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-premium-secundario">Minhas metas de reuniões</h2>
        <p className="text-xs text-premium-mudo">{AJUDA}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <CardReunioes titulo="Reuniões agendadas" dados={eu?.agendadas} />
          <CardReunioes titulo="Reuniões realizadas" dados={eu?.realizadas} />
        </div>
      </section>
    )
  }

  const total = sdrs.reduce(
    (acc, s) => ({
      agendadas: { meta: acc.agendadas.meta + s.agendadas.meta, realizado: acc.agendadas.realizado + s.agendadas.realizado },
      realizadas: { meta: acc.realizadas.meta + s.realizadas.meta, realizado: acc.realizadas.realizado + s.realizadas.realizado },
    }),
    { agendadas: { meta: 0, realizado: 0 }, realizadas: { meta: 0, realizado: 0 } },
  )

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-premium-secundario">Metas de reuniões (SDR)</h2>
      <p className="text-xs text-premium-mudo">{AJUDA}</p>

      {sdrs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-premium-borda p-6 text-center text-sm text-premium-mudo">
          Nenhum SDR ativo nesta empresa.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <CardReunioes titulo="Equipe — agendadas" dados={comPercentual(total.agendadas)} />
            <CardReunioes titulo="Equipe — realizadas" dados={comPercentual(total.realizadas)} />
          </div>

          <form action={salvarMetasReunioesAction.bind(null, mes)} className="space-y-3">
            <div className={tabelaCaixaClass}>
              <table className="w-full text-left text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className="px-4 py-3 font-medium">SDR</th>
                    <th className="px-4 py-3 font-medium">Agendadas (meta / feito)</th>
                    <th className="px-4 py-3 font-medium">Realizadas (meta / feito)</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {sdrs.map((s) => (
                    <tr key={s.usuarioId}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-premium-texto">{s.nome}</span>
                        {!s.ativo && (
                          <span className="ml-2 rounded bg-premium-borda px-1.5 py-0.5 text-xs text-premium-secundario">
                            desativado
                          </span>
                        )}
                      </td>
                      <CelulaMeta
                        nome={`agendadas_${s.usuarioId}`}
                        rotulo={`Meta de reuniões agendadas de ${s.nome}`}
                        dados={s.agendadas}
                        editavel={s.ativo}
                      />
                      <CelulaMeta
                        nome={`realizadas_${s.usuarioId}`}
                        rotulo={`Meta de reuniões realizadas de ${s.nome}`}
                        dados={s.realizadas}
                        editavel={s.ativo}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={botaoClass}>
                Salvar metas de reuniões
              </button>
              <p className="text-xs text-premium-mudo">Campo em branco mantém a meta atual.</p>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

type Dados = ProgressoReunioesSdr['agendadas']

function comPercentual(d: { meta: number; realizado: number }): Dados {
  return { ...d, percentual: d.meta > 0 ? d.realizado / d.meta : null }
}

function CardReunioes({ titulo, dados }: { titulo: string; dados: Dados | undefined }) {
  return (
    <CardMeta
      titulo={titulo}
      formato="quantidade"
      valorMeta={dados && dados.meta > 0 ? dados.meta : null}
      realizado={dados?.realizado ?? 0}
      percentual={dados?.percentual ?? null}
      semMeta="Nenhuma meta definida para este mês"
    />
  )
}

function CelulaMeta({ nome, rotulo, dados, editavel }: { nome: string; rotulo: string; dados: Dados; editavel: boolean }) {
  return (
    <td className="px-4 py-3">
      <div className="flex min-w-64 items-center gap-3">
        {editavel ? (
          <input
            name={nome}
            aria-label={rotulo}
            inputMode="numeric"
            placeholder={String(dados.meta)}
            className={inputClass}
          />
        ) : (
          <span className="w-24 text-right tabular-nums text-premium-mudo">{dados.meta}</span>
        )}
        <span className="w-10 text-right tabular-nums text-premium-texto">{dados.realizado}</span>
        <div className="flex-1">
          <BarraProgresso percentual={dados.percentual} rotulo={rotulo} />
        </div>
        <span className="w-14 text-right tabular-nums">
          <TextoPercentual percentual={dados.percentual} />
        </span>
      </div>
    </td>
  )
}

/** Usado pela página para não carregar a seção para quem não a vê. */
export const CARGOS_COM_METAS_DE_REUNIOES = ['gerente', 'sdr'] as const
