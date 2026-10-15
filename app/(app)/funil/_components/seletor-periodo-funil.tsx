'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { janelaDaVisao, navegar, tituloPeriodo } from '@/lib/utils/calendario'
import { formatarData } from '@/lib/utils/formatacao'
import { PERIODOS_FUNIL, ROTULO_PERIODO_FUNIL, type PeriodoFunil } from '@/lib/utils/periodo'
import { DIAS_SEMANA } from '@/lib/utils/recorrencia'

/**
 * Atalhos de período da tela de métricas do funil (7/30/90 dias, este ano,
 * personalizado) — independentes do `SeletorPeriodo` do dashboard (outros
 * atalhos, outro propósito). Período fica na URL (`?periodo=`, `?inicio=`,
 * `?fim=`); o servidor recalcula tudo.
 *
 * IMPORTANTE pra quem renderiza este componente: passe `key={atual.chave}`
 * (ver `app/(app)/funil/metricas/page.tsx`) — sem isso, trocar de
 * "Personalizado" para um atalho (ou vice-versa) por navegação não
 * reseta o estado local (painel aberto, mês visível, seleção em
 * andamento), porque o React não remonta o componente só porque as
 * `searchParams` da página mudaram. O `key` força o remount exatamente
 * quando a chave ativa muda, e resolve isso de graça.
 */
export function SeletorPeriodoFunil({
  caminho,
  funilId,
  atual,
  hoje,
}: {
  caminho: string
  funilId: string
  atual: PeriodoFunil
  hoje: string
}) {
  const router = useRouter()
  const [abrirPersonalizado, setAbrirPersonalizado] = useState(atual.chave === 'personalizado')
  const [mesVisivel, setMesVisivel] = useState(`${(atual.chave === 'personalizado' ? atual.fim : hoje).slice(0, 7)}-01`)
  const [inicioSel, setInicioSel] = useState<string | null>(atual.chave === 'personalizado' ? atual.inicio : null)
  const [fimSel, setFimSel] = useState<string | null>(atual.chave === 'personalizado' ? atual.fim : null)

  const janela = janelaDaVisao('mes', mesVisivel)
  const mesVisivelPrefixo = mesVisivel.slice(0, 7)

  function clicarDia(dia: string) {
    if (dia > hoje) return
    if (!inicioSel || fimSel) {
      // Primeira escolha desta seleção (ou reinício depois de já ter um intervalo completo).
      setInicioSel(dia)
      setFimSel(null)
      return
    }
    // Já tem início, falta o fim — nunca deixa fim antes de início.
    if (dia < inicioSel) {
      setFimSel(inicioSel)
      setInicioSel(dia)
    } else {
      setFimSel(dia)
    }
  }

  function aplicar() {
    if (!inicioSel) return
    const fim = fimSel ?? inicioSel
    router.push(`${caminho}?funil=${funilId}&periodo=personalizado&inicio=${inicioSel}&fim=${fim}`)
  }

  function cancelar() {
    setAbrirPersonalizado(false)
    setInicioSel(atual.chave === 'personalizado' ? atual.inicio : null)
    setFimSel(atual.chave === 'personalizado' ? atual.fim : null)
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <nav
        aria-label="Período"
        className="inline-flex flex-wrap rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        {PERIODOS_FUNIL.filter((p) => p !== 'personalizado').map((p) => (
          <Link
            key={p}
            href={`${caminho}?funil=${funilId}&periodo=${p}`}
            aria-current={p === atual.chave ? 'page' : undefined}
            className={
              p === atual.chave
                ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'rounded-md px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }
          >
            {ROTULO_PERIODO_FUNIL[p]}
          </Link>
        ))}
        <button
          type="button"
          aria-expanded={abrirPersonalizado}
          aria-current={atual.chave === 'personalizado' ? 'page' : undefined}
          onClick={() => setAbrirPersonalizado((v) => !v)}
          className={
            atual.chave === 'personalizado'
              ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'rounded-md px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }
        >
          {ROTULO_PERIODO_FUNIL.personalizado}
        </button>
      </nav>

      {abrirPersonalizado && (
        <div className="w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMesVisivel(navegar('mes', mesVisivel, -1))}
              aria-label="Mês anterior"
              className="rounded p-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ←
            </button>
            <p className="text-sm font-medium first-letter:uppercase">{tituloPeriodo('mes', mesVisivel, janela)}</p>
            <button
              type="button"
              onClick={() => setMesVisivel(navegar('mes', mesVisivel, 1))}
              aria-label="Próximo mês"
              className="rounded p-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
            {DIAS_SEMANA.map((d) => (
              <span key={d.valor} aria-hidden className="text-zinc-400">
                {d.curto}
              </span>
            ))}
            {janela.dias.map((dia) => {
              const foraDoMes = dia.slice(0, 7) !== mesVisivelPrefixo
              const futuro = dia > hoje
              const eInicio = dia === inicioSel
              const eFim = dia === fimSel
              const noIntervalo = !!inicioSel && !!fimSel && dia > inicioSel && dia < fimSel

              return (
                <button
                  key={dia}
                  type="button"
                  disabled={futuro}
                  onClick={() => clicarDia(dia)}
                  aria-pressed={eInicio || eFim}
                  aria-label={formatarData(dia)}
                  className={`relative mx-auto flex size-7 items-center justify-center text-xs ${
                    eInicio || eFim
                      ? 'rounded-full bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : noIntervalo
                        ? 'bg-zinc-200 dark:bg-zinc-700'
                        : futuro
                          ? 'cursor-not-allowed text-zinc-300 dark:text-zinc-700'
                          : 'rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  } ${foraDoMes && !eInicio && !eFim && !noIntervalo ? 'text-zinc-400 dark:text-zinc-600' : ''}`}
                >
                  {Number(dia.slice(8, 10))}
                </button>
              )
            })}
          </div>

          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            {inicioSel ? (
              <>
                Início: <span className="font-medium">{formatarData(inicioSel)}</span>
                {' · '}
                Fim: <span className="font-medium">{fimSel ? formatarData(fimSel) : '—'}</span>
              </>
            ) : (
              'Selecione a data inicial'
            )}
          </p>

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={cancelar} className={botaoSecundarioClass}>
              Cancelar
            </button>
            <button type="button" onClick={aplicar} disabled={!inicioSel} className={botaoPrimarioClass}>
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
