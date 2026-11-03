'use client'

import { useState, useTransition } from 'react'

import { Aviso } from '@/components/ui/aviso'
import { ajudaClass, botaoPrimarioClass, inputClass, labelClass } from '@/components/ui/estilos'
import { enviarHomologacaoCapiAction, type ResultadoHomologacaoCapi } from '@/lib/actions/integracoes-oficiais'
import type { HomologacaoCapi } from '@/lib/dal/meta-conversoes'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'

const CONFIRMACAO = 'ENVIAR 1 EVENTO'

/**
 * Homologação de UM evento da CAPI, só para o Super Admin (aparece só quando o
 * servidor liga a homologação desta empresa). Não ativa o envio geral; o código
 * de teste não é guardado em lugar nenhum e some da tela depois do envio.
 */
export function HomologacaoCapiCartao({ situacao }: { situacao: HomologacaoCapi }) {
  const [codigo, setCodigo] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoHomologacaoCapi | null>(null)
  const [pendente, iniciar] = useTransition()

  const enviar = () =>
    iniciar(async () => {
      setErro(null)
      const r = await enviarHomologacaoCapiAction({ negociacao: situacao.negociacao ?? '', codigoTeste: codigo, confirmacao })
      setCodigo('')
      setConfirmacao('')
      if (!r.ok) return setErro(r.mensagem)
      setResultado(r)
    })

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-premium-mudo">Evento</dt>
          <dd className="font-medium">{situacao.evento ?? '—'} (sem valor, sem e-mail e telefone)</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Dataset</dt>
          <dd className="font-medium tabular-nums">{situacao.dataset ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Formulário da Meta</dt>
          <dd className="font-medium tabular-nums">{situacao.formulario ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Negociação</dt>
          <dd className="font-medium break-all">{situacao.negociacao ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">ID do lead da Meta</dt>
          <dd className="font-medium tabular-nums">{situacao.leadFinal ? `…${situacao.leadFinal}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">Horário do evento (entrada do lead)</dt>
          <dd className="font-medium">{situacao.eventTime ? formatarDataHoraCompleta(new Date(situacao.eventTime * 1000).toISOString()) : '—'}</dd>
        </div>
        <div>
          <dt className="text-premium-mudo">event_id de homologação</dt>
          <dd className="font-medium break-all">{situacao.eventId ?? '—'}</dd>
        </div>
      </dl>

      {situacao.jaFeita ? (
        <Aviso tom="info">Esta negociação já teve o evento de homologação. Não há reenvio.</Aviso>
      ) : !situacao.pronto ? (
        <Aviso tom="alerta">{situacao.motivo ?? 'A homologação não está pronta.'}</Aviso>
      ) : resultado ? null : (
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Código de teste do Gerenciador de Eventos</span>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={40} autoComplete="off" className={inputClass} />
            <span className={`block ${ajudaClass}`}>Dataset › Eventos de teste. Não é guardado.</span>
          </label>
          <label className="block">
            <span className={labelClass}>Para confirmar, digite {CONFIRMACAO}</span>
            <input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} maxLength={20} autoComplete="off" className={inputClass} />
          </label>
          <button type="button" className={botaoPrimarioClass} disabled={pendente || !codigo.trim() || confirmacao !== CONFIRMACAO} onClick={enviar}>
            {pendente ? 'Enviando…' : 'Enviar 1 evento de homologação'}
          </button>
        </div>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {resultado && (
        <Aviso tom={resultado.aceito ? 'sucesso' : 'erro'} titulo={resultado.aceito ? 'Aceito pela Meta' : 'Recusado pela Meta'}>
          <ul className="list-disc pl-5">
            <li>
              {resultado.evento} · event_id {resultado.eventId} · dataset {resultado.dataset}
            </li>
            {resultado.fbtrace && <li>fbtrace_id: {resultado.fbtrace}</li>}
            {resultado.erro && <li>{resultado.erro}</li>}
            <li>Confira em Gerenciador de Eventos › dataset › Eventos de teste. Não há reenvio desta negociação.</li>
          </ul>
        </Aviso>
      )}
    </div>
  )
}
