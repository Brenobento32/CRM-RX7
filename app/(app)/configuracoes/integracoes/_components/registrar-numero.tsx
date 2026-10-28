'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Aviso } from '@/components/ui/aviso'
import { botaoPrimarioClass, inputClass, labelClass } from '@/components/ui/estilos'
import { registrarWhatsappAction } from '@/lib/actions/integracoes-oficiais'

/**
 * Campo do PIN de 6 números exigido pela Meta para registrar o número na
 * Cloud API. O PIN vai direto para o servidor, que só o repassa à Meta: não é
 * gravado, não aparece em log e o campo é limpo depois de cada tentativa.
 */
export function CampoPin({ valor, onChange, id = 'pin-whatsapp' }: { valor: string; onChange: (v: string) => void; id?: string }) {
  return (
    <label className="block text-sm" htmlFor={id}>
      <span className={labelClass}>PIN de 6 números</span>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="\d{6}"
        maxLength={6}
        className={`${inputClass} max-w-40 tracking-widest`}
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </label>
  )
}

export function OrientacaoPin() {
  return (
    <ul className="list-disc space-y-1 pl-5 text-xs text-premium-secundario">
      <li>Número novo: crie um PIN de 6 números. Ele vira a verificação em duas etapas do número na Meta e será pedido se o número for registrado de novo.</li>
      <li>Se o número já tem verificação em duas etapas, use o PIN atual dele.</li>
      <li>
        <strong>Guarde o PIN com segurança</strong>, num gerenciador de senhas ou cofre da empresa, acessível só a quem administra o número. Não envie por WhatsApp, e-mail ou
        planilha.
      </li>
      <li>O AVANTE não guarda nem mostra o PIN: ele é usado só neste registro.</li>
      <li>A Meta aceita até 10 pedidos de registro por número em 72 horas (inclusive os que falham). Para evitar o bloqueio, o AVANTE para em 8; confira o PIN antes de tentar.</li>
    </ul>
  )
}

/** Painel de Integrações: nova tentativa de registro de um número que ficou pendente. */
export function RegistrarNumero({ numeroId, aoConectar }: { numeroId: string; aoConectar?: () => void }) {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState<{ tom: 'erro' | 'sucesso'; texto: string } | null>(null)
  const [pendente, iniciar] = useTransition()

  const enviar = () =>
    iniciar(async () => {
      setMsg(null)
      const r = await registrarWhatsappAction(numeroId, pin)
      setPin('')
      if (!r.ok) return setMsg({ tom: 'erro', texto: r.mensagem })
      if (r.situacao === 'conectado') {
        setMsg({ tom: 'sucesso', texto: 'Número registrado na Meta e conectado.' })
        if (aoConectar) aoConectar()
        else router.refresh()
      } else {
        setMsg({ tom: 'erro', texto: r.pendencia ?? 'O registro ainda não foi confirmado pela Meta.' })
      }
    })

  return (
    <div className="w-full space-y-2 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
      <p className="text-sm font-medium text-premium-texto">Falta registrar o número na Meta</p>
      <p className="text-xs text-premium-secundario">Até o registro ser confirmado, o número não recebe leads nem envia mensagens.</p>
      <OrientacaoPin />
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      <div className="flex flex-wrap items-end gap-2">
        <CampoPin valor={pin} onChange={setPin} id={`pin-${numeroId}`} />
        <button type="button" className={botaoPrimarioClass} disabled={pendente || pin.length !== 6} onClick={enviar}>
          {pendente ? 'Registrando…' : 'Registrar número'}
        </button>
      </div>
    </div>
  )
}
