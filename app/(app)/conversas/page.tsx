import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Aviso, AvisoDaUrl } from '@/components/ui/aviso'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { Selo } from '@/components/ui/selo'
import { levarConversaAoFunilAction, marcarConversaRevisadaAction } from '@/lib/actions/integracoes-oficiais'
import {
  conversaNoFunil,
  conversasARevisar,
  integracoesHabilitadas,
  janelaDaConversa,
  listarConversasOficiais,
  mensagensDaConversa,
} from '@/lib/dal/integracoes-oficiais'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

import { AtualizarSozinho } from './atualizar-sozinho'
import { ResponderConversa } from './responder-conversa'

export const metadata: Metadata = { title: 'Conversas' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS: Record<string, string> = { enviando: 'Enviando…', enviado: 'Enviada', entregue: 'Entregue', lido: 'Lida', falhou: 'Falhou', pendente: 'Pendente' }
const ORIGEM_APP = { eco_app: 'pelo app WhatsApp Business', historico: 'histórico do app' } as const

/**
 * Caixa de entrada do WhatsApp oficial. O banco decide quem vê o quê
 * (Administrador: todas; demais cargos: só conversas de clientes da própria
 * carteira) e se uma resposta pode sair (janela gratuita, limite, cobrança).
 */
export default async function ConversasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  if (!(await integracoesHabilitadas()).whatsappOficial) {
    return (
      <div className="space-y-5">
        <PageHeaderPremium titulo="Conversas" subtitulo="WhatsApp oficial da empresa." />
        <EstadoVazio titulo="WhatsApp oficial em homologação" descricao="A caixa de entrada fica disponível quando a Rio X7 liberar o WhatsApp oficial na plataforma." />
      </div>
    )
  }
  const [conversas, revisar] = await Promise.all([listarConversasOficiais(), conversasARevisar()])
  const aRevisar = new Set(revisar)
  const pedida = typeof params.c === 'string' && UUID.test(params.c) ? params.c : null
  const atual = conversas.find((c) => c.id === pedida) ?? null
  const [mensagens, janela, noFunil] = atual
    ? await Promise.all([mensagensDaConversa(atual.id), janelaDaConversa(atual.id), conversaNoFunil(atual.id)])
    : [[], null, null]

  return (
    <div className="space-y-5">
      <PageHeaderPremium titulo="Conversas" subtitulo="WhatsApp oficial da empresa. Você vê as conversas dos clientes que atende." />
      <AtualizarSozinho segundos={20} />
      <AvisoDaUrl ok={params.ok} erro={params.erro} />
      {conversas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma conversa por aqui"
          descricao="Quando um cliente da sua carteira escrever para o número oficial da empresa, a conversa aparece nesta tela."
        />
      ) : (
        <div className="grid min-h-[60vh] gap-4 lg:grid-cols-[320px_1fr]">
          <nav aria-label="Conversas" className="overflow-hidden rounded-xl border border-premium-borda bg-premium-card">
            <ul className="max-h-[70vh] divide-y divide-premium-borda-suave overflow-y-auto">
              {conversas.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/conversas?c=${c.id}`}
                    aria-current={c.id === atual?.id ? 'page' : undefined}
                    className={`block px-4 py-3 text-sm transition-colors hover:bg-premium-bg ${c.id === atual?.id ? 'bg-premium-bg' : ''}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-premium-texto">{c.clienteNome ?? c.nomeContato ?? c.telefone}</span>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1">
                        {aRevisar.has(c.id) && <Selo tom="roxo">Revisar</Selo>}
                        {c.previaDirecao === 'entrada' && c.ultimaEntradaEm && <Selo tom="ambar">Aguardando resposta</Selo>}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-premium-mudo">{c.previa ?? '—'}</span>
                    <span className="block text-[11px] text-premium-mudo">
                      {c.ultimaMensagemEm ? formatarDataHoraCompleta(c.ultimaMensagemEm) : ''} · {c.numero ?? 'número oficial'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-label="Mensagens" className="flex min-w-0 flex-col rounded-xl border border-premium-borda bg-premium-card">
            {!atual ? (
              <div className="m-auto p-6 text-sm text-premium-mudo">Escolha uma conversa.</div>
            ) : (
              <>
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-premium-borda-suave px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-premium-texto">{atual.clienteNome ?? atual.nomeContato ?? atual.telefone}</p>
                    <p className="text-xs text-premium-mudo">
                      +{atual.telefone} · pelo número {atual.numero ?? 'oficial'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {noFunil?.revisarOrigem && <Selo tom="roxo">Origem a revisar</Selo>}
                    {noFunil?.contatoDoApp && !noFunil.revisarOrigem && !noFunil.negociacaoId && <Selo tom="azul">Contato do app</Selo>}
                    {noFunil?.negociacaoId && (
                      <Link href={`/negociacoes/${noFunil.negociacaoId}/editar`} className="text-sm font-medium text-premium-acento hover:underline">
                        Negociação{noFunil.funil ? `: ${noFunil.funil}` : ''}
                        {noFunil.etapa ? ` › ${noFunil.etapa}` : ''}
                      </Link>
                    )}
                    {noFunil?.podeLevar && (
                      <form action={levarConversaAoFunilAction}>
                        <input type="hidden" name="conversa" value={atual.id} />
                        <button type="submit" className="rounded-lg border border-premium-borda px-3 py-1.5 text-sm font-medium text-premium-texto hover:bg-premium-bg">
                          Levar para o funil
                        </button>
                      </form>
                    )}
                    {noFunil?.revisarOrigem && (
                      <form action={marcarConversaRevisadaAction}>
                        <input type="hidden" name="conversa" value={atual.id} />
                        <button type="submit" className="rounded-lg px-3 py-1.5 text-sm font-medium text-premium-secundario hover:bg-premium-bg">
                          Não é lead novo
                        </button>
                      </form>
                    )}
                    {noFunil && !noFunil.negociacaoId && !noFunil.fonteAtiva && (
                      <span className="text-xs text-premium-mudo">Entrada de leads deste número pausada</span>
                    )}
                    {(atual.clienteId ?? noFunil?.clienteId) && (
                      <Link href={`/clientes/${atual.clienteId ?? noFunil?.clienteId}`} className="text-sm font-medium text-premium-acento hover:underline">
                        Abrir cliente
                      </Link>
                    )}
                  </div>
                </header>
                {(noFunil?.revisarOrigem || noFunil?.emInicializacao) && (
                  <div className="border-b border-premium-borda-suave px-5 py-2 text-xs text-premium-secundario">
                    {noFunil.emInicializacao
                      ? 'Número do app em inicialização: as mensagens não viram lead sozinhas até o Administrador concluir em Integrações. '
                      : ''}
                    {noFunil.revisarOrigem
                      ? 'O AVANTE não tem como saber se este contato já era cliente no app (escreveu durante a inicialização ou está na agenda do app). Se for lead novo, leve para o funil.'
                      : ''}
                  </div>
                )}
                <ol className="flex max-h-[55vh] flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
                  {mensagens.map((m) => (
                    <li
                      key={m.id}
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                        m.direcao === 'saida' ? 'self-end bg-premium-acento/10 text-premium-texto' : 'self-start border border-premium-borda bg-premium-bg text-premium-texto'
                      }`}
                    >
                      <p className="break-words whitespace-pre-wrap">{m.conteudo ?? (m.tipo === 'texto' ? '' : `(${m.tipo} — abra no celular)`)}</p>
                      <p className="mt-1 text-[11px] text-premium-mudo">
                        {formatarDataHoraCompleta(m.createdAt)}
                        {m.direcao === 'saida' && m.status ? ` · ${STATUS[m.status] ?? m.status}` : ''}
                        {m.origemApp ? ` · ${ORIGEM_APP[m.origemApp]}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
                <div className="border-t border-premium-borda-suave px-5 py-3">
                  {janela?.motivo === 'bloqueado_por_cobranca' && (
                    <Aviso tom="erro">Envios bloqueados: a Meta indicou cobrança neste número. O Administrador precisa revisar o aviso em Integrações.</Aviso>
                  )}
                  {janela?.motivo === 'numero_inativo' && <Aviso tom="alerta">O número oficial está pausado ou desconectado.</Aviso>}
                  {janela?.motivo === 'fora_da_janela' && (
                    <Aviso tom="alerta">
                      Fora da janela de 24 h: responder agora exigiria um modelo pago, bloqueado pela política &quot;Somente envios gratuitos&quot;. Quando o cliente escrever de
                      novo, a resposta volta a ser liberada.
                    </Aviso>
                  )}
                  {janela?.motivo === 'franquia_esgotada' && (
                    <Aviso tom="alerta">
                      As mensagens de serviço gratuitas deste número chegaram ao limite estimado do mês. Novas respostas poderiam ser cobradas pela Meta, por isso
                      estão bloqueadas. A conversa continua recebendo mensagens normalmente.
                    </Aviso>
                  )}
                  {janela?.motivo === 'franquia_nao_confirmada' && (
                    <Aviso tom="alerta">
                      Ainda não foi possível confirmar com a Meta quantas mensagens gratuitas restam neste mês. Por segurança, as respostas ficam bloqueadas até a
                      próxima confirmação automática (o Administrador acompanha em Integrações).
                    </Aviso>
                  )}
                  {janela?.aberta && (
                    <ResponderConversa conversaId={atual.id} abertaAte={janela.abertaAte} />
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
