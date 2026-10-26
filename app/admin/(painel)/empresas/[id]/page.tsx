import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CampoLogotipo } from '@/components/empresa/campo-logotipo'
import { Aviso as AvisoTom } from '@/components/ui/aviso'
import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoPrimarioClass, botaoSecundarioClass, inputClass, botaoPerigoClass, cartaoClass, labelClass, legendaClass } from '@/components/ui/estilos'
import {
  acessarEmpresaAction,
  alterarSituacaoEmpresaAction,
  alterarSlugEmpresaAction,
  definirAssinaturaAction,
  salvarCadastroEmpresaAction,
} from '@/lib/actions/super-admin'
import {
  historicoAssinatura,
  listarAuditoria,
  listarPlanos,
  obterCadastroEmpresa,
  obterEmpresa,
  type CadastroEmpresa,
} from '@/lib/dal/super-admin'
import { formatarTelefone } from '@/lib/utils/documentos'
import { formatarData, formatarDataHoraCompleta } from '@/lib/utils/formatacao'
import { CICLOS, ROTULO_STATUS_ASSINATURA, STATUS_ASSINATURA } from '@/lib/validations/super-admin'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

import { Aviso, ROTULO_STATUS_EMPRESA, ROTULO_TIPO_EMPRESA } from '@/app/admin/_components/aviso'

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
  const [planos, historico, auditoria, cadastro] = await Promise.all([
    listarPlanos(),
    assinante ? historicoAssinatura(id) : Promise.resolve([]),
    listarAuditoria(id, 50),
    obterCadastroEmpresa(id),
  ])
  const suspensa = empresa.status === 'suspenso'

  return (
    <div className="space-y-6">
      <PageHeaderPremium
        titulo={empresa.nome}
        subtitulo={
          <>
            /{empresa.slug} · {ROTULO_TIPO_EMPRESA[empresa.tipo]} · {ROTULO_STATUS_EMPRESA[empresa.status]} · criada em{' '}
            {formatarData(empresa.criado_em)}
          </>
        }
        voltar={{ href: '/admin', rotulo: 'Empresas' }}
      />

      <Aviso ok={busca.ok} erro={busca.erro} />

      {/* Entrar no CRM operacional da empresa: janela de acesso de 8 h, auditada. */}
      <form action={acessarEmpresaAction} className={`${cartaoClass} flex flex-wrap items-end gap-3 p-5`}>
        <input type="hidden" name="tenant_id" value={empresa.id} />
        <div className="min-w-0 flex-1 basis-64">
          <h2 className={legendaClass}>CRM da empresa</h2>
          <p className="mt-0.5 mb-3 text-xs text-premium-mudo">
            Você entra como Administrador desta empresa por até 8 horas. O acesso e o motivo ficam registrados na auditoria.
          </p>
          <label className="block text-sm">
            <span className={labelClass}>Motivo (opcional)</span>
            <input name="motivo" maxLength={300} placeholder="Ex.: suporte ao cliente, configuração inicial" className={inputClass} />
          </label>
        </div>
        <button type="submit" className={botaoPrimarioClass}>
          Acessar CRM
        </button>
      </form>

      {cadastro && <FormCadastro cadastro={cadastro} />}

      {empresa.tipo !== 'arquivo' && (
        <form action={alterarSlugEmpresaAction} className={`${cartaoClass} space-y-3 p-5`}>
          <input type="hidden" name="tenant_id" value={empresa.id} />
          <h2 className={legendaClass}>Endereço da empresa</h2>
          <p className="text-xs text-premium-mudo">
            Atual: /{empresa.slug}. O endereço antigo continua levando à empresa (só para quem é membro dela) e nunca poderá ser usado por
            outra empresa. A troca fica registrada na auditoria.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className={labelClass}>Novo endereço</span>
              <input name="slug" required maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className={labelClass}>Motivo</span>
              <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
            </label>
          </div>
          <button type="submit" className={botaoSecundarioClass}>
            Trocar endereço
          </button>
        </form>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Dado rotulo="Usuários ativos" valor={String(empresa.usuarios_ativos)} />
        <Dado rotulo="Integrações em uso" valor={String(empresa.integracoes_em_uso)} />
        <Dado rotulo="Administradores" valor={empresa.administradores.join(', ') || '—'} />
      </section>

      {!assinante ? (
        <AvisoTom tom="info" titulo={empresa.tipo === 'arquivo' ? 'Empresa de arquivo' : 'Empresa interna'}>
          {empresa.tipo === 'arquivo'
            ? 'Somente leitura, sem assinatura. Não pode ser suspensa, reativada ou excluída.'
            : 'Empresa da Rio X7: sem assinatura e sem limites de plano. Não pode ser suspensa por aqui.'}
        </AvisoTom>
      ) : (
        <>
          <section className={`${cartaoClass} space-y-3 p-5`}>
            <h2 className={legendaClass}>Assinatura</h2>
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

          <section className={`${cartaoClass} space-y-3 p-5`}>
            <h2 className={legendaClass}>{suspensa ? 'Reativar empresa' : 'Suspender empresa'}</h2>
            <p className="text-sm text-premium-secundario">
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
              {suspensa ? (
                <button type="submit" className={botaoPrimarioClass}>
                  Reativar
                </button>
              ) : (
                <BotaoConfirmar
                  pergunta={`Suspender "${empresa.nome}"? A empresa fica somente leitura até ser reativada.`}
                  className={botaoPerigoClass}
                >
                  Suspender
                </BotaoConfirmar>
              )}
            </form>
          </section>

          <section className="space-y-2">
            <h2 className={legendaClass}>Histórico da assinatura</h2>
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
        <h2 className={legendaClass}>Ações administrativas</h2>
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
    <div className={`${cartaoClass} p-4`}>
      <p className="text-xs text-premium-mudo">{rotulo}</p>
      <p className="mt-1 break-words font-medium text-premium-texto">{valor}</p>
    </div>
  )
}

function Campo({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block text-sm ${largo ? 'sm:col-span-2' : ''}`}>
      <span className={labelClass}>{rotulo}</span>
      {children}
    </label>
  )
}

function Lista({ itens, vazio }: { itens: { quando: string; texto: string }[]; vazio: string }) {
  if (itens.length === 0) return <p className={`${cartaoClass} px-4 py-3 text-sm text-premium-mudo`}>{vazio}</p>
  return (
    <ul className={`${cartaoClass} divide-y divide-premium-borda-suave text-sm`}>
      {itens.map((i, n) => (
        <li key={n} className="px-4 py-2.5">
          <span className="text-xs text-premium-mudo">{formatarDataHoraCompleta(i.quando)}</span>
          <span className="block text-premium-texto">{i.texto}</span>
        </li>
      ))}
    </ul>
  )
}

/** Cadastro da empresa: nome comercial, contato, responsável e logotipo. */
function FormCadastro({ cadastro }: { cadastro: CadastroEmpresa }) {
  return (
    <form action={salvarCadastroEmpresaAction} className={`${cartaoClass} space-y-4 p-5`}>
      <input type="hidden" name="tenant_id" value={cadastro.id} />
      <div>
        <div>
          <h2 className={legendaClass}>Cadastro da empresa</h2>
          <p className="text-xs text-premium-mudo">
            {cadastro.telefone ? formatarTelefone(cadastro.telefone) : 'Sem telefone'} · {cadastro.email ?? 'sem e-mail'} ·{' '}
            {cadastro.responsavelNome ?? 'sem responsável'}
          </p>
        </div>
      </div>
      <label className="block text-sm">
        <span className={labelClass}>Nome comercial</span>
        <input name="nome" required maxLength={120} defaultValue={cadastro.nome} className={inputClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={labelClass}>Telefone</span>
          <input
            name="telefone"
            inputMode="tel"
            defaultValue={cadastro.telefone ? formatarTelefone(cadastro.telefone) : ''}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className={labelClass}>E-mail da empresa</span>
          <input name="email" type="email" defaultValue={cadastro.email ?? ''} className={inputClass} />
        </label>
      </div>
      <label className="block text-sm">
        <span className={labelClass}>Nome do responsável</span>
        <input name="responsavel_nome" maxLength={120} defaultValue={cadastro.responsavelNome ?? ''} className={inputClass} />
      </label>
      <CampoLogotipo logoUrl={cadastro.logoUrl} nome={cadastro.nome} />
      <button type="submit" className={botaoPrimarioClass}>
        Salvar cadastro
      </button>
    </form>
  )
}
