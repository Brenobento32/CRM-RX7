import Link from 'next/link'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoPrimarioClass, linhaClass, tabelaCaixaClass, tabelaClass, theadClass, botaoCompactoClass, inputClass } from '@/components/ui/estilos'
import { acessarEmpresaAction, alterarSituacaoEmpresaAction } from '@/lib/actions/super-admin'
import { listarEmpresas, type EmpresaAdmin } from '@/lib/dal/super-admin'
import { formatarData } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_ASSINATURA } from '@/lib/validations/super-admin'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

import { Aviso, ROTULO_STATUS_EMPRESA, ROTULO_TIPO_EMPRESA } from './aviso'

/**
 * Empresas da plataforma (início do painel). Só é renderizada depois de o
 * banco confirmar o Super Admin; `listarEmpresas` chama uma RPC `admin_*`,
 * que confere o privilégio de novo.
 */
export async function ListaEmpresas({ params }: { params: Record<string, string | string[] | undefined> }) {
  const empresas = await listarEmpresas()

  return (
    <div className="space-y-4">
      <PageHeaderPremium
        titulo="Empresas"
        subtitulo="Cadastro, usuários e assinatura de cada empresa. Os dados comerciais das empresas não aparecem aqui."
        acoes={
          <Link href="/admin/empresas/nova" className={botaoPrimarioClass}>
            Nova empresa
          </Link>
        }
      />

      <Aviso ok={params.ok} erro={params.erro} />

      <div className={tabelaCaixaClass}>
        <table className={tabelaClass}>
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3">Assinatura</th>
              <th className="px-4 py-3">Renovação</th>
              <th className="px-4 py-3 text-right tabular-nums">Usuários</th>
              <th className="px-4 py-3">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id} className={linhaClass}>
                <td className="px-4 py-3">
                  <Link href={`/admin/empresas/${e.id}`} className="font-medium hover:underline">
                    {e.nome}
                  </Link>
                  <span className="block text-xs text-premium-mudo">{e.slug}</span>
                </td>
                <td className="px-4 py-3">{ROTULO_TIPO_EMPRESA[e.tipo]}</td>
                <td className="px-4 py-3">
                  <SituacaoEmpresa empresa={e} />
                </td>
                <td className="px-4 py-3">{e.plano_nome ?? '—'}</td>
                <td className="px-4 py-3">{e.assinatura_status ? ROTULO_STATUS_ASSINATURA[e.assinatura_status] : '—'}</td>
                <td className="px-4 py-3">{e.renovacao_em ? formatarData(e.renovacao_em) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.usuarios_ativos}</td>
                <td className="px-4 py-3 text-right">
                  {/* Abre a janela de acesso (auditada) e entra no CRM da empresa. */}
                  <form action={acessarEmpresaAction}>
                    <input type="hidden" name="tenant_id" value={e.id} />
                    <button type="submit" className={botaoCompactoClass} aria-label={`Acessar o CRM de ${e.nome}`}>
                      Acessar CRM
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Situação na lista: Ativa/Inativa com o status atual e, para assinantes, a
 * ação de desativar ou reativar (motivo + confirmação; o banco confere o
 * Super Admin e registra quem fez). Interna e arquivo: protegidas.
 */
function SituacaoEmpresa({ empresa }: { empresa: EmpresaAdmin }) {
  const inativa = empresa.status === 'suspenso' || empresa.status === 'cancelado' || empresa.status === 'arquivo'
  const selo = inativa
    ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
  return (
    <div className="space-y-1.5">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${selo}`}>
        {inativa ? 'Inativa' : 'Ativa'} · {ROTULO_STATUS_EMPRESA[empresa.status]}
      </span>
      {empresa.tipo !== 'assinante' ? (
        <span className="block text-xs text-premium-mudo">Protegida</span>
      ) : (
        <details className="text-xs">
          <summary className="cursor-pointer text-premium-secundario hover:text-premium-texto">
            {inativa ? 'Reativar…' : 'Desativar…'}
          </summary>
          <form action={alterarSituacaoEmpresaAction} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="tenant_id" value={empresa.id} />
            <input type="hidden" name="acao" value={inativa ? 'reativar' : 'suspender'} />
            <input type="hidden" name="voltar" value="lista" />
            <input
              name="motivo"
              required
              minLength={3}
              maxLength={500}
              placeholder="Motivo"
              aria-label={`Motivo para ${inativa ? 'reativar' : 'desativar'} ${empresa.nome}`}
              className={`${inputClass} w-40 py-1 text-xs`}
            />
            <BotaoConfirmar
              pergunta={
                inativa
                  ? `Reativar "${empresa.nome}"? Ela volta ao estado comercial de antes da inativação (vencida continua vencida); plano e datas não mudam.`
                  :`Desativar "${empresa.nome}"? A empresa fica somente leitura e para de receber leads até ser reativada.`
              }
              className={botaoCompactoClass}
            >
              Confirmar
            </BotaoConfirmar>
          </form>
        </details>
      )}
    </div>
  )
}
