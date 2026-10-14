'use client'

import { useActionState } from 'react'

import { redefinirSenhaAction } from '@/lib/actions/auth'

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

export function RedefinirSenhaForm() {
  const [estado, action, pendente] = useActionState(redefinirSenhaAction, undefined)
  const erroSenha = estado?.campos?.senha?.[0]
  const erroConfirmar = estado?.campos?.confirmar_senha?.[0]

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
        <label htmlFor="senha" className="block text-sm font-medium">
          Nova senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
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

      <div className="space-y-1.5">
        <label htmlFor="confirmar_senha" className="block text-sm font-medium">
          Confirmar nova senha
        </label>
        <input
          id="confirmar_senha"
          name="confirmar_senha"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={erroConfirmar ? true : undefined}
          aria-describedby={erroConfirmar ? 'confirmar-senha-erro' : undefined}
          className={inputClass}
        />
        {erroConfirmar && (
          <p id="confirmar-senha-erro" className="text-sm text-red-600 dark:text-red-400">
            {erroConfirmar}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pendente}
        className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pendente ? 'Salvando…' : 'Salvar nova senha'}
      </button>
    </form>
  )
}
