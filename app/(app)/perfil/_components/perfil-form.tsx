'use client'

import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { SeletorCor } from '@/components/ui/seletor-cor'
import { atualizarMeuPerfilAction } from '@/lib/actions/perfil'

export function PerfilForm({ nome, telefone, cor }: { nome: string; telefone: string; cor: string }) {
  const [estado, acao, pendente] = useActionState(atualizarMeuPerfilAction, undefined)

  return (
    <form action={acao} noValidate className="space-y-5">
      {estado?.ok && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          Perfil atualizado.
        </p>
      )}
      {estado?.erro && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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

      <div className="flex justify-end border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : 'Salvar perfil'}
        </button>
      </div>
    </form>
  )
}
