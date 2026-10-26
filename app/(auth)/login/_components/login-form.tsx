'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { login } from '@/lib/actions/auth'
import { inputClass, botaoPrimarioClass, caixaErroClass } from '@/components/ui/estilos'


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
          className={caixaErroClass}
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
          <Link href="/esqueci-senha" className="text-sm text-premium-mudo hover:underline">
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
        className={`${botaoPrimarioClass} h-10 w-full`}
      >
        {pendente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
