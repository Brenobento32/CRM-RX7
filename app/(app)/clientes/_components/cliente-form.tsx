'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'

import type { EstadoFormCliente } from '@/lib/actions/clientes'
import {
  ROTULO_TIPO_CLIENTE,
  TIPOS_CLIENTE,
  type CampoCliente,
} from '@/lib/validations/cliente'

type Valores = Partial<Record<CampoCliente, string>>

type EstadoComOk = EstadoFormCliente & { ok?: boolean }

type Props = {
  action: (
    estado: EstadoFormCliente | undefined,
    formData: FormData,
  ) => Promise<EstadoComOk>
  valoresIniciais: Valores
  /** Só preenchido para gerente: permite escolher a carteira do cliente. */
  responsaveis: { id: string; nome: string; role: string }[]
  /**
   * Só no cadastro (nunca na edição/ficha rápida, que não recriam
   * negociação): funis que o usuário pode escolher pra abrir a negociação
   * inicial — já filtrados por permissão (`listarFunis()`). Ausente/vazio
   * esconde o campo (edição não precisa dele).
   */
  funis?: { id: string; nome: string }[]
  rotuloEnviar: string
  /** Página de destino do "Cancelar" — ausente quando `onCancelar` é usado (ficha dentro de um `<dialog>`). */
  cancelarHref?: string
  /** "Cancelar" fecha o diálogo em vez de navegar — usado dentro do modal de ficha no Kanban. */
  onCancelar?: () => void
  /**
   * Chamado quando a action devolve `ok: true` sem redirecionar — só a
   * variante "rápida" (modal de ficha) faz isso; a página própria de
   * edição usa `redirect()` na action e nunca passa por aqui.
   */
  onSucesso?: () => void
  /**
   * `false` só na ficha do card do Kanban: a observação ali passa a ser
   * atividade/timeline (ver `FormObservacaoRapida`), e manter os dois
   * campos juntos duplicava o conceito. O valor existente continua indo
   * num campo oculto — nunca é apagado por um salvamento que não toca
   * nele, e a página de edição completa (`/clientes/[id]/editar`)
   * continua mostrando o campo normalmente.
   */
  mostrarObservacoes?: boolean
}

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

export function ClienteForm({
  action,
  valoresIniciais,
  responsaveis,
  funis,
  rotuloEnviar,
  cancelarHref,
  onCancelar,
  onSucesso,
  mostrarObservacoes = true,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais

  // Só a variante "rápida" (modal de ficha) devolve `ok: true` sem redirecionar.
  useEffect(() => {
    if (estado?.ok) onSucesso?.()
  }, [estado, onSucesso])

  // O tipo muda quais campos aparecem, então é o único campo controlado.
  const [tipo, setTipo] = useState(valores.tipo_cliente || 'pessoa_fisica')
  const empresa = tipo === 'empresa'

  const erro = (campo: CampoCliente) => estado?.campos?.[campo]?.[0]

  const campo = (
    nome: CampoCliente,
    rotulo: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="space-y-1.5">
      <label htmlFor={nome} className="block text-sm font-medium">
        {rotulo}
      </label>
      <input
        id={nome}
        name={nome}
        defaultValue={valores[nome]}
        aria-invalid={erro(nome) ? true : undefined}
        aria-describedby={erro(nome) ? `${nome}-erro` : undefined}
        className={inputClass}
        {...props}
      />
      {erro(nome) && (
        <p id={`${nome}-erro`} className="text-sm text-red-600 dark:text-red-400">
          {erro(nome)}
        </p>
      )}
    </div>
  )

  return (
    <form action={formAction} className="space-y-8" noValidate>
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

      {funis && funis.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="funil_id" className="block text-sm font-medium">
            Funil
          </label>
          <select
            id="funil_id"
            name="funil_id"
            defaultValue={funis.length === 1 ? funis[0].id : ''}
            required
            className={inputClass}
          >
            {funis.length > 1 && <option value="">Selecione…</option>}
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">
            A negociação inicial entra na primeira etapa aberta deste funil.
          </p>
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Tipo de cliente</legend>
        <div className="flex gap-2">
          {TIPOS_CLIENTE.map((opcao) => (
            <label
              key={opcao}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:bg-zinc-100 dark:has-checked:text-zinc-900"
            >
              <input
                type="radio"
                name="tipo_cliente"
                value={opcao}
                checked={tipo === opcao}
                onChange={() => setTipo(opcao)}
                className="sr-only"
              />
              {ROTULO_TIPO_CLIENTE[opcao]}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="grid gap-5 sm:grid-cols-2">
        {campo('nome', empresa ? 'Nome do contato *' : 'Nome *', {
          autoComplete: 'off',
        })}
        {campo('empresa', empresa ? 'Empresa *' : 'Empresa')}
        {empresa
          ? campo('cnpj', 'CNPJ', { inputMode: 'numeric', placeholder: '00.000.000/0000-00' })
          : campo('cpf', 'CPF', { inputMode: 'numeric', placeholder: '000.000.000-00' })}
        {empresa && campo('responsavel', 'Responsável')}
        {empresa && campo('cargo', 'Cargo')}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Contato</h2>
          <p className="text-xs text-zinc-500">
            Informe ao menos telefone, WhatsApp ou e-mail.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {campo('telefone', 'Telefone', { type: 'tel', placeholder: '(11) 3333-4444' })}
          {campo('whatsapp', 'WhatsApp', { type: 'tel', placeholder: '(11) 99999-8888' })}
          {campo('email', 'E-mail', { type: 'email' })}
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {campo('instagram', 'Instagram', { placeholder: '@usuario' })}
        </div>
      </section>

      {mostrarObservacoes ? (
        <div className="space-y-1.5">
          <label htmlFor="observacoes" className="block text-sm font-medium">
            Observações
          </label>
          <textarea
            id="observacoes"
            name="observacoes"
            rows={4}
            defaultValue={valores.observacoes}
            aria-invalid={erro('observacoes') ? true : undefined}
            className={inputClass}
          />
          {erro('observacoes') && (
            <p className="text-sm text-red-600 dark:text-red-400">{erro('observacoes')}</p>
          )}
        </div>
      ) : (
        <input type="hidden" name="observacoes" value={valores.observacoes ?? ''} />
      )}

      {responsaveis.length > 0 ? (
        <div className="max-w-sm space-y-1.5">
          <label htmlFor="owner_id" className="block text-sm font-medium">
            Carteira de
          </label>
          <select
            id="owner_id"
            name="owner_id"
            defaultValue={valores.owner_id}
            className={inputClass}
          >
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome} {r.role === 'gerente' ? '(gerente)' : ''}
              </option>
            ))}
          </select>
          {erro('owner_id') && (
            <p className="text-sm text-red-600 dark:text-red-400">{erro('owner_id')}</p>
          )}
        </div>
      ) : (
        <input type="hidden" name="owner_id" value="" />
      )}

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button
          type="submit"
          disabled={pendente}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        {onCancelar ? (
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
        ) : (
          <Link
            href={cancelarHref ?? '#'}
            className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancelar
          </Link>
        )}
      </div>
    </form>
  )
}
