import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { botaoPrimarioClass, botaoSecundarioClass, inputClass } from '@/components/ui/estilos'
import { conectarGoogleAction, desconectarGoogleAction } from '@/lib/actions/agenda-google'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { diagnosticarCoresGoogle, obterConexaoGoogle, type ConexaoGoogle } from '@/lib/dal/agenda-google'
import { formatarData, formatarDataHoraCompleta, formatarDia } from '@/lib/utils/formatacao'

export const metadata: Metadata = {
  title: 'Agenda Google',
}

const JANELAS_PASSADO = [30, 90, 180, 365] as const
const JANELAS_FUTURO = [0, 30, 90, 180] as const

/** Motivos que a Edge Function devolve no retorno do OAuth. */
const MOTIVOS: Record<string, string> = {
  expirado: 'O link de conexão expirou. Tente de novo.',
  negado: 'A autorização foi cancelada no Google.',
  escopo: 'A permissão de ver a agenda não foi concedida. Marque-a na tela do Google.',
  sem_refresh: 'O Google não enviou o acesso permanente. Remova o acesso do app na conta Google e conecte de novo.',
  google: 'O Google recusou a conexão. Tente de novo em instantes.',
}

/** Evento de dia inteiro chega só com a data (AAAA-MM-DD): não passa por fuso. */
function dataDoGoogle(valor: string) {
  return valor.length === 10 ? formatarDia(valor) : formatarData(valor)
}

function escolher<T extends number>(valor: unknown, opcoes: readonly T[], padrao: T): T {
  const n = Number(valor)
  return (opcoes as readonly number[]).includes(n) ? (n as T) : padrao
}

export default async function AgendaGooglePage({ searchParams }: PageProps<'/configuracoes/agenda'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const params = await searchParams
  const conexao = await obterConexaoGoogle()
  const rodarDiagnostico = params.diagnostico === '1'
  const passado = escolher(params.passado, JANELAS_PASSADO, 90)
  const futuro = escolher(params.futuro, JANELAS_FUTURO, 90)

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Agenda Google</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Conexão com o Google Calendar da empresa. Somente leitura: o CRM não altera nada no Google.
        </p>
      </div>

      <AvisoRetorno params={params} />

      <CardConexao conexao={conexao} />

      {conexao && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Diagnóstico de cores</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Agrupa os eventos da agenda pela cor, para definirmos o que cada cor significa. Só lê o
              Google — nada é gravado no CRM.
            </p>
          </div>

          <form className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="diagnostico" value="1" />
            <label className="text-sm">
              <span className="mb-1 block font-medium">Para trás</span>
              <select name="passado" defaultValue={passado} className={inputClass}>
                {JANELAS_PASSADO.map((d) => (
                  <option key={d} value={d}>
                    {d} dias
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Para frente</span>
              <select name="futuro" defaultValue={futuro} className={inputClass}>
                {JANELAS_FUTURO.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'Nenhum' : `${d} dias`}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={botaoPrimarioClass}>
              {rodarDiagnostico ? 'Rodar de novo' : 'Rodar diagnóstico'}
            </button>
          </form>

          {rodarDiagnostico && (
            <Suspense
              key={`${passado}-${futuro}`}
              fallback={<p className="text-sm text-zinc-500">Lendo a agenda do Google…</p>}
            >
              <ResultadoDiagnostico passado={passado} futuro={futuro} />
            </Suspense>
          )}
        </section>
      )}
    </div>
  )
}

function AvisoRetorno({ params }: { params: Record<string, string | string[] | undefined> }) {
  const texto = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const status = texto(params.google)
  if (!status) return null

  if (status === 'conectado' || status === 'desconectado') {
    return (
      <p
        role="status"
        className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
      >
        {status === 'conectado' ? 'Conta Google conectada.' : 'Conta Google desconectada.'}
      </p>
    )
  }

  const motivo = texto(params.motivo)
  const conta = texto(params.conta)
  const mensagem =
    texto(params.mensagem) ??
    (motivo === 'conta'
      ? `A conta ${conta ?? 'escolhida'} não é a agenda da empresa. Entre com a conta comercial da Scorpion.`
      : (MOTIVOS[motivo ?? ''] ?? 'Não foi possível conectar ao Google.'))

  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {mensagem}
    </p>
  )
}

function CardConexao({ conexao }: { conexao: ConexaoGoogle | null }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-semibold">Conexão</h2>
          {conexao ? (
            <>
              <p className="text-sm">
                <span className="mr-2 inline-block size-2 rounded-full bg-emerald-500" aria-hidden />
                Conectado como <span className="font-medium">{conexao.contaEmail}</span>
              </p>
              <p className="text-xs text-zinc-500">
                Desde {formatarDataHoraCompleta(conexao.conectadoEm)}
                {conexao.conectadoPor && ` · por ${conexao.conectadoPor}`}
              </p>
              {conexao.ultimoErro && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Último erro{conexao.ultimoErroEm && ` (${formatarDataHoraCompleta(conexao.ultimoErroEm)})`}:{' '}
                  {conexao.ultimoErro}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Nenhuma conta conectada. Entre com a conta Google da agenda comercial.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <form action={conectarGoogleAction}>
            <button type="submit" className={conexao ? botaoSecundarioClass : botaoPrimarioClass}>
              {conexao ? 'Reconectar' : 'Conectar Google'}
            </button>
          </form>
          {conexao && (
            <form action={desconectarGoogleAction}>
              <button type="submit" className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}>
                Desconectar
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}

async function ResultadoDiagnostico({ passado, futuro }: { passado: number; futuro: number }) {
  const r = await diagnosticarCoresGoogle(passado, futuro)

  if (!r.ok) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        {r.mensagem}
      </p>
    )
  }

  const ignorados = Object.entries(r.ignoradosPorTipo)

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {r.total} {r.total === 1 ? 'evento' : 'eventos'} entre {formatarData(r.periodo.inicio)} e{' '}
        {formatarData(r.periodo.fim)} em <span className="font-medium">{r.conta}</span>.
        {r.truncado && ' Leitura interrompida no limite de eventos: os números são parciais.'}
        {ignorados.length > 0 &&
          ` Fora da contagem: ${ignorados.map(([tipo, n]) => `${n} ${tipo}`).join(', ')}.`}
      </p>

      {r.cores.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nenhum evento no período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-3 font-medium">Cor</th>
                <th className="px-4 py-3 text-right font-medium">Eventos</th>
                <th className="px-4 py-3 font-medium">Período</th>
                <th className="px-4 py-3 font-medium">Exemplos de título</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 align-top dark:divide-zinc-800">
              {r.cores.map((c) => (
                <tr key={c.colorId ?? 'padrao'}>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        aria-hidden
                        className="size-4 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: c.hex ?? 'transparent' }}
                      />
                      {c.nome}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {c.colorId ? `colorId ${c.colorId}` : 'sem colorId'}
                      {c.hex && ` · ${c.hex}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {c.eventos}
                    {c.diaInteiro > 0 && <p className="text-xs text-zinc-500">{c.diaInteiro} dia inteiro</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    {c.primeiro && dataDoGoogle(c.primeiro)}
                    {c.ultimo && c.ultimo !== c.primeiro && ` – ${dataDoGoogle(c.ultimo)}`}
                  </td>
                  <td className="px-4 py-3">
                    <ul className="space-y-0.5">
                      {c.exemplos.map((t) => (
                        <li key={t} className="truncate" title={t}>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
