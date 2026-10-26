'use client'

import { useActionState } from 'react'

import { redefinirSenhaAction } from '@/lib/actions/auth'
import { inputClass, botaoPrimarioClass, caixaErroClass } from '@/components/ui/estilos'


export function RedefinirSenhaForm() {
  const [estado, action, pendente] = useActionState(redefinirSenhaAction, undefined)
  const erroSenha = estado?.campos?.senha?.[0]
  const erroConfirmar = estado?.campos?.confirmar_senha?.[0]

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
        className={`${botaoPrimarioClass} h-10 w-full`}
      >
        {pendente ? 'Salvando…' : 'Salvar nova senha'}
      </button>
    </form>
  )
}
