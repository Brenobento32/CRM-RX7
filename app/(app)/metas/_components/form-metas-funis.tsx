import { salvarMetasFunisAction } from '@/lib/actions/metas'
import type { ProgressoFunilMeta } from '@/lib/dal/metas'
import { formatarMoeda } from '@/lib/utils/formatacao'
import { ROTULO_TIPO_META, type TipoMetaRotulo } from '@/lib/validations/meta'
import { inputClass, botaoPrimarioClass, cartaoClass } from '@/components/ui/estilos'

const inputPremiumClass = inputClass
const botaoPremiumClass = botaoPrimarioClass

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
  tipos,
}: {
  mes: string
  progresso: ProgressoFunilMeta[]
  /** Tipos de meta liberados para a empresa. */
  tipos: readonly TipoMetaRotulo[]
}) {
  if (progresso.length === 0) return null

  const funis = progresso.map((p) => ({ id: p.funilId, nome: p.funilNome }))

  return (
    <form action={salvarMetasFunisAction.bind(null, mes, funis)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {progresso.map((p) => (
          <fieldset key={p.funilId} className={`${cartaoClass} space-y-3 p-5`}>
            <legend className="px-1 font-medium text-premium-texto">{p.funilNome}</legend>

            {tipos.map((tipo) => (
              <div key={tipo}>
                <label htmlFor={`${tipo}_${p.funilId}`} className="mb-1 block text-xs text-premium-mudo">
                  Meta {ROTULO_TIPO_META[tipo]} mensal {p[tipo].valorMeta !== null && `(atual: ${formatarMoeda(p[tipo].valorMeta)})`}
                </label>
                <input
                  id={`${tipo}_${p.funilId}`}
                  name={`${tipo}_${p.funilId}`}
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  className={inputPremiumClass}
                />
              </div>
            ))}
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
