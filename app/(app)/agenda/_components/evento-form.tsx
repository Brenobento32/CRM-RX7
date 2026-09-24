'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormEvento } from '@/lib/actions/eventos'
import type { OpcaoCliente, ResponsavelAgenda } from '@/lib/dal/eventos'
import { responsaveisElegiveis } from '@/lib/utils/agenda'
import { formatarData, formatarDiaExtenso } from '@/lib/utils/formatacao'
import {
  DURACOES,
  ESCOPOS,
  ROTULO_ESCOPO,
  ROTULO_STATUS_EVENTO,
  ROTULO_TIPO_EVENTO,
  STATUS_EM_ABERTO,
  TIPOS_FORMULARIO,
  type CampoEvento,
  type Duracao,
  type Escopo,
  type StatusEvento,
  type TipoEvento,
  type ValoresEvento,
} from '@/lib/validations/evento'

import { CampoDuracao } from './campo-duracao'
import { CampoRecorrencia } from './campo-recorrencia'
import { CampoResponsavel } from './campo-responsavel'

type Props = {
  modo: 'criar' | 'editar'
  action: (estado: EstadoFormEvento | undefined, formData: FormData) => Promise<EstadoFormEvento>
  valoresIniciais: ValoresEvento
  clientes: OpcaoCliente[]
  responsaveis: ResponsavelAgenda[]
  eu: ResponsavelAgenda & { gerente: boolean }
  /** Edição: status atual (muda pelos botões, não pelo formulário). */
  statusAtual?: StatusEvento
  /** Edição de evento de série: a regra, em texto, e quantas ocorrências tem. */
  serie?: { descricao: string; total: number } | null
  rotuloEnviar: string
  cancelarHref: string
}

const secaoClass = 'space-y-4 border-t border-zinc-200 pt-6 first:border-t-0 first:pt-0 dark:border-zinc-800'
const tituloSecaoClass = 'text-base font-semibold'

const opcaoClass =
  'flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-focus-visible:ring-2 has-focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:ring-zinc-100'

export function EventoForm({
  modo,
  action,
  valoresIniciais,
  clientes,
  responsaveis,
  eu,
  statusAtual,
  serie = null,
  rotuloEnviar,
  cancelarHref,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: CampoEvento) => estado?.campos?.[campo]?.[0]
  const invalido = (campo: CampoEvento) => (erro(campo) ? true : undefined)

  // Controlados: negociações e responsáveis dependem do cliente; duração e
  // repetição dependem da data e da hora.
  const [clienteId, setClienteId] = useState(valores.cliente_id ?? '')
  const [usuarioId, setUsuarioId] = useState(valores.usuario_id ?? '')
  const [data, setData] = useState(valores.data ?? '')
  const [horaInicio, setHoraInicio] = useState(valores.hora_inicio ?? '')
  const [escopo, setEscopo] = useState<Escopo>((valores.escopo as Escopo) || 'este')

  const cliente = clientes.find((c) => c.id === clienteId)
  const negociacoes = cliente?.negociacoes ?? []

  function trocarCliente(id: string) {
    setClienteId(id)
    if (!eu.gerente) return
    // Mantém a escolha se ainda for possível; senão, o dono do cliente.
    const novo = clientes.find((c) => c.id === id)
    const elegiveis = responsaveisElegiveis(responsaveis, novo?.ownerId)
    if (!elegiveis.some((r) => r.id === usuarioId)) {
      setUsuarioId(elegiveis.find((r) => r.id === novo?.ownerId)?.id ?? eu.id)
    }
  }

  const tipoOriginal = valores.tipo_original ?? ''
  const tipos: TipoEvento[] = tipoOriginal === 'apresentacao' ? [...TIPOS_FORMULARIO, 'apresentacao'] : [...TIPOS_FORMULARIO]
  const duracaoInicial = (DURACOES as readonly string[]).includes(valores.duracao ?? '') ? (valores.duracao as Duracao) : '60'
  // Em série, "seguintes"/"todos" mantêm a data de cada ocorrência.
  const dataTravada = modo === 'editar' && serie !== null && escopo !== 'este'

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

      <input type="hidden" name="tipo_original" value={tipoOriginal} />

      {/* Cliente e negociação */}
      <section className={secaoClass}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="cliente_id" className="mb-1.5 block text-sm font-medium">
              Cliente
            </label>
            <select
              id="cliente_id"
              name="cliente_id"
              value={clienteId}
              onChange={(e) => trocarCliente(e.target.value)}
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
      </section>

      {/* Compromisso */}
      <section className={secaoClass}>
        <h2 className={tituloSecaoClass}>Compromisso</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="titulo" className="mb-1.5 block text-sm font-medium">
              Título
            </label>
            <input
              id="titulo"
              name="titulo"
              defaultValue={valores.titulo}
              placeholder="Ex.: reunião de apresentação da proposta"
              maxLength={200}
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
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_EVENTO[t]}
                  {t === 'apresentacao' ? ' (antigo)' : ''}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={erro('tipo')} />
          </div>
        </div>

        {modo === 'criar' ? (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Status</legend>
            <div className="flex flex-wrap gap-2">
              {STATUS_EM_ABERTO.map((s) => (
                <label key={s} className={opcaoClass}>
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    defaultChecked={(valores.status || 'agendado') === s}
                    className="sr-only"
                  />
                  {ROTULO_STATUS_EVENTO[s]}
                </label>
              ))}
            </div>
            <ErroCampo mensagem={erro('status')} />
          </fieldset>
        ) : (
          statusAtual && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Status: <span className="font-medium text-zinc-900 dark:text-zinc-100">{ROTULO_STATUS_EVENTO[statusAtual]}</span>
              . O status muda pelos botões da agenda, que registram realizado e não compareceu na timeline do cliente.
            </p>
          )
        )}
      </section>

      {/* Quando */}
      <section className={secaoClass}>
        <h2 className={tituloSecaoClass}>Quando</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor="data" className="mb-1.5 block text-sm font-medium">
              Data
            </label>
            <input
              id="data"
              // Desabilitado não é enviado: o valor vai no campo oculto.
              name={dataTravada ? undefined : 'data'}
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={dataTravada}
              aria-invalid={invalido('data')}
              aria-describedby={dataTravada ? 'data-travada' : undefined}
              className={`${inputClass} disabled:bg-zinc-50 disabled:text-zinc-500 dark:disabled:bg-zinc-900`}
            />
            {dataTravada && <input type="hidden" name="data" value={data} />}
            {dataTravada ? (
              <p id="data-travada" className="mt-1 text-xs text-zinc-500">
                Cada ocorrência mantém a própria data.
              </p>
            ) : (
              /^\d{4}-\d{2}-\d{2}$/.test(data) && <p className="mt-1 text-xs text-zinc-500">{formatarDiaExtenso(data)}</p>
            )}
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
              value={horaInicio}
              onChange={(e) => setHoraInicio(e.target.value)}
              aria-invalid={invalido('hora_inicio')}
              className={inputClass}
            />
            <ErroCampo mensagem={erro('hora_inicio')} />
          </div>
        </div>

        <CampoDuracao
          horaInicio={horaInicio}
          duracaoInicial={duracaoInicial}
          horaFimInicial={valores.hora_fim ?? ''}
          erroDuracao={erro('duracao')}
          erroHoraFim={erro('hora_fim')}
        />
      </section>

      {/* Responsável */}
      <section className={secaoClass}>
        <CampoResponsavel
          souGerente={eu.gerente}
          eu={eu}
          responsaveis={responsaveis}
          ownerId={cliente?.ownerId}
          valor={usuarioId}
          onChange={setUsuarioId}
          erro={erro('usuario_id')}
        />
      </section>

      {/* Repetição (criação) ou escopo da edição (série) */}
      {modo === 'criar' ? (
        <section className={secaoClass}>
          <CampoRecorrencia data={data} valores={valores} erro={erro} />
        </section>
      ) : (
        serie && (
          <section className={secaoClass}>
            <h2 className={tituloSecaoClass}>Série</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <span aria-hidden>↻ </span>
              {serie.descricao} · {serie.total} {serie.total === 1 ? 'compromisso' : 'compromissos'}. Para mudar a
              repetição, cancele os seguintes e crie uma nova série.
            </p>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Aplicar a</legend>
              <div className="flex flex-wrap gap-2">
                {ESCOPOS.map((e) => (
                  <label key={e} className={opcaoClass}>
                    <input
                      type="radio"
                      name="escopo"
                      value={e}
                      checked={escopo === e}
                      onChange={() => setEscopo(e)}
                      className="sr-only"
                    />
                    {ROTULO_ESCOPO[e]}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">
                Compromissos já realizados, não comparecidos ou cancelados nunca são alterados em lote.
              </p>
              <ErroCampo mensagem={erro('escopo')} />
            </fieldset>
          </section>
        )
      )}

      {/* Descrição */}
      <section className={secaoClass}>
        <div>
          <label htmlFor="descricao" className="mb-1.5 block text-sm font-medium">
            Descrição <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <textarea
            id="descricao"
            name="descricao"
            rows={3}
            maxLength={5000}
            defaultValue={valores.descricao}
            aria-invalid={invalido('descricao')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('descricao')} />
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        <Link
          href={cancelarHref}
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Voltar
        </Link>
      </div>
    </form>
  )
}
