'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { botaoPrimarioClass, caixaErroClass, erroCampoClass, inputClass, labelClass } from '@/components/ui/estilos'
import { loginAdmin } from '@/lib/actions/auth'

/** Formulário do portal da administração. O privilégio é conferido no servidor (`loginAdmin`). */
export function LoginAdminForm({ next }: { next: string }) {
  const [estado, action, pendente] = useActionState(loginAdmin, undefined)
  const erroEmail = estado?.campos?.email?.[0]
  const erroSenha = estado?.campos?.senha?.[0]

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {estado?.erro && (
        <div role="alert" className={caixaErroClass}>
          {estado.erro}
        </div>
      )}

      <div>
        <label htmlFor="admin-email" className={labelClass}>
          E-mail
        </label>
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={estado?.email}
          aria-invalid={erroEmail ? true : undefined}
          aria-describedby={erroEmail ? 'admin-email-erro' : undefined}
          className={inputClass}
        />
        {erroEmail && (
          <p id="admin-email-erro" className={erroCampoClass}>
            {erroEmail}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="admin-senha" className={labelClass}>
            Senha
          </label>
          <Link href="/esqueci-senha?portal=admin" className="text-sm text-premium-mudo hover:text-premium-texto hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <input
          id="admin-senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={erroSenha ? true : undefined}
          aria-describedby={erroSenha ? 'admin-senha-erro' : undefined}
          className={inputClass}
        />
        {erroSenha && (
          <p id="admin-senha-erro" className={erroCampoClass}>
            {erroSenha}
          </p>
        )}
      </div>

      <button type="submit" disabled={pendente} className={`${botaoPrimarioClass} h-10 w-full`}>
        {pendente ? 'Verificando…' : 'Entrar na administração'}
      </button>
    </form>
  )
}
