'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { login } from '@/lib/actions/auth'

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

export function LoginForm({ next }: { next: string }) {
  const [estado, action, pendente] = useActionState(login, undefined)

  const erroEmail = estado?.campos?.email?.[0]
  const erroSenha = estado?.campos?.senha?.[0]

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

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

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="senha" className="block text-sm font-medium">
            Senha
          </label>
          <Link href="/esqueci-senha" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
            Esqueci minha senha
          </Link>
        </div>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={erroSenha ? true : undefined}
          aria-describedby={erroSenha ? 'senha-erro' : undefined}
          className={inputClass}
        />
        {erroSenha && (
          <p id="senha-erro" className="text-sm text-red-600 dark:text-red-400">
            {erroSenha}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pendente}
        className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pendente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
