import type { Metadata } from 'next'

import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { salvarPlanoAction } from '@/lib/actions/super-admin'
import { listarPlanos, type PlanoAdmin } from '@/lib/dal/super-admin'
import { RECURSOS, ROTULO_RECURSO, STATUS_PLANO } from '@/lib/validations/super-admin'

import { Aviso } from '../_components/aviso'

export const metadata: Metadata = {
  title: 'Planos',
}

type Busca = Promise<Record<string, string | string[] | undefined>>

/**
 * Planos do SaaS. Preço e limite vazios = ainda não definidos (sem limite).
 * Os limites valem no banco: convidar usuário ou criar integração acima do
 * limite é recusado.
 */
export default async function PlanosPage({ searchParams }: { searchParams: Busca }) {
  const [planos, params] = await Promise.all([listarPlanos(), searchParams])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Planos</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Preço, limites e recursos de cada plano. Campos vazios ficam &quot;a definir&quot; (sem limite). Só planos
          ativos devem ser oferecidos a clientes novos.
        </p>
      </div>

      <Aviso ok={params.ok} erro={params.erro} />

      <div className="grid gap-4 lg:grid-cols-3">
        {planos.map((p) => (
          <FormPlano key={p.codigo} plano={p} />
        ))}
      </div>
    </div>
  )
}

function FormPlano({ plano }: { plano: PlanoAdmin }) {
  const valor = (n: number | null) => (n === null ? '' : String(n))
  return (
    <form action={salvarPlanoAction} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <input type="hidden" name="codigo" value={plano.codigo} />
      <Campo rotulo={`Nome (${plano.codigo})`}>
        <input name="nome" defaultValue={plano.nome} required className={inputClass} />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Preço mensal (R$)">
          <input name="preco_mensal" inputMode="decimal" defaultValue={valor(plano.preco_mensal)} placeholder="a definir" className={inputClass} />
        </Campo>
        <Campo rotulo="Preço anual (R$)">
          <input name="preco_anual" inputMode="decimal" defaultValue={valor(plano.preco_anual)} placeholder="a definir" className={inputClass} />
        </Campo>
        <Campo rotulo="Limite de usuários">
          <input name="limite_usuarios" inputMode="numeric" defaultValue={valor(plano.limite_usuarios)} placeholder="sem limite" className={inputClass} />
        </Campo>
        <Campo rotulo="Limite de integrações">
          <input name="limite_integracoes" inputMode="numeric" defaultValue={valor(plano.limite_integracoes)} placeholder="sem limite" className={inputClass} />
        </Campo>
        <Campo rotulo="Dias de teste">
          <input name="dias_teste" inputMode="numeric" defaultValue={valor(plano.dias_teste)} placeholder="sem prazo" className={inputClass} />
        </Campo>
        <Campo rotulo="Status">
          <select name="status" defaultValue={plano.status} className={inputClass}>
            {STATUS_PLANO.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Recursos</legend>
        {RECURSOS.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="recursos" value={r} defaultChecked={plano.recursos.includes(r)} />
            {ROTULO_RECURSO[r]}
          </label>
        ))}
      </fieldset>
      <button type="submit" className={botaoPrimarioClass}>
        Salvar {plano.nome}
      </button>
    </form>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{rotulo}</span>
      {children}
    </label>
  )
}
