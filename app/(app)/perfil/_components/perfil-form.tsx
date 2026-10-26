'use client'

import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass, caixaErroClass, caixaSucessoClass } from '@/components/ui/estilos'
import { SeletorCor } from '@/components/ui/seletor-cor'
import { atualizarMeuPerfilAction } from '@/lib/actions/perfil'

export function PerfilForm({ nome, telefone, cor }: { nome: string; telefone: string; cor: string }) {
  const [estado, acao, pendente] = useActionState(atualizarMeuPerfilAction, undefined)

  return (
    <form action={acao} noValidate className="space-y-5">
      {estado?.ok && (
        <p role="status" className={caixaSucessoClass}>
          Perfil atualizado.
        </p>
      )}
      {estado?.erro && (
        <p role="alert" className={caixaErroClass}>
          {estado.erro}
        </p>
      )}

      <div>
        <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
          Nome
        </label>
        <input id="nome" name="nome" defaultValue={nome} required maxLength={120} className={inputClass} aria-invalid={estado?.campos?.nome ? true : undefined} />
        <ErroCampo mensagem={estado?.campos?.nome?.[0]} />
      </div>

      <div>
        <label htmlFor="telefone" className="mb-1.5 block text-sm font-medium">
          Telefone (opcional)
        </label>
        <input id="telefone" name="telefone" type="tel" defaultValue={telefone} maxLength={20} className={inputClass} aria-invalid={estado?.campos?.telefone ? true : undefined} />
        <ErroCampo mensagem={estado?.campos?.telefone?.[0]} />
      </div>

      <SeletorCor
        name="cor_agenda"
        legenda="Cor na agenda"
        valorInicial={cor}
        permitirVazio
        ajuda="As suas reuniões aparecem nesta cor na agenda da equipe."
        erro={estado?.campos?.cor_agenda?.[0]}
      />

      <div className="flex justify-end border-t border-premium-borda pt-4">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : 'Salvar perfil'}
        </button>
      </div>
    </form>
  )
}
