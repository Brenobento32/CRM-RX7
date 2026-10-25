'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { esqueciSenha } from '@/lib/actions/auth'

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

export function EsqueciSenhaForm() {
  const [estado, action, pendente] = useActionState(esqueciSenha, undefined)
  const erroEmail = estado?.campos?.email?.[0]

  // Depois de enviar com sucesso, o formulário sai de cena — nada a corrigir
  // ou reenviar; só a mensagem genérica e o link de volta ao login.
  if (estado?.sucesso) {
    return (
      <div className="space-y-5">
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {estado.sucesso}
        </div>
        <Link href="/login" className="block text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Voltar para o login
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          defaultValue={estado?.email}
          aria-invalid={erroEmail ? true : undefined}
          aria-describedby={erroEmail ? 'email-erro' : undefined}
          className={inputClass}
        />
        {erroEmail && (
          <p id="email-erro" className="text-sm text-red-600 dark:text-red-400">
            {erroEmail}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pendente}
        className="w-full rounded-md bg-premium-acento px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-premium-acento disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-950"
      >
        {pendente ? 'Enviando…' : 'Enviar instruções'}
      </button>

      <Link href="/login" className="block text-center text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        Voltar para o login
      </Link>
    </form>
  )
}
