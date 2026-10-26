'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { esqueciSenha } from '@/lib/actions/auth'
import { inputClass, botaoPrimarioClass, caixaErroClass, caixaSucessoClass } from '@/components/ui/estilos'


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
          className={caixaSucessoClass}
        >
          {estado.sucesso}
        </div>
        <Link href="/login" className="block text-sm text-premium-secundario hover:underline">
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
        className={`${botaoPrimarioClass} h-10 w-full`}
      >
        {pendente ? 'Enviando…' : 'Enviar instruções'}
      </button>

      <Link href="/login" className="block text-center text-sm text-premium-secundario hover:underline">
        Voltar para o login
      </Link>
    </form>
  )
}
