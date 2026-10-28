'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { acessoSeletorAction } from '@/lib/actions/integracoes-oficiais'
import { escolherPlanilhaNoGoogle } from '@/lib/integracoes/janelas-provedores'

/**
 * Libera de novo o arquivo no seletor oficial do Google (drive.file) para uma
 * planilha já conectada — por exemplo, depois de reconectar a conta.
 */
export function AutorizarArquivo({ contaId, planilhaId, onAutorizado }: { contaId: string; planilhaId: string; onAutorizado?: () => void }) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pendente}
        className={botaoSecundarioClass}
        onClick={() =>
          iniciar(async () => {
            setErro(null)
            const acesso = await acessoSeletorAction(contaId)
            if (!acesso.ok) return setErro(acesso.mensagem)
            try {
              const escolhida = await escolherPlanilhaNoGoogle(acesso, planilhaId)
              if (escolhida && escolhida !== planilhaId) setErro('Foi escolhida outra planilha. Escolha a mesma planilha desta conexão.')
              else if (escolhida) {
                onAutorizado?.()
                router.refresh()
              }
            } catch (e) {
              setErro(e instanceof Error ? e.message : 'Não foi possível abrir o seletor do Google.')
            }
          })
        }
      >
        {pendente ? 'Abrindo o Google…' : 'Autorizar arquivo no Google'}
      </button>
      {erro && (
        <span role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {erro}
        </span>
      )}
    </span>
  )
}
