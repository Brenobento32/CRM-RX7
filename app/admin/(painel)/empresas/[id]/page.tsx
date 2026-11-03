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
  arquivarEmpresaAction,
  definirAssinaturaAction,
  excluirEmpresaAction,
  salvarCadastroEmpresaAction,
} from '@/lib/actions/super-admin'
import {
  historicoAssinatura,
  listarAuditoria,
  listarPlanos,
  obterCadastroEmpresa,
  obterEmpresa,
  previaReativacao,
  regrasComerciaisDaEmpresa,
  regrasEtapasDaEmpresa,
  situacaoExclusaoEmpresa,
  type CadastroEmpresa,
  type EmpresaAdmin,
  type PreviaReativacao,
  type SituacaoExclusao,
} from '@/lib/dal/super-admin'
import { centralDaEmpresaNoPainel, limitesDaEmpresa } from '@/lib/dal/central-integracoes'
import { integracoesDaEmpresaNoPainel } from '@/lib/dal/integracoes-oficiais'
import { formatarTelefone } from '@/lib/utils/documentos'
import { formatarData, formatarDataHoraCompleta } from '@/lib/utils/formatacao'
import { CICLOS, ROTULO_STATUS_ASSINATURA, STATUS_ASSINATURA } from '@/lib/validations/super-admin'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

import { Aviso, ROTULO_STATUS_EMPRESA, ROTULO_TIPO_EMPRESA } from '@/app/admin/_components/aviso'

import { IntegracoesDaEmpresa } from './integracoes-empresa'
import { RegrasComerciaisEmpresa } from './regras-comerciais'
import { RegrasEtapasEmpresa } from './regras-etapas'

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
  const inativa = empresa.status === 'suspenso' || empresa.status === 'cancelado'
  const [planos, historico, auditoria, cadastro, integracoes, central, limites, regras, exclusao, regrasEtapas, previa] = await Promise.all([
    listarPlanos(),
    assinante ? historicoAssinatura(id) : Promise.resolve([]),
    listarAuditoria(id, 50),
    obterCadastroEmpresa(id),
    integracoesDaEmpresaNoPainel(id),
    centralDaEmpresaNoPainel(id),
    limitesDaEmpresa(id),
    empresa.tipo === 'arquivo' ? Promise.resolve(null) : regrasComerciaisDaEmpresa(id),
    assinante ? situacaoExclusaoEmpresa(id) : Promise.resolve(null),
    empresa.tipo === 'arquivo' ? Promise.resolve(null) : regrasEtapasDaEmpresa(id),
    assinante && inativa ? previaReativacao(id) : Promise.resolve(null),
  ])

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

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Dado rotulo="Usuários ativos" valor={String(empresa.usuarios_ativos)} />
        <Dado rotulo="Fontes de captação em uso" valor={String(empresa.integracoes_em_uso)} />
        <Dado rotulo="Administradores" valor={empresa.administradores.join(', ') || '—'} />
      </section>

      {regras && <RegrasComerciaisEmpresa tenantId={id} regras={regras} uso={regras.uso} />}

      {regrasEtapas && <RegrasEtapasEmpresa tenantId={id} funis={regrasEtapas} />}

      <IntegracoesDaEmpresa tenantId={id} linhas={central} limites={limites} />

      {/* Conexões oficiais (Google Sheets / WhatsApp): só situação, nunca credenciais. Para mexer, "Acessar CRM" (auditado). */}
      <section className={`${cartaoClass} space-y-3 p-5`}>
        <h2 className={legendaClass}>Conexões oficiais (Google Sheets e WhatsApp)</h2>
        {integracoes.length === 0 ? (
          <p className="text-sm text-premium-mudo">Nenhuma conexão oficial nesta empresa.</p>
        ) : (
          <ul className="divide-y divide-premium-borda-suave text-sm">
            {integracoes.map((i, n) => (
              <li key={n} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{i.nome}</span>{' '}
                  <span className="text-xs text-premium-mudo">{i.tipo === 'google_sheets' ? 'Google Sheets' : 'WhatsApp oficial'}</span>
                </span>
                <span className="text-xs text-premium-secundario">
                  {i.situacao}
                  {i.ultimaAtividade ? ` · ${formatarDataHoraCompleta(i.ultimaAtividade)}` : ''}
                  {i.ultimoErro ? ` · erro: ${i.ultimoErro}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-premium-mudo">Para conectar, pausar ou alterar, use &quot;Acessar CRM&quot;: a ação fica na auditoria da empresa.</p>
      </section>

      {!assinante ? (
        <AvisoTom tom="info" titulo={empresa.tipo === 'arquivo' ? 'Empresa de arquivo: sem plano' : 'Empresa interna: sem plano comercial'}>
          {empresa.tipo === 'arquivo'
            ? 'Somente leitura, sem assinatura. Não tem plano para alterar e não pode ser suspensa, arquivada nem excluída.'
            : 'Empresa da Rio X7: não tem assinatura comercial, então não há plano para trocar. Todos os recursos e cotas valem sem limite de plano; o que se ajusta por aqui são as regras comerciais e as liberações da Central. Não pode ser desativada, arquivada nem excluída.'}
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
              <div className="space-y-2 sm:col-span-3">
                <p className="text-xs text-premium-mudo">
                  Trocar o plano não gera cobrança, não apaga dados e mantém as exceções e cotas da Central. Recursos que o plano novo não
                  inclui só continuam valendo se houver uma liberação na Central.
                </p>
                <button type="submit" className={botaoPrimarioClass}>
                  Salvar assinatura
                </button>
              </div>
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

      <AcoesAdministrativas
        empresa={empresa}
        exclusao={exclusao}
        previa={previa}
        historico={auditoria.map((a) => ({
          quando: a.criado_em,
          texto: `${a.acao}${a.ator_email ? ` · ${a.ator_email}` : ''}${
            typeof a.detalhes === 'object' && a.detalhes && 'motivo' in a.detalhes ? ` · ${String(a.detalhes.motivo)}` : ''
          }`,
        }))}
      />
    </div>
  )
}

const ROTULO_VOLTA: Record<'ativa' | 'teste' | 'vencida', string> = {
  ativa: 'Ativa',
  teste: 'Teste',
  vencida: 'Vencida',
}

/** O que a reativação vai aplicar (mesmas regras do banco: admin_reativacao_previa). */
function PreviaVolta({ previa }: { previa: PreviaReativacao }) {
  const datas = [
    previa.testeAte && `teste até ${formatarData(previa.testeAte)}`,
    previa.renovacaoEm && `renovação em ${formatarData(previa.renovacaoEm)}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <p className="rounded-md border border-premium-borda bg-premium-bg p-3 text-xs" data-previa-reativacao>
      {previa.estadoAnterior ? (
        <>
          Antes da inativação a assinatura estava <strong>{ROTULO_VOLTA[previa.estadoAnterior]}</strong>: é assim que ela volta.
        </>
      ) : (
        <>
          Não há registro de como a assinatura estava antes da inativação: escolha como ela volta. Sem período pago ou teste em vigor,
          só &quot;Vencida&quot; é possível por aqui.
        </>
      )}
      {datas && <span className="block text-premium-mudo">Datas atuais (não mudam): {datas}.</span>}
    </p>
  )
}

/**
 * Ações administrativas DESTA empresa (só dela: cada formulário leva o id da
 * página), recolhidas por padrão. As perigosas ficam destacadas em vermelho e
 * pedem motivo e confirmação; o banco confere o Super Admin e audita tudo.
 */
function AcoesAdministrativas({
  empresa,
  exclusao,
  previa,
  historico,
}: {
  empresa: EmpresaAdmin
  exclusao: SituacaoExclusao | null
  /** Como a empresa voltaria (só quando inativa). */
  previa: PreviaReativacao | null
  historico: { quando: string; texto: string }[]
}) {
  const assinante = empresa.tipo === 'assinante'
  const inativa = empresa.status === 'suspenso' || empresa.status === 'cancelado'
  return (
    <details className={`${cartaoClass} group p-5`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className={legendaClass}>Ações administrativas desta empresa</span>
          <span className="block text-xs text-premium-mudo">
            Endereço, ativar ou desativar, arquivar, excluir e o histórico. Só valem para {empresa.nome}.
          </span>
        </span>
        <span className="text-sm text-premium-secundario group-open:hidden">Mostrar</span>
        <span className="hidden text-sm text-premium-secundario group-open:inline">Recolher</span>
      </summary>

      <div className="mt-5 space-y-5">
        {empresa.tipo !== 'arquivo' && (
          <form action={alterarSlugEmpresaAction} className="space-y-3 rounded-lg border border-premium-borda p-4">
            <input type="hidden" name="tenant_id" value={empresa.id} />
            <h3 className="text-sm font-semibold">Endereço da empresa</h3>
            <p className="text-xs text-premium-mudo">
              Atual: /{empresa.slug}. O endereço antigo continua levando à empresa (só para quem é membro dela) e nunca poderá ser usado
              por outra empresa. A troca fica registrada na auditoria.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Novo endereço">
                <input name="slug" required maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={inputClass} />
              </Campo>
              <Campo rotulo="Motivo">
                <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
              </Campo>
            </div>
            <button type="submit" className={botaoSecundarioClass}>
              Trocar endereço
            </button>
          </form>
        )}

        {!assinante ? (
          <p className="rounded-lg border border-premium-borda p-4 text-sm text-premium-secundario">
            {empresa.tipo === 'interno' ? 'Empresa interna' : 'Empresa de arquivo'}: protegida. Não pode ser desativada, arquivada nem
            excluída.
          </p>
        ) : (
          <>
            <form action={alterarSituacaoEmpresaAction} className="space-y-3 rounded-lg border border-premium-borda p-4">
              <input type="hidden" name="tenant_id" value={empresa.id} />
              <input type="hidden" name="acao" value={inativa ? 'reativar' : 'suspender'} />
              <h3 className="text-sm font-semibold">
                Situação: {inativa ? 'Inativa' : 'Ativa'} · {ROTULO_STATUS_EMPRESA[empresa.status]}
              </h3>
              <p className="text-xs text-premium-mudo">
                {inativa
                  ? 'Reativar devolve a mesma empresa, com todos os dados, ao estado comercial de ANTES da inativação (vencida volta vencida). Plano, datas e cobrança não mudam; para renovar ou conceder um período, use "Assinatura".'
                  : 'Desativar deixa a empresa somente leitura: os usuários entram e consultam, mas ninguém grava; nada é apagado. Leads de planilha, WhatsApp e formulários deixam de entrar enquanto ela estiver inativa.'}
              </p>
              {inativa && previa && <PreviaVolta previa={previa} />}
              <div className="flex flex-wrap items-end gap-3">
                <Campo rotulo="Motivo">
                  <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
                </Campo>
                {inativa && previa && (
                  <Campo rotulo="Volta como">
                    <select
                      name="status_assinatura"
                      required={previa.estadoAnterior === null}
                      defaultValue={previa.estadoAnterior ?? ''}
                      className={inputClass}
                    >
                      {previa.estadoAnterior === null && <option value="">Escolha…</option>}
                      {[...(previa.estadoAnterior ? [previa.estadoAnterior] : []), ...previa.opcoes.filter((o) => o !== previa.estadoAnterior)].map(
                        (o) => (
                          <option key={o} value={o === previa.estadoAnterior ? '' : o}>
                            {ROTULO_VOLTA[o]}
                            {o === previa.estadoAnterior ? ' (como estava antes)' : ' (decisão explícita, auditada)'}
                          </option>
                        ),
                      )}
                    </select>
                  </Campo>
                )}
                {inativa ? (
                  <BotaoConfirmar pergunta={`Reativar "${empresa.nome}"?`} className={botaoPrimarioClass}>
                    Reativar empresa
                  </BotaoConfirmar>
                ) : (
                  <BotaoConfirmar
                    pergunta={`Desativar "${empresa.nome}"? A empresa fica somente leitura e para de receber leads até ser reativada.`}
                    className={botaoPerigoClass}
                  >
                    Desativar empresa
                  </BotaoConfirmar>
                )}
              </div>
            </form>

            {empresa.status !== 'cancelado' && (
              <form action={arquivarEmpresaAction} className="space-y-3 rounded-lg border border-amber-300/60 p-4 dark:border-amber-700/50">
                <input type="hidden" name="tenant_id" value={empresa.id} />
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Arquivar empresa</h3>
                <p className="text-xs text-premium-mudo">
                  Cancela a assinatura e deixa a empresa somente leitura, com todos os dados preservados. Pode ser reativada depois.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <Campo rotulo="Motivo">
                    <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
                  </Campo>
                  <BotaoConfirmar pergunta={`Arquivar "${empresa.nome}"? A assinatura é cancelada e a empresa fica somente leitura.`} className={botaoPerigoClass}>
                    Arquivar
                  </BotaoConfirmar>
                </div>
              </form>
            )}

            <form action={excluirEmpresaAction} className="space-y-3 rounded-lg border border-red-300/70 bg-red-50/40 p-4 dark:border-red-800/60 dark:bg-red-950/20">
              <input type="hidden" name="tenant_id" value={empresa.id} />
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Excluir definitivamente · ação irreversível</h3>
              <p className="text-xs text-premium-mudo">
                Só para cadastro sem nenhum dado comercial e já inativo. Apaga funil, etapas, vínculos e assinatura; a auditoria continua.
                Os usuários continuam existindo{exclusao && exclusao.usuariosSemOutraEmpresa > 0 ? ` (${exclusao.usuariosSemOutraEmpresa} ficariam sem empresa)` : ''}.
              </p>
              {exclusao && (exclusao.bloqueios.length > 0 || !exclusao.inativa) ? (
                <p className="text-sm text-red-700 dark:text-red-300">
                  Não pode ser excluída agora:{' '}
                  {[!exclusao.inativa && 'desative ou arquive antes', exclusao.bloqueios.length > 0 && `tem ${exclusao.bloqueios.join(', ')}`]
                    .filter(Boolean)
                    .join('; ')}
                  . Mantenha-a arquivada.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Campo rotulo={`Digite o endereço (${empresa.slug}) para confirmar`}>
                    <input name="confirmacao" required autoComplete="off" className={inputClass} />
                  </Campo>
                  <Campo rotulo="Motivo">
                    <input name="motivo" required minLength={3} maxLength={500} className={inputClass} />
                  </Campo>
                  <BotaoConfirmar
                    pergunta={`Excluir "${empresa.nome}" DEFINITIVAMENTE? Isto não pode ser desfeito.`}
                    className={botaoPerigoClass}
                  >
                    Excluir definitivamente
                  </BotaoConfirmar>
                </div>
              )}
            </form>
          </>
        )}

        <details className="rounded-lg border border-premium-borda p-4">
          <summary className="cursor-pointer text-sm font-semibold">Histórico administrativo desta empresa ({historico.length})</summary>
          <div className="mt-3">
            <Lista vazio="Nenhuma ação registrada." itens={historico} />
          </div>
        </details>
      </div>
    </details>
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

/**
 * Cadastro da EMPRESA CLIENTE (dados desta empresa — a identidade do AVANTE CRM
 * fica em /admin/identidade): nome, nome comercial, contato, responsável,
 * logotipo da empresa e observações internas da plataforma.
 */
function FormCadastro({ cadastro }: { cadastro: CadastroEmpresa }) {
  return (
    <form action={salvarCadastroEmpresaAction} className={`${cartaoClass} space-y-4 p-5`}>
      <input type="hidden" name="tenant_id" value={cadastro.id} />
      <div>
        <div>
          <h2 className={legendaClass}>Dados da empresa</h2>
          <p className="text-xs text-premium-mudo">
            {cadastro.telefone ? formatarTelefone(cadastro.telefone) : 'Sem telefone'} · {cadastro.email ?? 'sem e-mail'} ·{' '}
            {cadastro.responsavelNome ?? 'sem responsável'}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={labelClass}>Nome da empresa (exibido no CRM)</span>
          <input name="nome" required minLength={2} maxLength={120} defaultValue={cadastro.nome} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className={labelClass}>Nome comercial (fantasia)</span>
          <input name="nome_comercial" maxLength={120} defaultValue={cadastro.nomeComercial ?? ''} className={inputClass} />
        </label>
      </div>
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
      <label className="block text-sm">
        <span className={labelClass}>Observações e informações gerais</span>
        <textarea
          name="observacoes"
          rows={4}
          maxLength={4000}
          defaultValue={cadastro.observacoes ?? ''}
          className={inputClass}
          placeholder="Contrato, contexto, contatos extras…"
        />
        <span className="mt-1 block text-xs text-premium-mudo">Interno da Rio X7: só o Super Admin vê. A empresa não tem acesso a este campo.</span>
      </label>
      <button type="submit" className={botaoPrimarioClass}>
        Salvar dados da empresa
      </button>
    </form>
  )
}
