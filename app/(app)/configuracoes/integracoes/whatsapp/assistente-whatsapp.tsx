'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'

import { Aviso } from '@/components/ui/aviso'
import { botaoPrimarioClass, inputClass, labelClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import { concluirWhatsappAction, configWhatsappAction } from '@/lib/actions/integracoes-oficiais'
import { cadastrarWhatsappNaMeta } from '@/lib/integracoes/janelas-provedores'

import { SeletorDestino, type Destino, type OpcoesDestino } from '../_components/seletor-destino'

/**
 * Destino primeiro (funil, etapa, responsável), depois o cadastro oficial da
 * Meta (Embedded Signup). O navegador só recebe um código de uso único e os
 * IDs públicos; a troca pelo token e a gravação no cofre são no servidor.
 */
export function AssistenteWhatsapp({ opcoes, responsaveis }: { opcoes: OpcoesDestino; responsaveis: { id: string; nome: string }[] }) {
  const [destino, setDestino] = useState<Destino>({
    funilId: opcoes.funis[0]?.id ?? '',
    etapaId: opcoes.funis[0]?.etapas.find((e) => e.inicial)?.id ?? opcoes.funis[0]?.etapas[0]?.id ?? '',
    responsavelId: '',
  })
  const [nome, setNome] = useState('WhatsApp comercial')
  const [ciente, setCiente] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<{ numeroExibicao: string | null; nomeVerificado: string | null } | null>(null)
  const [pendente, iniciar] = useTransition()
  // Configuração pública do app da Meta carregada ANTES do clique: a janela da
  // Meta precisa abrir no próprio clique, senão o navegador a bloqueia como pop-up.
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof configWhatsappAction>> | null>(null)
  useEffect(() => {
    configWhatsappAction().then(setCfg, () => setCfg({ ok: false, codigo: 'indisponivel', mensagem: 'O serviço de integrações não respondeu.' }))
  }, [])

  const pronto = Boolean(destino.funilId && destino.etapaId && destino.responsavelId && ciente && cfg)

  const conectar = () =>
    iniciar(async () => {
      setErro(null)
      try {
        if (!cfg) return
        if (!cfg.ok) return setErro(cfg.mensagem)
        if (!cfg.disponivel) return setErro('O app oficial da Meta ainda não foi configurado na plataforma. Fale com o suporte da Rio X7.')
        const cadastro = await cadastrarWhatsappNaMeta(cfg)
        if (!cadastro) return setErro('Cadastro na Meta cancelado ou incompleto. Nada foi conectado.')
        const r = await concluirWhatsappAction({ ...cadastro, nome, funil: destino.funilId, etapa: destino.etapaId, responsavel: destino.responsavelId })
        if (!r.ok) return setErro(r.mensagem)
        setFeito({ numeroExibicao: r.numeroExibicao, nomeVerificado: r.nomeVerificado })
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível abrir o cadastro da Meta.')
      }
    })

  if (feito) {
    return (
      <Secao titulo="Número conectado">
        <div className="space-y-3 pb-5 text-sm">
          <Aviso tom="sucesso">
            {feito.numeroExibicao ?? 'Número'} {feito.nomeVerificado ? `(${feito.nomeVerificado})` : ''} conectado em &quot;Somente envios gratuitos&quot;.
          </Aviso>
          <p className="text-premium-secundario">Quem escrever para este número vira lead no destino escolhido. As conversas aparecem em Conversas, para quem atende o cliente.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/configuracoes/integracoes#whatsapp-oficial" className={botaoPrimarioClass}>
              Ver em Integrações
            </Link>
          </div>
        </div>
      </Secao>
    )
  }

  return (
    <div className="space-y-5">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <Secao titulo="1. Destino dos leads" descricao="Contato novo que escrever para o número entra aqui. Quem já é cliente desta empresa tem a conversa vinculada, sem criar nem mover negociação.">
        <div className="space-y-4 pb-5">
          <label className="block text-sm">
            <span className={labelClass}>Nome da conexão</span>
            <input className={inputClass} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
          </label>
          <SeletorDestino opcoes={opcoes} responsaveis={responsaveis} inicial={destino} onChange={setDestino} />
        </div>
      </Secao>

      <Secao titulo="2. Custos e política de envio">
        <div className="space-y-3 pb-5 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-premium-secundario">
            <li>O número começa em <strong>Somente envios gratuitos</strong>: a equipe só responde por texto dentro de 24 h da última mensagem do cliente.</li>
            <li>Mensagens fora da janela (que exigiriam modelo pago), modelos, marketing, automações e disparos em massa ficam bloqueados no servidor.</li>
            <li>Se a Meta indicar cobrança em alguma mensagem, o número é bloqueado automaticamente até o Administrador revisar.</li>
            <li>Há um limite diário de respostas por número. Liberar envios pagos depende das regras comerciais da Rio X7.</li>
            <li>Os preços e regras são da Meta e podem mudar: o AVANTE reduz o risco, mas não garante custo zero.</li>
          </ul>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
            <span>Entendi a política de envio e de custos.</span>
          </label>
        </div>
      </Secao>

      <Secao titulo="3. Cadastro na Meta" descricao="Abre a janela oficial da Meta: entre com a conta do Facebook da empresa, escolha (ou crie) a conta do WhatsApp Business e o número.">
        <div className="pb-5">
          <button type="button" className={botaoPrimarioClass} disabled={pendente || !pronto} onClick={conectar}>
            {pendente ? 'Aguardando a Meta…' : 'Conectar com a Meta'}
          </button>
        </div>
      </Secao>
    </div>
  )
}
