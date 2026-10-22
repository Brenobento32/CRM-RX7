import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { botaoPrimarioClass, botaoSecundarioClass, inputClass } from '@/components/ui/estilos'
import { alterarSituacaoEmpresaAction, definirAssinaturaAction } from '@/lib/actions/super-admin'
import { historicoAssinatura, listarAuditoria, listarPlanos, obterEmpresa } from '@/lib/dal/super-admin'
import { formatarData, formatarDataHoraCompleta } from '@/lib/utils/formatacao'
import { CICLOS, ROTULO_STATUS_ASSINATURA, STATUS_ASSINATURA } from '@/lib/validations/super-admin'

import { Aviso, ROTULO_STATUS_EMPRESA, ROTULO_TIPO_EMPRESA } from '../../_components/aviso'

export const metadata: Metadata = {
  title: 'Empresa',
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `2026-11-22T…` → `2026-11-22` para o input de data. */
function dia(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

export default async function AdminEmpresaPage({ params, searchParams }: Props) {
  const [{ id }, busca] = await Promise.all([params, searchParams])
  if (!UUID.test(id)) notFound()

  const empresa = await obterEmpresa(id)
  if (!empresa) notFound()

  const assinante = empresa.tipo === 'assinante'
  const [planos, historico, auditoria] = await Promise.all([
    listarPlanos(),
    assinante ? historicoAssinatura(id) : Promise.resolve([]),
    listarAuditoria(id, 50),
  ])
  const suspensa = empresa.status === 'suspenso'

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-zinc-500 hover:underline">
          ← Empresas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{empresa.nome}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          /e/{empresa.slug} · {ROTULO_TIPO_EMPRESA[empresa.tipo]} · {ROTULO_STATUS_EMPRESA[empresa.status]} · criada em{' '}
          {formatarData(empresa.criado_em)}
        </p>
      </div>

      <Aviso ok={busca.ok} erro={busca.erro} />

      <section className="grid gap-4 sm:grid-cols-3">
        <Dado rotulo="Usuários ativos" valor={String(empresa.usuarios_ativos)} />
        <Dado rotulo="Integrações em uso" valor={String(empresa.integracoes_em_uso)} />
        <Dado rotulo="Administradores" valor={empresa.administradores.join(', ') || '—'} />
      </section>

      {!assinante ? (
        <p className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900">
          {empresa.tipo === 'arquivo'
            ? 'Empresa de arquivo: somente leitura, sem assinatura. Não pode ser suspensa, reativada ou excluída.'
            : 'Empresa interna da Rio X7: sem assinatura e sem limites de plano. Não pode ser suspensa por aqui.'}
        </p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-semibold">Assinatura</h2>
            <p className="text-sm">
              {empresa.plano_nome ?? 'Sem plano'} ·{' '}
              {empresa.assinatura_status ? ROTULO_STATUS_ASSINATURA[empresa.assinatura_status] : 'sem assinatura'}
              {empresa.ciclo ? ` · ${empresa.ciclo}` : ''}
              {empresa.teste_ate ? ` · teste até ${formatarData(empresa.teste_ate)}` : ''}
              {empresa.renovacao_em ? ` · renova em ${formatarData(empresa.renovacao_em)}` : ''}
              {empresa.cancelada_em ? ` · cancelada em ${formatarData(empresa.cancelada_em)}` : ''}
            </p>

            <form action={definirAssinaturaAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="tenant_id" value={empresa.id} />
              <Campo rotulo="Plano">
                <select name="plano_codigo" defaultValue={empresa.plano_codigo ?? ''} className={inputClass} required>
                  {planos.map((p) => (
                    <option key={p.codigo} value={p.codigo} disabled={p.status === 'inativo' && p.codigo !== empresa.plano_codigo}>
                      {p.nome}
                      {p.status !== 'ativo' ? ` (${p.status})` : ''}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Situação">
                <select name="status" defaultValue={empresa.assinatura_status ?? 'teste'} className={inputClass}>
                  {STATUS_ASSINATURA.map((s) => (
                    <option key={s} value={s}>
                      {ROTULO_STATUS_ASSINATURA[s]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Ciclo">
                <select name="ciclo" defaultValue={empresa.ciclo ?? 'mensal'} className={inputClass}>
                  {CICLOS.map((c) => (
                    <option key={c} value={c}>
                      {c === 'mensal' ? 'Mensal' : 'Anual'}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Teste até">
                <input type="date" name="teste_ate" defaultValue={dia(empresa.teste_ate)} className={inputClass} />
              </Campo>
              <Campo rotulo="Próxima renovação">
                <input type="date" name="renovacao_em" defaultValue={dia(empresa.renovacao_em)} className={inputClass} />
              </Campo>
              <Campo rotulo="Provedor (opcional)">
                <input name="provedor" placeholder="asaas, mercado_pago, stripe…" className={inputClass} />
              </Campo>
              <Campo rotulo="Id da assinatura no provedor (opcional)">
                <input name="provedor_assinatura_id" className={inputClass} />
              </Campo>
              <Campo rotulo="Motivo (fica no histórico)" largo>
                <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
              </Campo>
              <div className="sm:col-span-3">
                <button type="submit" className={botaoPrimarioClass}>
                  Salvar assinatura
                </button>
              </div>
            </form>
          </section>

          <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-semibold">{suspensa ? 'Reativar empresa' : 'Suspender empresa'}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {suspensa
                ? 'Volta a mesma empresa, com todos os dados, para ativa (ou teste, se o teste não venceu).'
                : 'A empresa fica somente leitura: ninguém grava, nada é apagado. Pagamentos não desfazem a suspensão.'}
            </p>
            <form action={alterarSituacaoEmpresaAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tenant_id" value={empresa.id} />
              <input type="hidden" name="acao" value={suspensa ? 'reativar' : 'suspender'} />
              <Campo rotulo="Motivo">
                <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
              </Campo>
              <button type="submit" className={botaoSecundarioClass}>
                {suspensa ? 'Reativar' : 'Suspender'}
              </button>
            </form>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Histórico da assinatura</h2>
            <Lista
              vazio="Sem mudanças."
              itens={historico.map((h) => ({
                quando: h.criado_em,
                texto: `${h.de_status ? ROTULO_STATUS_ASSINATURA[h.de_status] : '—'} → ${ROTULO_STATUS_ASSINATURA[h.para_status]}${
                  h.de_plano && h.de_plano !== h.para_plano ? ` · ${h.de_plano} → ${h.para_plano}` : ` · ${h.para_plano}`
                } · ${h.origem}${h.motivo ? ` · ${h.motivo}` : ''}${h.ator_email ? ` · ${h.ator_email}` : ''}`,
              }))}
            />
          </section>
        </>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Ações administrativas</h2>
        <Lista
          vazio="Nenhuma ação registrada."
          itens={auditoria.map((a) => ({
            quando: a.criado_em,
            texto: `${a.acao}${a.ator_email ? ` · ${a.ator_email}` : ''}${
              typeof a.detalhes === 'object' && a.detalhes && 'motivo' in a.detalhes ? ` · ${String(a.detalhes.motivo)}` : ''
            }`,
          }))}
        />
      </section>
    </div>
  )
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{rotulo}</p>
      <p className="mt-1 break-words font-medium">{valor}</p>
    </div>
  )
}

function Campo({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block text-sm ${largo ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-medium">{rotulo}</span>
      {children}
    </label>
  )
}

function Lista({ itens, vazio }: { itens: { quando: string; texto: string }[]; vazio: string }) {
  if (itens.length === 0) return <p className="text-sm text-zinc-500">{vazio}</p>
  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {itens.map((i, n) => (
        <li key={n} className="px-3 py-2">
          <span className="text-xs text-zinc-500">{formatarDataHoraCompleta(i.quando)}</span>
          <span className="block">{i.texto}</span>
        </li>
      ))}
    </ul>
  )
}
