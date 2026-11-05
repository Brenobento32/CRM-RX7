'use client'

import { useActionState } from 'react'

import { CampoSenha } from '@/components/ui/campo-senha'
import { ErroCampo } from '@/components/ui/erro-campo'
import { ajudaClass, botaoPrimarioClass, caixaErroClass, caixaSucessoClass } from '@/components/ui/estilos'
import { alterarMinhaSenhaAction } from '@/lib/actions/perfil'
import { REGRAS_SENHA_FORTE } from '@/lib/validations/auth'

/** Meu perfil → Senha: o próprio usuário troca a senha, confirmando a atual. */
export function SenhaForm() {
  const [estado, acao, pendente] = useActionState(alterarMinhaSenhaAction, undefined)
  const erro = (campo: 'senha_atual' | 'nova_senha' | 'confirmar_senha') => estado?.campos?.[campo]?.[0]

  return (
    <form action={acao} noValidate className="space-y-5">
      {estado?.ok && (
        <p role="status" className={caixaSucessoClass}>
          Senha alterada. Na próxima entrada, use a senha nova.
        </p>
      )}
      {estado?.erro && (
        <p role="alert" className={caixaErroClass}>
          {estado.erro}
        </p>
      )}

      <div>
        <label htmlFor="senha_atual" className="mb-1.5 block text-sm font-medium">
          Senha atual
        </label>
        <CampoSenha
          id="senha_atual"
          name="senha_atual"
          autoComplete="current-password"
          required
          maxLength={72}
          aria-invalid={erro('senha_atual') ? true : undefined}
          aria-describedby={erro('senha_atual') ? 'senha_atual-erro' : undefined}
        />
        <ErroCampo id="senha_atual-erro" mensagem={erro('senha_atual')} />
      </div>

      <div>
        <label htmlFor="nova_senha" className="mb-1.5 block text-sm font-medium">
          Nova senha
        </label>
        <CampoSenha
          id="nova_senha"
          name="nova_senha"
          autoComplete="new-password"
          required
          maxLength={72}
          aria-invalid={erro('nova_senha') ? true : undefined}
          aria-describedby={`nova_senha-regras${erro('nova_senha') ? ' nova_senha-erro' : ''}`}
        />
        <ErroCampo id="nova_senha-erro" mensagem={erro('nova_senha')} />
        <ul id="nova_senha-regras" className={`${ajudaClass} list-disc space-y-0.5 pl-4`}>
          {REGRAS_SENHA_FORTE.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <div>
        <label htmlFor="confirmar_senha" className="mb-1.5 block text-sm font-medium">
          Confirmar nova senha
        </label>
        <CampoSenha
          id="confirmar_senha"
          name="confirmar_senha"
          autoComplete="new-password"
          required
          maxLength={72}
          aria-invalid={erro('confirmar_senha') ? true : undefined}
          aria-describedby={erro('confirmar_senha') ? 'confirmar_senha-erro' : undefined}
        />
        <ErroCampo id="confirmar_senha-erro" mensagem={erro('confirmar_senha')} />
      </div>

      <div className="flex justify-end border-t border-premium-borda pt-4">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Alterando…' : 'Alterar senha'}
        </button>
      </div>
    </form>
  )
}
