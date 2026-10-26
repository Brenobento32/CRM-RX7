'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'

import type { EstadoFormCliente } from '@/lib/actions/clientes'
import {
  ROTULO_TIPO_CLIENTE,
  TIPOS_CLIENTE,
  type CampoCliente,
} from '@/lib/validations/cliente'
import { botaoFantasmaClass, botaoPrimarioClass, caixaErroClass, inputClass, legendaClass, opcaoClass } from '@/components/ui/estilos'

type Valores = Partial<Record<CampoCliente, string>>

type EstadoComOk = EstadoFormCliente & { ok?: boolean }

export const inputClassCliente =
  inputClass

type PropsCampos = {
  valores: Valores
  erro: (campo: CampoCliente) => string | undefined
  /** Só preenchido para gerente: permite escolher a carteira do cliente. */
  responsaveis: { id: string; nome: string; role: string }[]
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

/**
 * Campos de cadastro do cliente, sem `<form>` nem botões — extraído de
 * `ClienteForm` pra ser reaproveitado pela ficha do card (que precisa de um
 * ÚNICO `<form>`/botão "Salvar alterações" cobrindo cliente + dados
 * comerciais juntos, não dois submits independentes). `ClienteForm` (abaixo)
 * é o `<form>` completo de sempre, usado por /clientes/novo e
 * /clientes/[id]/editar — nada muda pra essas duas telas.
 */
export function CamposCliente({
  valores,
  erro,
  responsaveis,
  mostrarObservacoes = true,
}: PropsCampos) {
  // O tipo muda quais campos aparecem, então é o único campo controlado.
  const [tipo, setTipo] = useState(valores.tipo_cliente || 'pessoa_fisica')
  const empresa = tipo === 'empresa'

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
        className={inputClassCliente}
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
    <>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-premium-texto">Tipo de cliente</legend>
        <div className="flex flex-wrap gap-2">
          {TIPOS_CLIENTE.map((opcao) => (
            <label
              key={opcao}
              className={opcaoClass}
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
          <h2 className={legendaClass}>Contato</h2>
          <p className="text-xs text-premium-mudo">
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
            className={inputClassCliente}
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
            className={inputClassCliente}
          >
            {!valores.owner_id && <option value="">Selecione o responsável…</option>}
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome} {r.role === 'gerente' ? '(administrador)' : ''}
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
    </>
  )
}

type Props = {
  action: (
    estado: EstadoFormCliente | undefined,
    formData: FormData,
  ) => Promise<EstadoComOk>
  valoresIniciais: Valores
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
  mostrarObservacoes?: boolean
}

/**
 * `<form>` completo (campos + botões) pra /clientes/novo e
 * /clientes/[id]/editar — único uso restante deste componente. A ficha do
 * card (Kanban) NÃO usa mais `ClienteForm`: ela precisa de um único
 * `<form>`/botão "Salvar alterações" cobrindo cliente + dados comerciais
 * juntos, então usa `CamposCliente` direto (ver `ModalFichaCliente`).
 */
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

  const erro = (campo: CampoCliente) => estado?.campos?.[campo]?.[0]

  return (
    <form action={formAction} className="space-y-8" noValidate>
      {estado?.erro && (
        <div
          role="alert"
          className={caixaErroClass}
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
            className={inputClassCliente}
          >
            {funis.length > 1 && <option value="">Selecione…</option>}
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          <p className="text-xs text-premium-mudo">
            A negociação inicial entra na primeira etapa aberta deste funil.
          </p>
        </div>
      )}

      <CamposCliente
        valores={valores}
        erro={erro}
        responsaveis={responsaveis}
        mostrarObservacoes={mostrarObservacoes}
      />

      <div className="flex items-center gap-3 border-t border-premium-borda pt-6">
        <button
          type="submit"
          disabled={pendente}
          className={botaoPrimarioClass}
        >
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        {onCancelar ? (
          <button
            type="button"
            onClick={onCancelar}
            className={botaoFantasmaClass}
          >
            Cancelar
          </button>
        ) : (
          <Link
            href={cancelarHref ?? '#'}
            className={botaoFantasmaClass}
          >
            Cancelar
          </Link>
        )}
      </div>
    </form>
  )
}
