import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Aviso } from '@/components/ui/aviso'
import { Secao } from '@/components/ui/secao'
import { Selo } from '@/components/ui/selo'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMinhaAssinatura, podeVerAssinatura } from '@/lib/dal/assinatura'
import { formatarData, formatarMoeda } from '@/lib/utils/formatacao'
import { RECURSOS_OCULTOS, ROTULO_RECURSO, ROTULO_STATUS_ASSINATURA, type Recurso } from '@/lib/validations/super-admin'

export const metadata: Metadata = {
  title: 'Minha assinatura',
}

/** Plano, situação, limites e consumo da empresa. Só leitura. */
export default async function MinhaAssinaturaPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const pode = await podeVerAssinatura()
  const assinatura = pode ? await obterMinhaAssinatura() : null

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Minha assinatura"
        subtitulo="Plano, situação, limites e consumo da empresa."
        voltar={{ href: '/configuracoes', rotulo: 'Configurações' }}
      />

      {!pode ? (
        <Aviso tom="info" titulo="Acesso restrito">
          Somente o administrador da empresa vê a assinatura.
        </Aviso>
      ) : !assinatura?.plano_codigo ? (
        <Aviso tom="info" titulo="Sem assinatura">
          Esta empresa é interna: não há plano nem limites de uso.
        </Aviso>
      ) : (
        <>
          <Secao
            titulo={assinatura.plano_nome ?? 'Plano'}
            descricao={assinatura.ciclo === 'anual' ? 'Cobrança anual' : 'Cobrança mensal'}
            acoes={
              assinatura.status && (
                <Selo tom={assinatura.status === 'ativa' ? 'verde' : assinatura.status === 'teste' ? 'azul' : 'vermelho'}>
                  {ROTULO_STATUS_ASSINATURA[assinatura.status]}
                </Selo>
              )
            }
          >
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Dado rotulo="Plano" valor={assinatura.plano_nome ?? '—'} />
              <Dado
                rotulo="Situação"
                valor={assinatura.status ? ROTULO_STATUS_ASSINATURA[assinatura.status] : '—'}
                destaque={assinatura.status === 'suspensa' || assinatura.status === 'vencida' || assinatura.status === 'cancelada'}
              />
              <Dado rotulo="Ciclo" valor={assinatura.ciclo === 'anual' ? 'Anual' : 'Mensal'} />
              <Dado
                rotulo="Valor"
                valor={
                  (assinatura.ciclo === 'anual' ? assinatura.preco_anual : assinatura.preco_mensal) === null
                    ? 'A definir'
                    : formatarMoeda(Number(assinatura.ciclo === 'anual' ? assinatura.preco_anual : assinatura.preco_mensal))
                }
              />
              {assinatura.teste_ate && <Dado rotulo="Teste até" valor={formatarData(assinatura.teste_ate)} />}
              <Dado rotulo="Próxima renovação" valor={assinatura.renovacao_em ? formatarData(assinatura.renovacao_em) : '—'} />
            </dl>
          </Secao>

          <Secao titulo="Limites e consumo" descricao="Uso atual em relação ao que o plano permite.">
            <div className="space-y-4">
              <Consumo rotulo="Usuários ativos" uso={Number(assinatura.usuarios_ativos)} limite={assinatura.limite_usuarios} />
              <Consumo rotulo="Integrações" uso={assinatura.integracoes_em_uso} limite={assinatura.limite_integracoes} />
              <div className="border-t border-premium-borda-suave pt-4">
                <p className="text-sm font-medium text-premium-texto">Recursos do plano</p>
                <p className="mt-0.5 text-sm text-premium-secundario">
                  {(assinatura.recursos ?? [])
                    .filter((r) => !RECURSOS_OCULTOS.includes(r as Recurso))
                    .map((r) => ROTULO_RECURSO[r as Recurso] ?? r)
                    .join(', ') || '—'}
                </p>
              </div>
            </div>
          </Secao>

          <p className="text-xs text-premium-mudo">
            Para mudar de plano, ciclo ou situação, fale com a Rio X7. Alterações de assinatura não são feitas por aqui.
          </p>
        </>
      )}
    </div>
  )
}

function Dado({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-premium-mudo">{rotulo}</dt>
      <dd className={`mt-0.5 text-sm font-medium ${destaque ? 'text-red-600 dark:text-red-400' : 'text-premium-texto'}`}>{valor}</dd>
    </div>
  )
}

function Consumo({ rotulo, uso, limite }: { rotulo: string; uso: number; limite: number | null }) {
  const fracao = limite ? Math.min(uso / limite, 1) : 0
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-premium-texto">{rotulo}</span>
        <span className="tabular-nums text-premium-secundario">
          {uso} {limite === null ? '(sem limite)' : `de ${limite}`}
        </span>
      </div>
      {limite !== null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-premium-acento-suave" aria-hidden>
          <div
            className={`h-full rounded-full ${fracao >= 1 ? 'bg-red-500' : 'bg-premium-acento'}`}
            style={{ width: `${Math.round(fracao * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
