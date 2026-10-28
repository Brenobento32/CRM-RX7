import Link from 'next/link'

import { Aviso } from '@/components/ui/aviso'
import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { botaoCompactoClass, botaoPerigoClass, botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import { Selo, type TomSelo } from '@/components/ui/selo'
import {
  acaoPlanilhaAction,
  acaoWhatsappAction,
  alterarDestinoAction,
  desconectarGoogleAction,
  sincronizarAgoraAction,
} from '@/lib/actions/integracoes-oficiais'
import type { ConsumoWhatsapp, ContaGoogle, IntegracaoOficial, IntegracoesHabilitadas, MonitoramentoPlanilha } from '@/lib/dal/integracoes-oficiais'
import type { ConexaoMetaAds, FranquiaWhatsapp } from '@/lib/dal/meta-conversoes'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

import { AutorizarArquivo } from './autorizar-arquivo'
import { RegistrarNumero } from './registrar-numero'
import { SeletorDestino, type OpcoesDestino } from './seletor-destino'

const SITUACAO: Record<string, { rotulo: string; tom: TomSelo }> = {
  aguardando: { rotulo: 'Aguardando 1ª sincronização', tom: 'ambar' },
  ativa: { rotulo: 'Ativa', tom: 'verde' },
  pausada: { rotulo: 'Pausada', tom: 'neutro' },
  erro: { rotulo: 'Com erro (tentando de novo)', tom: 'vermelho' },
  erro_autorizacao: { rotulo: 'Reconectar conta Google', tom: 'vermelho' },
  desconectada: { rotulo: 'Desconectada', tom: 'neutro' },
  pendente_registro: { rotulo: 'Falta registrar o número', tom: 'ambar' },
  conectado: { rotulo: 'Conectado', tom: 'verde' },
  pausado: { rotulo: 'Pausado', tom: 'neutro' },
  desconectado: { rotulo: 'Desconectado', tom: 'neutro' },
}

const quando = (d: string | null) => (d ? formatarDataHoraCompleta(d) : '—')

/**
 * Conexões oficiais da empresa: Google Sheets (OAuth) e WhatsApp Business
 * (Cloud API). Mostra só o que o banco devolve para o Administrador desta
 * empresa — nunca token, refresh token ou segredo.
 */
export function ConexoesOficiais({
  integracoes,
  contas,
  consumo,
  opcoes,
  responsaveis,
  podeGerir,
  franquia,
  metaAds,
  habilitadas,
  monitoramento = {},
}: {
  habilitadas: IntegracoesHabilitadas
  monitoramento?: Record<string, MonitoramentoPlanilha>
  integracoes: IntegracaoOficial[]
  contas: ContaGoogle[]
  consumo: ConsumoWhatsapp[]
  franquia: FranquiaWhatsapp[]
  metaAds: ConexaoMetaAds | null
  opcoes: OpcoesDestino
  responsaveis: { id: string; nome: string }[]
  podeGerir: boolean
}) {
  const planilhas = integracoes.filter((i) => i.tipo === 'google_sheets' && i.status !== 'revogada')
  const numeros = integracoes.filter((i) => i.tipo === 'whatsapp_cloud' && i.status !== 'revogada')
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

  return (
    <div className="space-y-6">
      <Secao
        id="google-sheets"
        titulo="Google Sheets"
        descricao="Conta Google da empresa + planilha escolhida no seletor oficial do Google. Linhas novas entram no funil e na etapa de cada conexão; reordenar, inserir ou apagar linhas não duplica leads."
        acoes={
          podeGerir &&
          habilitadas.googleSheets && (
            <Link href="/configuracoes/integracoes/google-sheets" className={botaoPrimarioClass}>
              Conectar planilha
            </Link>
          )
        }
      >
        <div className="space-y-4 pb-5">
          {!habilitadas.googleSheets && <EmHomologacao />}
          {contas.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-sm" aria-label="Contas Google conectadas">
              {contas.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg border border-premium-borda px-3 py-1.5">
                  <span className="font-medium">{c.email}</span>
                  {c.ativa ? <Selo tom={c.ultimoErro ? 'vermelho' : 'verde'}>{c.ultimoErro ? 'Reconectar' : 'Conectada'}</Selo> : <Selo>Desconectada</Selo>}
                  {podeGerir && c.ativa && (
                    <form action={desconectarGoogleAction}>
                      <input type="hidden" name="conta" value={c.id} />
                      <BotaoConfirmar
                        pergunta={`Desconectar ${c.email}? O acesso do AVANTE é revogado no Google e as planilhas desta conta ficam pausadas. Os leads já importados continuam no CRM.`}
                        className={botaoCompactoClass}
                      >
                        Desconectar
                      </BotaoConfirmar>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {planilhas.length === 0 ? (
            <EstadoVazio compacto titulo="Nenhuma planilha conectada" descricao={podeGerir ? 'Use "Conectar planilha" para escolher a conta, a planilha, a aba e o destino.' : 'Somente o Administrador conecta planilhas.'} />
          ) : (
            <ul className="divide-y divide-premium-borda-suave rounded-lg border border-premium-borda">
              {planilhas.map((p) => (
                <LinhaPlanilha key={p.fonteId} p={p} m={monitoramento[p.fonteId] ?? null} podeGerir={podeGerir} opcoes={opcoes} responsaveis={responsaveis} />
              ))}
            </ul>
          )}
        </div>
      </Secao>

      <Secao
        id="whatsapp-oficial"
        titulo="WhatsApp Business (oficial)"
        descricao="Número próprio da empresa, conectado pelo cadastro oficial da Meta. Quem escreve vira lead no destino do número; a equipe responde pela tela Conversas."
        acoes={
          podeGerir &&
          habilitadas.whatsappOficial && (
            <Link href="/configuracoes/integracoes/whatsapp" className={botaoPrimarioClass}>
              Conectar número
            </Link>
          )
        }
      >
        <div className="space-y-4 pb-5">
          {!habilitadas.whatsappOficial && <EmHomologacao />}
          <Aviso tom="info">
            Política de envio: <strong>Somente envios gratuitos</strong>. Desde 01/10/2026 a Meta dá a cada número 1.000 mensagens de serviço gratuitas por mês;
            a partir daí, até as respostas dentro da janela de 24 h podem ser cobradas. O AVANTE reserva a capacidade antes de cada envio, confere o consumo com a
            Meta e bloqueia novas respostas perto do limite (com margem de segurança) ou quando não consegue confirmar o consumo do mês. Modelos (templates),
            marketing, automações e disparos em massa ficam desativados. O controle vale só para o que sai pelo AVANTE: outros sistemas ligados ao mesmo número
            podem gerar cobrança por conta própria. As regras de preço são da Meta e podem mudar — o AVANTE reduz o risco, mas não garante custo zero.
          </Aviso>
          {numeros.length === 0 ? (
            <EstadoVazio compacto titulo="Nenhum número conectado" descricao={podeGerir ? 'Use "Conectar número" para abrir o cadastro da Meta.' : 'Somente o Administrador conecta números.'} />
          ) : (
            <ul className="divide-y divide-premium-borda-suave rounded-lg border border-premium-borda">
              {numeros.map((n) => (
                <LinhaNumero
                  key={n.fonteId}
                  n={n}
                  podeGerir={podeGerir}
                  opcoes={opcoes}
                  responsaveis={responsaveis}
                  consumo={consumo.filter((c) => c.numeroId === n.numeroId)}
                  franquia={franquia.find((x) => x.numeroId === n.numeroId) ?? null}
                  hoje={hoje}
                />
              ))}
            </ul>
          )}
        </div>
      </Secao>

      {metaAds && <CartaoMetaAds c={metaAds} habilitada={habilitadas.metaConversoes} />}
    </div>
  )
}

const MES = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "Mensagens gratuitas utilizadas / limite estimado" do mês — sem prometer custo zero. */
function PainelFranquia({ f }: { f: FranquiaWhatsapp }) {
  const pct = f.limiteEstimado > 0 ? Math.min(100, Math.round((f.usadas * 100) / f.limiteEstimado)) : 100
  const cor = pct >= 100 ? 'bg-red-600' : pct >= 90 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'
  return (
    <div className="space-y-1.5 rounded-lg border border-premium-borda-suave p-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-premium-texto">Mensagens gratuitas utilizadas / limite estimado ({MES.format(new Date(f.mes))})</span>
        <span className="text-sm font-semibold tabular-nums">
          {f.usadas} / {f.limiteEstimado}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded bg-premium-bg"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={f.limiteEstimado}
        aria-valuenow={f.usadas}
        aria-label="Uso da franquia gratuita"
      >
        <div className={`h-full ${cor}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-premium-mudo">
        Franquia da Meta: {f.limite} por mês neste número; o AVANTE para em {f.limiteEstimado} (margem de {f.margem}).
        {f.reservadas > 0 ? ` ${f.reservadas} envio(s) aguardando confirmação de entrega já contam.` : ''}
        {f.utilizadasMeta !== null ? ` Último total informado pela Meta: ${f.utilizadasMeta}.` : ''}
      </p>
      {f.situacao === 'nao_confirmada' && (
        <p className="text-amber-700 dark:text-amber-300">
          Consumo do mês ainda não confirmado com a Meta{f.ultimoErro ? ` (${f.ultimoErro})` : ''}: respostas bloqueadas por segurança até a próxima
          confirmação automática.
        </p>
      )}
      {f.situacao === 'esgotada' && <p className="text-red-700 dark:text-red-300">Limite estimado atingido: novas respostas ficam bloqueadas até o próximo mês.</p>}
      {f.situacao === 'liberada' && pct >= 80 && <p className="text-amber-700 dark:text-amber-300">Atenção: {pct}% do limite estimado já foi usado neste mês.</p>}
      {f.cobradas > 0 && <p className="text-red-700 dark:text-red-300">A Meta marcou {f.cobradas} mensagem(ns) como cobrada(s) neste mês.</p>}
    </div>
  )
}

/** Integração ainda não liberada pela plataforma: nada conecta, nada sai. */
function EmHomologacao() {
  return (
    <Aviso tom="info" titulo="Em homologação">
      A Rio X7 está homologando esta integração com o provedor oficial. Ela aparece para conexão quando for liberada na plataforma.
    </Aviso>
  )
}

function CartaoMetaAds({ c, habilitada }: { c: ConexaoMetaAds; habilitada: boolean }) {
  if (!habilitada) {
    return (
      <Secao id="meta-ads" titulo="Meta Ads — Conversões do CRM" descricao="Planos Pro e Business.">
        <div className="pb-5">
          <EmHomologacao />
        </div>
      </Secao>
    )
  }
  const rotulo = !c.elegivel
    ? { texto: 'Planos Pro e Business', tom: 'neutro' as TomSelo }
    : !c.conexaoId
      ? { texto: 'Não conectada', tom: 'neutro' as TomSelo }
      : c.situacao === 'ativa'
        ? { texto: 'Enviando conversões', tom: 'verde' as TomSelo }
        : c.situacao === 'erro_autorizacao'
          ? { texto: 'Reconectar na Meta', tom: 'vermelho' as TomSelo }
          : c.situacao === 'pausada'
            ? { texto: 'Pausada', tom: 'neutro' as TomSelo }
            : { texto: 'Falta ativar', tom: 'ambar' as TomSelo }
  return (
    <Secao
      id="meta-ads"
      titulo="Meta Ads — Conversões do CRM"
      descricao="Devolve para a Meta o andamento dos leads de anúncios (Lead Ads): recebido, qualificado, reunião, fechado — para medir e otimizar campanhas pela qualidade do lead."
      acoes={
        <Link href="/configuracoes/integracoes/meta-ads" className={c.elegivel ? botaoPrimarioClass : botaoSecundarioClass}>
          {c.conexaoId ? 'Configurar' : 'Conectar Meta Ads'}
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-2 pb-5 text-sm">
        <Selo tom={rotulo.tom}>{rotulo.texto}</Selo>
        {c.conexaoId && (
          <span className="text-xs text-premium-mudo">
            {c.datasetNome ?? 'Conjunto de dados'} · {c.enviados} aceito(s) · {c.pendentes} na fila · {c.rejeitados} rejeitado(s)
          </span>
        )}
      </div>
    </Secao>
  )
}

function Destino({ i }: { i: IntegracaoOficial }) {
  return (
    <p className="text-xs text-premium-secundario">
      Destino: <span className="font-medium text-premium-texto">{i.funilNome ?? '—'}</span> › {i.etapaNome ?? '—'} · responsável {i.responsavelNome ?? '—'}
    </p>
  )
}

function AlterarDestino({ i, opcoes, responsaveis }: { i: IntegracaoOficial; opcoes: OpcoesDestino; responsaveis: { id: string; nome: string }[] }) {
  return (
    <details className="w-full text-sm">
      <summary className="cursor-pointer text-premium-acento hover:underline">Alterar destino</summary>
      <form action={alterarDestinoAction} className="mt-3 space-y-3 rounded-lg border border-premium-borda-suave p-3">
        <input type="hidden" name="fonte" value={i.fonteId} />
        <SeletorDestino compacto opcoes={opcoes} responsaveis={responsaveis} inicial={{ funilId: i.funilId, etapaId: i.etapaId, responsavelId: i.responsavelId }} />
        <p className="text-xs text-premium-mudo">Vale para os próximos leads. Os que já entraram continuam onde estão. A mudança fica registrada na auditoria.</p>
        <button type="submit" className={botaoSecundarioClass}>
          Salvar destino
        </button>
      </form>
    </details>
  )
}

/**
 * Estado dos avisos do Google Drive. Sem prometer instantaneidade: o Google
 * avisa quando a planilha muda (costuma levar de segundos a alguns minutos) e,
 * por segurança, o AVANTE também confere a planilha periodicamente.
 */
function Monitoramento({ m }: { m: MonitoramentoPlanilha }) {
  const texto: Record<MonitoramentoPlanilha['estado'], { selo: string; tom: TomSelo; detalhe: string }> = {
    ativo: { selo: 'Avisos do Google ativos', tom: 'verde', detalhe: 'Linhas novas entram assim que o Google avisa a alteração — normalmente em segundos ou poucos minutos. A conferência periódica continua como garantia.' },
    ativando: { selo: 'Ativando avisos do Google', tom: 'ambar', detalhe: 'Enquanto isso, a planilha é conferida periodicamente.' },
    desligado: { selo: 'Somente conferência periódica', tom: 'neutro', detalhe: 'Os avisos do Google são ativados depois da primeira sincronização.' },
    erro: { selo: 'Avisos do Google com falha', tom: 'ambar', detalhe: 'Tentaremos de novo em alguns minutos. A conferência periódica continua.' },
    indisponivel: { selo: 'Avisos do Google indisponíveis', tom: 'neutro', detalhe: 'O Google não aceitou o monitoramento desta planilha agora. A conferência periódica continua.' },
  }
  const t = texto[m.estado] ?? texto.desligado
  return (
    <div className="space-y-0.5 text-xs">
      <p className="flex flex-wrap items-center gap-2">
        <Selo tom={t.tom}>{t.selo}</Selo>
        {m.ultimoAviso && <span className="text-premium-mudo">Último aviso do Google: {quando(m.ultimoAviso)}</span>}
      </p>
      <p className="text-premium-mudo">{t.detalhe}</p>
      {m.erro && m.estado !== 'ativo' && <p className="text-premium-mudo">Detalhe: {m.erro}</p>}
    </div>
  )
}

function LinhaPlanilha({ p, m, podeGerir, opcoes, responsaveis }: { p: IntegracaoOficial; m: MonitoramentoPlanilha | null; podeGerir: boolean; opcoes: OpcoesDestino; responsaveis: { id: string; nome: string }[] }) {
  const s = SITUACAO[p.situacao] ?? { rotulo: p.situacao, tom: 'neutro' as TomSelo }
  const pausada = p.situacao === 'pausada' || p.status === 'pausada'
  const semAcessoAoArquivo = p.situacao === 'erro' && /seletor/i.test(p.ultimoErro ?? '')
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-premium-texto">{p.nome}</p>
          <p className="text-xs text-premium-mudo">
            {p.detalhe} {p.conta ? `· ${p.conta}` : ''}
          </p>
        </div>
        <Selo tom={s.tom}>{s.rotulo}</Selo>
      </div>
      <Destino i={p} />
      {m && !pausada && <Monitoramento m={m} />}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-premium-mudo">Importados</dt>
          <dd className="font-medium tabular-nums">{p.importados}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Negociação já aberta</dt>
          <dd className="font-medium tabular-nums">{p.existentes}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Última sincronização</dt>
          <dd>{quando(p.ultimaSincronizacaoEm)}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">{m?.estado === 'ativo' ? 'Conferência periódica' : 'Próxima'}</dt>
          <dd>{pausada ? 'Pausada' : quando(p.proximaSincronizacaoEm)}</dd>
        </div>
      </dl>
      {p.ultimoErro && p.situacao !== 'ativa' && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {p.ultimoErro}
          {p.erros > 0 ? ` · ${p.erros} linha(s) com erro` : ''}
        </p>
      )}
      {podeGerir && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!pausada && p.situacao !== 'erro_autorizacao' && (
            <form action={sincronizarAgoraAction}>
              <input type="hidden" name="fonte" value={p.fonteId} />
              <button type="submit" className={botaoSecundarioClass}>
                Sincronizar agora
              </button>
            </form>
          )}
          {semAcessoAoArquivo && p.contaId && p.planilhaId && <AutorizarArquivo contaId={p.contaId} planilhaId={p.planilhaId} />}
          {p.situacao === 'erro_autorizacao' && (
            <Link href="/configuracoes/integracoes/google-sheets?reconectar=1" className={botaoSecundarioClass}>
              Reconectar conta Google
            </Link>
          )}
          <form action={acaoPlanilhaAction}>
            <input type="hidden" name="fonte" value={p.fonteId} />
            <input type="hidden" name="acao" value={pausada ? 'retomar' : 'pausar'} />
            <button type="submit" className={botaoSecundarioClass}>
              {pausada ? 'Retomar' : 'Pausar'}
            </button>
          </form>
          {p.erros > 0 && (
            <form action={acaoPlanilhaAction}>
              <input type="hidden" name="fonte" value={p.fonteId} />
              <input type="hidden" name="acao" value="reprocessar_erros" />
              <button type="submit" className={botaoSecundarioClass}>
                Tentar de novo as linhas com erro
              </button>
            </form>
          )}
          <form action={acaoPlanilhaAction}>
            <input type="hidden" name="fonte" value={p.fonteId} />
            <input type="hidden" name="acao" value="remover" />
            <BotaoConfirmar pergunta="Desconectar esta planilha? Ela deixa de ser lida. Os leads já importados continuam no CRM." className={botaoPerigoClass}>
              Desconectar planilha
            </BotaoConfirmar>
          </form>
          <AlterarDestino i={p} opcoes={opcoes} responsaveis={responsaveis} />
        </div>
      )}
    </li>
  )
}

function LinhaNumero({
  n,
  podeGerir,
  opcoes,
  responsaveis,
  consumo,
  franquia,
  hoje,
}: {
  n: IntegracaoOficial
  podeGerir: boolean
  opcoes: OpcoesDestino
  responsaveis: { id: string; nome: string }[]
  consumo: ConsumoWhatsapp[]
  franquia: FranquiaWhatsapp | null
  hoje: string
}) {
  const s = SITUACAO[n.situacao] ?? { rotulo: n.situacao, tom: 'neutro' as TomSelo }
  const dia = consumo.find((c) => c.dia === hoje)
  const soma = (k: keyof Pick<ConsumoWhatsapp, 'recebidas' | 'enviadasGratuitas' | 'bloqueadas' | 'cobrancasMeta'>) => consumo.reduce((t, c) => t + c[k], 0)
  const usadosHoje = dia?.enviadasGratuitas ?? 0
  const perto = n.limiteEnviosDia ? usadosHoje >= Math.floor(n.limiteEnviosDia * 0.8) : false
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-premium-texto">{n.nome}</p>
          <p className="text-xs text-premium-mudo">{n.detalhe}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Selo tom={s.tom}>{s.rotulo}</Selo>
          <Selo tom="azul">Somente envios gratuitos</Selo>
        </div>
      </div>
      <Destino i={n} />
      {n.bloqueadoPorCobranca && (
        <Aviso tom="erro">
          A Meta indicou cobrança em uma mensagem deste número. Os envios estão bloqueados até o Administrador revisar o aviso (o número continua em &quot;Somente envios
          gratuitos&quot;).
        </Aviso>
      )}
      {franquia && <PainelFranquia f={franquia} />}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-premium-mudo">Respostas gratuitas hoje</dt>
          <dd className={`font-medium tabular-nums ${perto ? 'text-amber-700 dark:text-amber-300' : ''}`}>
            {usadosHoje}
            {n.limiteEnviosDia ? ` de ${n.limiteEnviosDia}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Recebidas (30 dias)</dt>
          <dd className="font-medium tabular-nums">{soma('recebidas')}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Envios bloqueados (30 dias)</dt>
          <dd className="font-medium tabular-nums">{soma('bloqueadas')}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Avisos de cobrança da Meta</dt>
          <dd className={`font-medium tabular-nums ${soma('cobrancasMeta') > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{soma('cobrancasMeta')}</dd>
        </div>
      </dl>
      {perto && <p className="text-xs text-amber-700 dark:text-amber-300">Perto do limite diário de respostas deste número: ao atingir, os envios param até amanhã.</p>}
      {n.ultimoErro && <p className="text-xs text-red-700 dark:text-red-300">{n.ultimoErro}</p>}
      {podeGerir && n.numeroId && n.situacao === 'pendente_registro' && <RegistrarNumero numeroId={n.numeroId} />}
      {podeGerir && n.numeroId && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {n.bloqueadoPorCobranca && (
            <form action={acaoWhatsappAction}>
              <input type="hidden" name="numero" value={n.numeroId} />
              <input type="hidden" name="acao" value="revisar_cobranca" />
              <BotaoConfirmar
                pergunta="Confirmar que você revisou o aviso de cobrança da Meta? O número volta a responder, sempre só dentro da janela gratuita de 24 h."
                className={botaoSecundarioClass}
              >
                Revisei o aviso de cobrança
              </BotaoConfirmar>
            </form>
          )}
          {n.situacao !== 'desconectado' && n.situacao !== 'pendente_registro' && (
            <form action={acaoWhatsappAction}>
              <input type="hidden" name="numero" value={n.numeroId} />
              <input type="hidden" name="acao" value={n.situacao === 'pausado' ? 'retomar' : 'pausar'} />
              <button type="submit" className={botaoSecundarioClass}>
                {n.situacao === 'pausado' ? 'Retomar' : 'Pausar'}
              </button>
            </form>
          )}
          {n.situacao !== 'desconectado' ? (
            <form action={acaoWhatsappAction}>
              <input type="hidden" name="numero" value={n.numeroId} />
              <input type="hidden" name="acao" value="desconectar" />
              <BotaoConfirmar pergunta="Desconectar este número? A credencial é apagada; as conversas continuam no histórico." className={botaoPerigoClass}>
                Desconectar
              </BotaoConfirmar>
            </form>
          ) : (
            <Link href="/configuracoes/integracoes/whatsapp" className={botaoSecundarioClass}>
              Conectar de novo
            </Link>
          )}
          <AlterarDestino i={n} opcoes={opcoes} responsaveis={responsaveis} />
        </div>
      )}
    </li>
  )
}
