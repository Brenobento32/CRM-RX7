import { botaoPrimarioClass, cartaoClass, inputClass, labelClass, legendaClass } from '@/components/ui/estilos'
import { definirRegrasEtapaAction } from '@/lib/actions/super-admin'
import type { EtapaRegrasAdmin, FunilRegrasAdmin } from '@/lib/dal/super-admin'
import {
  CAMPOS_ETAPA,
  ROTULO_CAMPO_ETAPA,
  ROTULO_USO_CAMPO_ETAPA,
  USOS_CAMPO_ETAPA,
  usoDoCampo,
} from '@/lib/utils/regras-etapas'

/** Resumo de uma linha: o que a etapa exige hoje. */
function resumo(e: EtapaRegrasAdmin): string {
  const obrig = CAMPOS_ETAPA.filter((c) => usoDoCampo(e.regra, c) === 'obrigatorio').length
  const ocultos = CAMPOS_ETAPA.filter((c) => usoDoCampo(e.regra, c) === 'oculto').length
  const itens = e.regra.checklist.length
  const partes = [
    obrig && `${obrig} obrigatório(s)`,
    ocultos && `${ocultos} não usado(s)`,
    itens && `${itens} confirmação(ões)`,
  ].filter(Boolean)
  return partes.length ? partes.join(' · ') : 'Sem exigências'
}

function motivoFixo(e: EtapaRegrasAdmin): string {
  if (e.tipo === 'ganha') return 'Fechamento: segue as regras comerciais da empresa (acima).'
  if (e.tipo === 'perdida') return 'Perda: sempre pede o motivo de perda.'
  return 'Etapa inicial: é onde os leads entram (planilha, formulários, Meta, WhatsApp). Nunca tem exigências.'
}

/**
 * Exigências por funil e etapa desta empresa. Só o Super Admin configura; o
 * Administrador da empresa só vê o efeito no Kanban. Cada etapa é salva à
 * parte (id real da etapa), com motivo e auditoria. Exige só para ENTRAR na
 * etapa: negociações que já estão nela não mudam, e nada é apagado.
 */
export function RegrasEtapasEmpresa({ tenantId, funis }: { tenantId: string; funis: FunilRegrasAdmin[] }) {
  return (
    <section id="regras-etapas" className={`${cartaoClass} space-y-4 p-5`}>
      <div>
        <h2 className={legendaClass}>Exigências por funil e etapa</h2>
        <p className="mt-0.5 text-xs text-premium-mudo">
          Para cada etapa aberta: o que o card precisa ter para entrar nela. &quot;Não usar&quot; tira o campo dos formulários dessa
          etapa sem apagar o que já foi gravado. Padrão de toda empresa: sem exigências. Mudar uma regra não move, não reabre e não
          altera negociações que já estão na etapa; vale para as próximas entradas.
        </p>
      </div>

      {funis.length === 0 && <p className="text-sm text-premium-mudo">Esta empresa ainda não tem funis.</p>}

      {funis.map((f) => (
        <div key={f.id} className="space-y-2">
          <h3 className="text-sm font-semibold">
            {f.nome}
            {!f.ativo && <span className="ml-2 text-xs font-normal text-premium-mudo">(funil desativado)</span>}
          </h3>
          <ul className="divide-y divide-premium-borda rounded-lg border border-premium-borda">
            {f.etapas.map((e) => (
              <li key={e.id} className="p-3">
                {!e.configuravel ? (
                  <p className="text-sm">
                    <span className="font-medium">{e.nome}</span>
                    <span className="ml-2 text-xs text-premium-mudo">{motivoFixo(e)}</span>
                  </p>
                ) : (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {e.nome}
                        {!e.ativo && <span className="ml-2 text-xs font-normal text-premium-mudo">(desativada)</span>}
                      </span>
                      <span className="text-xs text-premium-secundario">
                        {resumo(e)} · <span className="group-open:hidden">Configurar</span>
                        <span className="hidden group-open:inline">Recolher</span>
                      </span>
                    </summary>
                    <form action={definirRegrasEtapaAction} className="mt-3 space-y-4">
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="etapa_id" value={e.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        {CAMPOS_ETAPA.map((c) => (
                          <label key={c} className="block text-sm">
                            <span className={labelClass}>{ROTULO_CAMPO_ETAPA[c]}</span>
                            <select name={`campo_${c}`} defaultValue={usoDoCampo(e.regra, c)} className={inputClass}>
                              {USOS_CAMPO_ETAPA.map((u) => (
                                <option key={u} value={u}>
                                  {ROTULO_USO_CAMPO_ETAPA[u]}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                      <label className="block text-sm">
                        <span className={labelClass}>Confirmações obrigatórias para entrar (uma por linha, até 10)</span>
                        <textarea
                          name="checklist"
                          rows={3}
                          defaultValue={e.regra.checklist.map((i) => i.texto).join('\n')}
                          placeholder="Ex.: Contato confirmado por telefone"
                          className={inputClass}
                        />
                      </label>
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="block min-w-0 flex-1 basis-64 text-sm">
                          <span className={labelClass}>Motivo da alteração</span>
                          <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
                        </label>
                        <button type="submit" className={botaoPrimarioClass}>
                          Salvar exigências
                        </button>
                      </div>
                      <p className="text-xs text-premium-mudo">
                        {e.negociacoes} negociação(ões) estão nesta etapa agora: continuam como estão.
                      </p>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
