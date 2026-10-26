'use client'

import { useLayoutEffect } from 'react'

import { COOKIE_TEMA, TEMA_CLARO, TEMA_ESCURO } from './preferencia-tema'

/**
 * Rede de segurança do tema: em alguns caminhos (ex.: `notFound()` lançado
 * num layout) o Next renderiza a página sem rodar o script do `<head>`, e o
 * `<html>` fica sem `data-tema` — caindo no escuro mesmo com o claro escolhido.
 * Aqui, se o atributo estiver ausente, aplica o mesmo critério do script
 * (cookie; senão, preferência do sistema). Não grava nada.
 */
export function GarantirTema() {
  useLayoutEffect(() => {
    const html = document.documentElement
    if (html.hasAttribute('data-tema')) return
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_TEMA}=([^;]+)`))
    const salvo = m ? decodeURIComponent(m[1]) : null
    const tema =
      salvo === TEMA_CLARO || salvo === TEMA_ESCURO
        ? salvo
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? TEMA_CLARO
          : TEMA_ESCURO
    html.setAttribute('data-tema', tema)
  }, [])
  return null
}
