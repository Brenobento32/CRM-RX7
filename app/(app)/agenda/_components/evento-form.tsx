'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormEvento } from '@/lib/actions/eventos'
import type { OpcaoCliente } from '@/lib/dal/eventos'
import { formatarData } from '@/lib/utils/formatacao'
import {
  ROTULO_TIPO_EVENTO,
  TIPOS_EVENTO,
  type CampoEvento,
} from '@/lib/validations/evento'

type Props = {
  action: (
    estado: EstadoFormEvento | undefined,
    formData: FormData,
  ) => Promise<EstadoFormEvento>
  valoresIniciais: Partial<Record<CampoEvento, string>>
  clientes: OpcaoCliente[]
  /** Só preenchido para gerente: permite agendar para outra pessoa. */
  responsaveis: { id: string; nome: string }[]
  rotuloEnviar: string
  cancelarHref: string
}

export function EventoForm({
  action,
  valoresIniciais,
  clientes,
  responsaveis,
  rotuloEnviar,
  cancelarHref,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais

  // Controlado porque a lista de negociações depende do cliente escolhido.
  const [clienteId, setClienteId] = useState(valores.cliente_id ?? '')
  const negociacoes = clientes.find((c) => c.id === clienteId)?.negociacoes ?? []

  const erro = (campo: CampoEvento) => estado?.campos?.[campo]?.[0]
  const invalido = (campo: CampoEvento) => (erro(campo) ? true : undefined)

  return (
    <form action={formAction} noValidate className="space-y-6">
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="cliente_id" className="mb-1.5 block text-sm font-medium">
            Cliente
          </label>
          <select
            id="cliente_id"
            name="cliente_id"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            aria-invalid={invalido('cliente_id')}
            className={inputClass}
          >
            <option value="">Selecione…</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.empresa ? ` · ${c.empresa}` : ''}
              </option>
            ))}
          </select>
          <ErroCampo mensagem={erro('cliente_id')} />
        </div>

        <div>
          <label htmlFor="negociacao_id" className="mb-1.5 block text-sm font-medium">
            Negociação <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <select
            // Remonta ao trocar de cliente, para não sobrar uma negociação do anterior.
            key={clienteId}
            id="negociacao_id"
            name="negociacao_id"
            defaultValue={clienteId === valores.cliente_id ? valores.negociacao_id : ''}
            disabled={negociacoes.length === 0}
            aria-invalid={invalido('negociacao_id')}
            className={inputClass}
          >
            <option value="">Nenhuma</option>
            {negociacoes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.etapa.nome} · aberta em {formatarData(n.created_at)}
              </option>
            ))}
          </select>
          <ErroCampo mensagem={erro('negociacao_id')} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="titulo" className="mb-1.5 block text-sm font-medium">
            Título
          </label>
          <input
            id="titulo"
            name="titulo"
            defaultValue={valores.titulo}
            placeholder="Ex.: apresentação da proposta"
            aria-invalid={invalido('titulo')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('titulo')} />
        </div>

        <div>
          <label htmlFor="tipo" className="mb-1.5 block text-sm font-medium">
            Tipo
          </label>
          <select
            id="tipo"
            name="tipo"
            defaultValue={valores.tipo || 'reuniao'}
            aria-invalid={invalido('tipo')}
            className={inputClass}
          >
            {TIPOS_EVENTO.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_EVENTO[t]}
              </option>
            ))}
          </select>
          <ErroCampo mensagem={erro('tipo')} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor="data" className="mb-1.5 block text-sm font-medium">
            Data
          </label>
          <input
            id="data"
            name="data"
            type="date"
            defaultValue={valores.data}
            aria-invalid={invalido('data')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('data')} />
        </div>
        <div>
          <label htmlFor="hora_inicio" className="mb-1.5 block text-sm font-medium">
            Início
          </label>
          <input
            id="hora_inicio"
            name="hora_inicio"
            type="time"
            defaultValue={valores.hora_inicio}
            aria-invalid={invalido('hora_inicio')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('hora_inicio')} />
        </div>
        <div>
          <label htmlFor="hora_fim" className="mb-1.5 block text-sm font-medium">
            Término
          </label>
          <input
            id="hora_fim"
            name="hora_fim"
            type="time"
            defaultValue={valores.hora_fim}
            aria-invalid={invalido('hora_fim')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('hora_fim')} />
        </div>
      </div>

      <div>
        <label htmlFor="descricao" className="mb-1.5 block text-sm font-medium">
          Descrição <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <textarea
          id="descricao"
          name="descricao"
          rows={3}
          defaultValue={valores.descricao}
          aria-invalid={invalido('descricao')}
          className={inputClass}
        />
        <ErroCampo mensagem={erro('descricao')} />
      </div>

      {responsaveis.length > 0 ? (
        <div className="max-w-sm">
          <label htmlFor="usuario_id" className="mb-1.5 block text-sm font-medium">
            Responsável
          </label>
          <select
            id="usuario_id"
            name="usuario_id"
            defaultValue={valores.usuario_id}
            className={inputClass}
          >
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
          <ErroCampo mensagem={erro('usuario_id')} />
        </div>
      ) : (
        <input type="hidden" name="usuario_id" value="" />
      )}

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        <Link
          href={cancelarHref}
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
