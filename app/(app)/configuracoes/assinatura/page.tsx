import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

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
      <div>
        <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Minha assinatura</h1>
      </div>

      {!pode ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Somente o administrador da empresa vê a assinatura.</p>
      ) : !assinatura?.plano_codigo ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          Esta empresa não tem assinatura (empresa interna): sem limites de plano.
        </p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
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
          </section>

          <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">Limites e consumo</h2>
            <Consumo rotulo="Usuários ativos" uso={Number(assinatura.usuarios_ativos)} limite={assinatura.limite_usuarios} />
            <Consumo rotulo="Integrações" uso={assinatura.integracoes_em_uso} limite={assinatura.limite_integracoes} />
            <div>
              <p className="text-sm font-medium">Recursos do plano</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {(assinatura.recursos ?? [])
                  .filter((r) => !RECURSOS_OCULTOS.includes(r as Recurso))
                  .map((r) => ROTULO_RECURSO[r as Recurso] ?? r)
                  .join(', ') || '—'}
              </p>
            </div>
          </section>

          <p className="text-xs text-zinc-500">
            Para mudar de plano, ciclo ou situação, fale com a Rio X7. Alterações de assinatura não são feitas por aqui.
          </p>
        </>
      )}
    </div>
  )
}

function Dado({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{rotulo}</p>
      <p className={`mt-1 font-medium ${destaque ? 'text-red-600 dark:text-red-400' : ''}`}>{valor}</p>
    </div>
  )
}

function Consumo({ rotulo, uso, limite }: { rotulo: string; uso: number; limite: number | null }) {
  const fracao = limite ? Math.min(uso / limite, 1) : 0
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{rotulo}</span>
        <span>
          {uso} {limite === null ? '(sem limite)' : `de ${limite}`}
        </span>
      </div>
      {limite !== null && (
        <div className="mt-1 h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800" aria-hidden>
          <div
            className={`h-full ${fracao >= 1 ? 'bg-red-500' : 'bg-zinc-900 dark:bg-zinc-100'}`}
            style={{ width: `${Math.round(fracao * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
