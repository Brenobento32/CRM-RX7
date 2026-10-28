'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { Aviso } from '@/components/ui/aviso'
import { botaoPrimarioClass } from '@/components/ui/estilos'
import { concluirMetaAdsAction, configMetaAdsAction } from '@/lib/actions/integracoes-oficiais'
import { conectarMetaAds } from '@/lib/integracoes/janelas-provedores'

/** Botão "Conectar Meta Ads": janela oficial da Meta; o servidor troca o code pelo token e guarda no cofre. */
export function ConectarMetaAds({ rotulo = 'Conectar Meta Ads' }: { rotulo?: string }) {
  const router = useRouter()
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof configMetaAdsAction>> | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  // Configuração carregada antes do clique: a janela da Meta precisa abrir no próprio clique.
  useEffect(() => {
    configMetaAdsAction().then(setCfg, () => setCfg({ ok: false, codigo: 'indisponivel', mensagem: 'O serviço de integrações não respondeu.' }))
  }, [])

  const conectar = () =>
    iniciar(async () => {
      setErro(null)
      try {
        if (!cfg) return
        if (!cfg.ok) return setErro(cfg.mensagem)
        if (!cfg.disponivel) return setErro('O app oficial da Meta ainda não foi configurado na plataforma. Fale com o suporte da Rio X7.')
        const code = await conectarMetaAds(cfg)
        if (!code) return setErro('Autorização na Meta cancelada. Nada foi conectado.')
        const r = await concluirMetaAdsAction(code)
        if (!r.ok) return setErro(r.mensagem)
        router.refresh()
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível abrir a janela da Meta.')
      }
    })

  return (
    <div className="space-y-2">
      <button type="button" className={botaoPrimarioClass} disabled={pendente || !cfg} onClick={conectar}>
        {pendente ? 'Aguardando a Meta…' : rotulo}
      </button>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </div>
  )
}
