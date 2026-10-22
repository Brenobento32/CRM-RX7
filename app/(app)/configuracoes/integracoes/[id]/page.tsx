import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { botaoPrimarioClass, botaoSecundarioClass, inputClass } from '@/components/ui/estilos'
import {
  revogarFonteAction,
  salvarFonteAction,
  segredoFonteAction,
  statusFonteAction,
  validarFonteAction,
} from '@/lib/actions/fontes-leads'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { enderecosIntegracao, listarEventos, obterFonte, opcoesDeDestino, podeGerirFontes, type Fonte } from '@/lib/dal/fontes-leads'
import { serverEnv } from '@/lib/env/server'
import { itemDoTipo, situacaoDaFonte } from '@/lib/integracoes/catalogo'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

import { CamposFonte } from '../_components/campos-fonte'
import { GirarToken } from '../_components/token-uma-vez'

export const metadata: Metadata = {
  title: 'Fonte de leads',
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function FontePage({ params, searchParams }: Props) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()
  const [{ id }, busca] = await Promise.all([params, searchParams])
  if (!UUID.test(id)) notFound()

  const fonte = await obterFonte(id)
  if (!fonte) notFound()
  const [eventos, podeGerir, opcoes, responsaveis] = await Promise.all([
    listarEventos(id),
    podeGerirFontes(),
    opcoesDeDestino(),
    listarResponsaveis(),
  ])
  const item = itemDoTipo(fonte.tipo)
  const situacao = situacaoDaFonte(fonte)
  const ativa = fonte.status !== 'revogada'
  const ok = typeof busca.ok === 'string' ? busca.ok : null
  const erro = typeof busca.erro === 'string' ? busca.erro : null

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/configuracoes/integracoes" className="text-sm text-zinc-500 hover:underline">
          ← Integrações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{fonte.nome}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {item.nome} · {situacao.rotulo}
          {fonte.ultimoLeadEm ? ` · último lead ${formatarDataHoraCompleta(fonte.ultimoLeadEm)}` : ''}
        </p>
      </div>
      {ok && <p role="status" className="text-sm text-emerald-700">{ok}</p>}
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
      {fonte.ultimoErro && ativa && (
        <p className="text-sm text-red-600">
          Último erro{fonte.ultimoErroEm ? ` (${formatarDataHoraCompleta(fonte.ultimoErroEm)})` : ''}: {fonte.ultimoErro}
        </p>
      )}

      {ativa && <Instrucoes fonte={fonte} />}

      {ativa && podeGerir && (
        <>
          {item.usaToken && (
            <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="font-semibold">Token</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Atual: <code>{fonte.tokenPrefixo}…</code> (o restante nunca é mostrado de novo).
              </p>
              <GirarToken id={fonte.id} />
            </section>
          )}

          {item.exigeValidacao && (
            <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="font-semibold">Conexão com a Meta</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {fonte.validadaEm
                  ? `Validada em ${formatarDataHoraCompleta(fonte.validadaEm)}.`
                  : 'Ainda não validada: nenhum evento é aceito até a validação com o token da empresa.'}
              </p>
              <form action={segredoFonteAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={fonte.id} />
                <label className="block flex-1 text-sm">
                  <span className="mb-1 block font-medium">
                    {fonte.tipo === 'meta_lead_ads' ? 'Token de acesso da página' : 'Token de acesso do WhatsApp Cloud API'}
                  </span>
                  <input name="segredo" type="password" autoComplete="off" required minLength={20} className={inputClass} />
                </label>
                <button type="submit" className={botaoSecundarioClass}>
                  Guardar no cofre
                </button>
              </form>
              <form action={validarFonteAction}>
                <input type="hidden" name="id" value={fonte.id} />
                <button type="submit" className={botaoPrimarioClass}>
                  Validar com a Meta
                </button>
              </form>
            </section>
          )}

          <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">Destino e configuração</h2>
            <form action={salvarFonteAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={fonte.id} />
              <input type="hidden" name="tipo" value={fonte.tipo} />
              <CamposFonte
                tipo={fonte.tipo}
                opcoes={opcoes}
                responsaveis={responsaveis.map((r) => ({ id: r.id, nome: r.nome }))}
                valores={{
                  nome: fonte.nome,
                  destino: `${fonte.funilId}|${fonte.etapaId}`,
                  responsavelId: fonte.responsavelId,
                  configuracao: fonte.configuracao,
                }}
              />
              <div className="sm:col-span-2">
                <button type="submit" className={botaoPrimarioClass}>
                  Salvar
                </button>
              </div>
            </form>
          </section>

          <section className="flex flex-wrap gap-3">
            <form action={statusFonteAction}>
              <input type="hidden" name="id" value={fonte.id} />
              <input type="hidden" name="status" value={fonte.status === 'ativa' ? 'pausada' : 'ativa'} />
              <button type="submit" className={botaoSecundarioClass}>
                {fonte.status === 'ativa' ? 'Pausar' : 'Ativar'}
              </button>
            </form>
            <form action={revogarFonteAction}>
              <input type="hidden" name="id" value={fonte.id} />
              <button type="submit" className={`${botaoSecundarioClass} text-red-600`}>
                Revogar (definitivo)
              </button>
            </form>
          </section>
        </>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Últimos recebimentos</h2>
        {eventos.length === 0 ? (
          <p className="text-sm text-zinc-500">Nada recebido ainda.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-3 py-2">Quando</th>
                  <th className="px-3 py-2">Resultado</th>
                  <th className="px-3 py-2">Identificador</th>
                  <th className="px-3 py-2">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {eventos.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-3 py-2">{formatarDataHoraCompleta(e.recebidoEm)}</td>
                    <td className="px-3 py-2">{e.resultado}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.externalId ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.erroMensagem ?? e.erroCodigo ?? (e.negociacaoId ? 'negociação criada/atualizada' : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/** Como conectar, por tipo. Nunca mostra segredo: só endereços e o formato. */
function Instrucoes({ fonte }: { fonte: Fonte }) {
  const end = enderecosIntegracao()
  const caixa = 'space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800'
  const codigo = 'block overflow-x-auto whitespace-pre rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900'

  if (fonte.tipo === 'formulario_rx7') {
    return (
      <section className={caixa}>
        <h2 className="font-semibold">Link do formulário</h2>
        <code className={codigo}>{`${serverEnv.siteUrl.replace(/\/+$/, '')}/f/${fonte.id}`}</code>
        <p className="text-zinc-600 dark:text-zinc-400">Divulgue este link (site, bio, anúncios). Ele não contém nenhum segredo.</p>
      </section>
    )
  }
  if (fonte.tipo === 'webhook' || fonte.tipo === 'google_sheets' || fonte.tipo === 'respondi') {
    return (
      <section className={caixa}>
        <h2 className="font-semibold">Como conectar</h2>
        <code className={codigo}>{`POST ${end.webhook}\nAuthorization: Bearer <token da fonte>`}</code>
        {fonte.tipo === 'webhook' && (
          <code className={codigo}>{`{ "external_id": "id-do-lead-no-seu-sistema",\n  "dados": { "nome": "…", "telefone": "…", "email": "…" },\n  "atribuicao": { "utm_source": "…" } }`}</code>
        )}
        {fonte.tipo === 'respondi' && (
          <p className="text-zinc-600 dark:text-zinc-400">
            No Respondi da empresa, configure o webhook para este endereço com o header acima. Se o Respondi não aceitar
            header, use <code>?token=&lt;token da fonte&gt;</code> no fim da URL. O primeiro envio confirma a conexão.
          </p>
        )}
        {fonte.tipo === 'google_sheets' && (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              Na planilha: Extensões → Apps Script. Guarde o token em Propriedades do script (<code>RX7_TOKEN</code>) e crie
              um acionador &quot;Ao enviar formulário&quot; ou &quot;Ao editar&quot; para esta função:
            </p>
            <code className={codigo}>{`function enviarLeadRx7(e) {
  const linha = e.range.getRow();
  const aba = e.range.getSheet();
  const [nome, telefone, email] = aba.getRange(linha, 1, 1, 3).getValues()[0];
  UrlFetchApp.fetch('${end.webhook}', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + PropertiesService.getScriptProperties().getProperty('RX7_TOKEN') },
    payload: JSON.stringify({
      external_id: aba.getSheetId() + ':' + linha,
      dados: { nome: nome, telefone: String(telefone), email: email }
    })
  });
}`}</code>
          </>
        )}
      </section>
    )
  }
  return (
    <section className={caixa}>
      <h2 className="font-semibold">Como conectar</h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        O app da Meta da Rio X7 recebe os eventos em <code>{end.meta}</code>. A empresa informa{' '}
        {fonte.tipo === 'meta_lead_ads' ? 'a página e o token de acesso dela' : 'o número (Phone Number ID) e o token dela'}, e o
        CRM valida com a Meta antes de aceitar qualquer lead.
      </p>
    </section>
  )
}
