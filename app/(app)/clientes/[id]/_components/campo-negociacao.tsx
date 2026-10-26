import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass } from '@/components/ui/estilos'

export type OpcaoNegociacao = { id: string; rotulo: string }

/** Vínculo opcional com uma negociação do cliente. */
export function CampoNegociacao({
  id,
  negociacoes,
  erro,
}: {
  id: string
  negociacoes: OpcaoNegociacao[]
  erro?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        Negociação <span className="font-normal text-premium-mudo">(opcional)</span>
      </label>
      <select id={id} name="negociacao_id" defaultValue="" className={inputClass}>
        <option value="">Nenhuma</option>
        {negociacoes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.rotulo}
          </option>
        ))}
      </select>
      <ErroCampo mensagem={erro} />
    </div>
  )
}
