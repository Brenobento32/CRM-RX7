'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { janelaDaVisao, navegar, tituloPeriodo } from '@/lib/utils/calendario'
import { formatarData } from '@/lib/utils/formatacao'
import { PERIODOS_FUNIL_DIAS, ROTULO_PERIODO_FUNIL, type PeriodoFunil } from '@/lib/utils/periodo'
import { DIAS_SEMANA, somarMeses } from '@/lib/utils/recorrencia'

const LARGURA_CALENDARIO = 320
const LARGURA_MENU_DIAS = 160

/** Classes do botão de atalho de período — ativo (preenchido) ou não (texto neutro). */
function classeAtalho(ativo: boolean): string {
  return ativo
    ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
    : 'rounded-md px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
}

/**
 * Posiciona um popover (fixed) ancorado sob um botão, com clamp nas bordas da
 * viewport — mesma lógica de `MenuMoverPara`/`EmojiPopover`, parametrizada
 * pela largura porque este arquivo tem dois popovers (menu "Dias" e
 * calendário "Personalizado") de tamanhos diferentes.
 */
function posicionarSobBotao(popover: HTMLElement, botao: HTMLElement, largura: number) {
  const r = botao.getBoundingClientRect()
  const altura = popover.offsetHeight
  const cabeEmbaixo = r.bottom + 4 + altura <= window.innerHeight
  popover.style.top = `${cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - 4 - altura)}px`
  popover.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - largura - 8)}px`
}

/**
 * Atalhos de período da tela de métricas do funil — Hoje, Este mês, um menu
 * "Dias" (7/15/30/90) e Personalizado — independentes do `SeletorPeriodo` do
 * dashboard (outros atalhos, outro propósito). Período fica na URL
 * (`?periodo=`, `?inicio=`, `?fim=`); o servidor recalcula tudo.
 *
 * Os dois popovers (menu "Dias" e calendário "Personalizado") usam a Popover
 * API nativa (mesmo padrão de `MenuMoverPara`/`EmojiPopover`): vão para a top
 * layer, não são cortados por nenhum container, e Esc / clique fora já os
 * fecham sozinhos, sem listener de teclado nenhum. A posição é calculada a
 * partir do botão na abertura (`posicionarSobBotao`).
 *
 * IMPORTANTE pra quem renderiza este componente: passe
 * `key={`${atual.chave}-${atual.inicio}-${atual.fim}`}` (ver
 * `app/(app)/funil/metricas/page.tsx`) — a identidade COMPLETA do período
 * aplicado, não só `atual.chave`. Causa raiz de um bug real visto em
 * produção ("calendário abrindo em Setembro de 2025" com o período do
 * cabeçalho mostrando outras datas): `mesVisivel`/`inicioSel`/`fimSel` vivem
 * em `useState`, inicializados só na primeira montagem desta instância. Como
 * `atual.chave` nunca muda entre dois períodos "personalizado" diferentes
 * (a chave é sempre a mesma string), um `key` que olhasse só pra ela nunca
 * remontaria o componente ao navegar de um período personalizado pra outro
 * (ex.: voltar/avançar no histórico do navegador, ou reabrir uma aba deixada
 * aberta por muito tempo) — o calendário ficava preso no mês da PRIMEIRA vez
 * que aquela instância montou, sem nunca reinicializar para refletir o
 * `atual.fim` de verdade. Incluir `inicio`/`fim` no `key` força o remount (e
 * a reinicialização correta de `mesVisivel`) toda vez que o período aplicado
 * muda de fato, mesmo dentro do mesmo atalho "personalizado".
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
  const id = useId()
  const botaoDiasRef = useRef<HTMLButtonElement>(null)
  const menuDiasRef = useRef<HTMLDivElement>(null)
  const botaoCalendarioRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const [mesVisivel, setMesVisivel] = useState(`${(atual.chave === 'personalizado' ? atual.fim : hoje).slice(0, 7)}-01`)
  const [inicioSel, setInicioSel] = useState<string | null>(atual.chave === 'personalizado' ? atual.inicio : null)
  const [fimSel, setFimSel] = useState<string | null>(atual.chave === 'personalizado' ? atual.fim : null)

  const janela = janelaDaVisao('mes', mesVisivel)
  const mesVisivelPrefixo = mesVisivel.slice(0, 7)
  const diasAtivo = (PERIODOS_FUNIL_DIAS as readonly string[]).includes(atual.chave)

  // Menu "Dias": popover simples (sem estado próprio pra reinicializar) — só
  // posicionar sob o botão e fechar em scroll/resize, como MenuMoverPara.
  useEffect(() => {
    const menu = menuDiasRef.current
    const botao = botaoDiasRef.current
    if (!menu || !botao) return

    const fechar = () => menu.hidePopover()
    const aoAlternar = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        posicionarSobBotao(menu, botao, LARGURA_MENU_DIAS)
        // Popover fixo na tela: rolar ou redimensionar o descolaria do botão.
        window.addEventListener('scroll', fechar, true)
        window.addEventListener('resize', fechar)
      } else {
        window.removeEventListener('scroll', fechar, true)
        window.removeEventListener('resize', fechar)
      }
    }
    menu.addEventListener('toggle', aoAlternar)
    return () => {
      menu.removeEventListener('toggle', aoAlternar)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
    }
  }, [])

  useEffect(() => {
    const popover = popoverRef.current
    const botao = botaoCalendarioRef.current
    if (!popover || !botao) return

    const fechar = () => popover.hidePopover()
    const aoAlternar = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        posicionarSobBotao(popover, botao, LARGURA_CALENDARIO)
        window.addEventListener('scroll', fechar, true)
        window.addEventListener('resize', fechar)
      } else {
        window.removeEventListener('scroll', fechar, true)
        window.removeEventListener('resize', fechar)
      }
    }
    popover.addEventListener('toggle', aoAlternar)

    // Reabre sozinho quando o período aplicado já é "personalizado" — ver
    // comentário do componente sobre o `key` completo (chave+início+fim).
    // Precisa vir DEPOIS do `addEventListener`: `showPopover()` dispara o
    // `toggle` na hora, de forma síncrona — com o listener já registrado,
    // `posicionarSobBotao` roda para esta abertura inicial também.
    if (atual.chave === 'personalizado') popover.showPopover()

    return () => {
      popover.removeEventListener('toggle', aoAlternar)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    popoverRef.current?.hidePopover()
    router.push(`${caminho}?funil=${funilId}&periodo=personalizado&inicio=${inicioSel}&fim=${fim}`)
  }

  /** Cancelar/X: descarta a seleção em andamento, volta ao período personalizado já aplicado (se houver) e fecha. */
  function fecharCancelando() {
    setInicioSel(atual.chave === 'personalizado' ? atual.inicio : null)
    setFimSel(atual.chave === 'personalizado' ? atual.fim : null)
    popoverRef.current?.hidePopover()
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <nav
        aria-label="Período"
        className="inline-flex flex-wrap rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <Link
          href={`${caminho}?funil=${funilId}&periodo=hoje`}
          aria-current={atual.chave === 'hoje' ? 'page' : undefined}
          className={classeAtalho(atual.chave === 'hoje')}
        >
          {ROTULO_PERIODO_FUNIL.hoje}
        </Link>
        <Link
          href={`${caminho}?funil=${funilId}&periodo=mes`}
          aria-current={atual.chave === 'mes' ? 'page' : undefined}
          className={classeAtalho(atual.chave === 'mes')}
        >
          {ROTULO_PERIODO_FUNIL.mes}
        </Link>

        <button
          ref={botaoDiasRef}
          type="button"
          popoverTarget={`${id}-dias`}
          aria-haspopup="menu"
          aria-current={diasAtivo ? 'page' : undefined}
          className={classeAtalho(diasAtivo)}
        >
          {diasAtivo ? ROTULO_PERIODO_FUNIL[atual.chave] : 'Dias'} ▾
        </button>

        <button
          ref={botaoCalendarioRef}
          type="button"
          popoverTarget={`${id}-calendario`}
          aria-haspopup="dialog"
          aria-current={atual.chave === 'personalizado' ? 'page' : undefined}
          className={classeAtalho(atual.chave === 'personalizado')}
        >
          {ROTULO_PERIODO_FUNIL.personalizado}
        </button>
      </nav>

      <div
        ref={menuDiasRef}
        id={`${id}-dias`}
        popover="auto"
        role="menu"
        aria-label="Escolher quantidade de dias"
        className="fixed m-0 rounded-lg border border-zinc-200 bg-white p-1 text-sm text-zinc-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        style={{ width: LARGURA_MENU_DIAS, inset: 'auto' }}
      >
        {PERIODOS_FUNIL_DIAS.map((p) => (
          <Link
            key={p}
            href={`${caminho}?funil=${funilId}&periodo=${p}`}
            role="menuitem"
            aria-current={p === atual.chave ? 'page' : undefined}
            onClick={() => menuDiasRef.current?.hidePopover()}
            className={`block rounded-md px-2 py-1.5 transition ${
              p === atual.chave ? 'bg-zinc-100 font-medium dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {ROTULO_PERIODO_FUNIL[p]}
          </Link>
        ))}
      </div>

      <div
        ref={popoverRef}
        id={`${id}-calendario`}
        popover="auto"
        aria-label="Selecionar período personalizado"
        className="fixed m-0 rounded-lg border border-zinc-200 bg-white p-3 text-zinc-900 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        style={{ width: LARGURA_CALENDARIO, inset: 'auto' }}
      >
        <div className="mb-2 flex items-center justify-between gap-1">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setMesVisivel(somarMeses(mesVisivel, -12))}
              aria-label="Ano anterior"
              title="Ano anterior"
              className="rounded p-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setMesVisivel(navegar('mes', mesVisivel, -1))}
              aria-label="Mês anterior"
              title="Mês anterior"
              className="rounded p-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ‹
            </button>
          </div>
          <p className="text-center text-sm font-medium text-zinc-900 first-letter:uppercase dark:text-zinc-100">
            {tituloPeriodo('mes', mesVisivel, janela)}
          </p>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setMesVisivel(navegar('mes', mesVisivel, 1))}
              aria-label="Próximo mês"
              title="Próximo mês"
              className="rounded p-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setMesVisivel(somarMeses(mesVisivel, 12))}
              aria-label="Próximo ano"
              title="Próximo ano"
              className="rounded p-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              »
            </button>
          </div>
          <button
            type="button"
            onClick={fecharCancelando}
            aria-label="Fechar"
            title="Fechar"
            className="ml-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
          {DIAS_SEMANA.map((d) => (
            <span key={d.valor} aria-hidden className="text-zinc-500 dark:text-zinc-400">
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
                className={`relative mx-auto flex size-8 items-center justify-center text-xs ${
                  eInicio || eFim
                    ? 'rounded-full bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : noIntervalo
                      ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                      : futuro
                        ? 'cursor-not-allowed text-zinc-300 dark:text-zinc-600'
                        : 'rounded-full text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800'
                } ${foraDoMes && !eInicio && !eFim && !noIntervalo && !futuro ? 'text-zinc-400 dark:text-zinc-600' : ''}`}
              >
                {Number(dia.slice(8, 10))}
              </button>
            )
          })}
        </div>

        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {inicioSel ? (
            <>
              Início: <span className="font-medium text-zinc-900 dark:text-zinc-100">{formatarData(inicioSel)}</span>
              {' · '}
              Fim:{' '}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {fimSel ? formatarData(fimSel) : '—'}
              </span>
            </>
          ) : (
            'Selecione a data inicial'
          )}
        </p>

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={fecharCancelando} className={botaoSecundarioClass}>
            Cancelar
          </button>
          <button type="button" onClick={aplicar} disabled={!inicioSel} className={botaoPrimarioClass}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}
