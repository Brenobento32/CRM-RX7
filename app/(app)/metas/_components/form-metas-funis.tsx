import { salvarMetasFunisAction } from '@/lib/actions/metas'
import type { ProgressoFunilMeta } from '@/lib/dal/metas'
import { formatarMoeda } from '@/lib/utils/formatacao'

/** Visual próprio (escuro) — `inputClass`/`botaoPrimarioClass` compartilhados são claros, usados em telas que não migraram pro premium ainda. */
const inputPremiumClass =
  'w-full rounded-md border border-premium-borda bg-premium-bg/60 px-3 py-2 text-sm text-premium-texto outline-none transition placeholder:text-premium-mudo focus:border-premium-acento focus:ring-2 focus:ring-premium-acento/20'
const botaoPremiumClass =
  'rounded-md bg-premium-acento px-4 py-2 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * "Metas mensais por funil" — só GERENTE vê este formulário (a página
 * decide isso antes de renderizar); SDR/CLOSER veem só os cards de
 * progresso (`CardsMetaFunil`, reaproveitado por esta mesma seção, abaixo
 * do form). Um campo TCV e um campo MRR por funil ATIVO (nunca hardcoded
 * pra 2 funis — a lista vem de `progresso`, que já é "todo funil ativo"),
 * UM botão: `salvarMetasFunisAction` valida tudo localmente e faz UMA
 * chamada atômica (RPC `salvar_metas_funis`) — tudo salva ou nada salva,
 * nunca parcial. Campo vazio = não altera aquela meta.
 */
export function FormMetasFunis({
  mes,
  progresso,
}: {
  mes: string
  progresso: ProgressoFunilMeta[]
}) {
  if (progresso.length === 0) return null

  const funis = progresso.map((p) => ({ id: p.funilId, nome: p.funilNome }))

  return (
    <form action={salvarMetasFunisAction.bind(null, mes, funis)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {progresso.map((p) => (
          <fieldset key={p.funilId} className="space-y-3 rounded-lg border border-premium-borda p-4">
            <legend className="px-1 font-medium text-premium-texto">{p.funilNome}</legend>

            <div>
              <label htmlFor={`tcv_${p.funilId}`} className="mb-1 block text-xs text-premium-mudo">
                Meta TCV mensal {p.tcv.valorMeta !== null && `(atual: ${formatarMoeda(p.tcv.valorMeta)})`}
              </label>
              <input
                id={`tcv_${p.funilId}`}
                name={`tcv_${p.funilId}`}
                inputMode="decimal"
                placeholder="R$ 0,00"
                className={inputPremiumClass}
              />
            </div>

            <div>
              <label htmlFor={`mrr_${p.funilId}`} className="mb-1 block text-xs text-premium-mudo">
                Meta MRR mensal {p.mrr.valorMeta !== null && `(atual: ${formatarMoeda(p.mrr.valorMeta)})`}
              </label>
              <input
                id={`mrr_${p.funilId}`}
                name={`mrr_${p.funilId}`}
                inputMode="decimal"
                placeholder="R$ 0,00"
                className={inputPremiumClass}
              />
            </div>
          </fieldset>
        ))}
      </div>

      <p className="text-xs text-premium-mudo">Deixe um campo em branco para não alterar a meta atual daquele funil.</p>

      <button type="submit" className={botaoPremiumClass}>
        Salvar metas dos funis
      </button>
    </form>
  )
}
