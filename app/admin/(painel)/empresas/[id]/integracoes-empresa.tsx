import { botaoSecundarioClass, cartaoClass, inputClass, legendaClass } from '@/components/ui/estilos'
import { Selo } from '@/components/ui/selo'
import { definirIntegracaoEmpresaAction, definirLimiteEmpresaAction } from '@/lib/actions/super-admin'
import type { LimiteEmpresa, LinhaCentralAdmin } from '@/lib/dal/central-integracoes'
import { INFO, textoDeUso, textoDoLimite } from '@/lib/integracoes/central'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

/**
 * Liberação das integrações desta empresa: o plano decide por padrão; o Super
 * Admin pode abrir uma exceção (liberar ou bloquear) com motivo, auditada. A
 * chave global de lançamento/homologação continua acima de tudo.
 */
/** No painel, o WhatsApp oficial é uma integração só (os dois cartões da empresa usam a mesma permissão e o mesmo limite). */
const nomeNoPainel = (i: LinhaCentralAdmin['integracao']) => (i === 'whatsapp_oficial' ? 'WhatsApp Business oficial (API e app existente)' : INFO[i].nome)

export function IntegracoesDaEmpresa({ tenantId, linhas, limites }: { tenantId: string; linhas: LinhaCentralAdmin[]; limites: LimiteEmpresa[] }) {
  if (linhas.length === 0) return null
  return (
    <section className={`${cartaoClass} space-y-3 p-5`}>
      <div>
        <h2 className={legendaClass}>Integrações liberadas</h2>
        <p className="text-xs text-premium-mudo">{textoDoLimite(linhas[0])}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['fontes', 'numeros_whatsapp', 'funis'] as const).map((recurso) => {
          const atual = limites.find((l) => l.recurso === recurso)
          return (
            <form key={recurso} action={definirLimiteEmpresaAction} className="space-y-2 rounded-lg border border-premium-borda-suave p-3 text-sm">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="recurso" value={recurso} />
              <p className="font-medium">{recurso === 'fontes' ? 'Fontes de captação desta empresa (formulários, Respondi, webhook, planilhas)' : recurso === 'funis' ? 'Funis desta empresa' : 'Números de WhatsApp desta empresa (API oficial + app existente)'}</p>
              <p className="text-xs text-premium-mudo">{atual ? `Exceção: ${atual.limite} · ${atual.motivo}` : 'Segue o plano (vazio no plano = a definir: novas conexões bloqueadas).'}</p>
              <div className="flex flex-wrap gap-2">
                <input name="limite" inputMode="numeric" defaultValue={atual ? String(atual.limite) : ''} placeholder="do plano" aria-label="Limite" className={`${inputClass} w-24`} />
                <input name="motivo" maxLength={300} placeholder="Motivo" aria-label="Motivo do limite" className={`${inputClass} min-w-32 flex-1`} />
                <button type="submit" className={botaoSecundarioClass}>Salvar</button>
              </div>
            </form>
          )
        })}
      </div>
      <ul className="divide-y divide-premium-borda-suave">
        {linhas.map((l) => (
          <li key={l.integracao} className="space-y-2 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{nomeNoPainel(l.integracao)}</span>
              <span className="flex flex-wrap gap-1.5">
                <Selo tom={l.lancada ? 'verde' : 'neutro'}>{l.lancada ? 'Lançada' : 'Não lançada'}</Selo>
                <Selo tom={l.noPlano ? 'azul' : 'neutro'}>{l.noPlano ? 'No plano' : 'Fora do plano'}</Selo>
                {l.regra && <Selo tom={l.regra === 'liberar' ? 'roxo' : 'vermelho'}>{l.regra === 'liberar' ? 'Exceção: liberada' : 'Exceção: bloqueada'}</Selo>}
                <Selo tom={l.lancada && l.permitida ? 'verde' : 'ambar'}>{l.lancada && l.permitida ? 'Em uso possível' : 'Indisponível'}</Selo>
              </span>
            </div>
            <p className="text-xs text-premium-secundario">
              {textoDeUso(l)}
              {l.ultimaAtividade ? ` · última atividade ${formatarDataHoraCompleta(l.ultimaAtividade)}` : ''}
              {l.motivo ? ` · motivo: ${l.motivo}` : ''}
              {l.definidoEm ? ` (${formatarDataHoraCompleta(l.definidoEm)})` : ''}
            </p>
            {l.solicitadaEm && <p className="text-xs text-amber-700 dark:text-amber-300">Pedido de upgrade aberto desde {formatarDataHoraCompleta(l.solicitadaEm)}.</p>}
            <form action={definirIntegracaoEmpresaAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="integracao" value={l.integracao} />
              <select name="regra" defaultValue={l.regra ?? 'plano'} className={`${inputClass} w-auto`} aria-label={`Regra para ${nomeNoPainel(l.integracao)}`}>
                <option value="plano">Seguir o plano</option>
                <option value="liberar">Liberar (exceção)</option>
                <option value="bloquear">Bloquear</option>
              </select>
              <input name="motivo" maxLength={300} placeholder="Motivo (obrigatório para exceção)" className={`${inputClass} min-w-48 flex-1`} aria-label="Motivo" />
              <button type="submit" className={botaoSecundarioClass}>
                Salvar
              </button>
            </form>
          </li>
        ))}
      </ul>
      <p className="text-xs text-premium-mudo">
        Bloquear desliga conexões novas e a entrada/saída da integração nesta empresa no próprio banco; nada é apagado. Integração não lançada continua sem
        funcionar mesmo liberada aqui.
      </p>
    </section>
  )
}
