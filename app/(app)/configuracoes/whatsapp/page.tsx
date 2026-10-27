import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { caixaSucessoClass, caixaAlertaClass } from '@/components/ui/estilos'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarFunis } from '@/lib/dal/funis'
import { obterConfiguracaoWhatsapp } from '@/lib/dal/whatsapp'

import { WhatsappForm } from './_components/whatsapp-form'

export const metadata: Metadata = {
  title: 'WhatsApp',
}

const ROTULO_STATUS: Record<string, string> = {
  conectado: 'Conectado',
  conectando: 'Conectando…',
  desconectado: 'Desconectado',
}

export default async function WhatsappPage({ searchParams }: { searchParams: Promise<{ salvo?: string }> }) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const params = await searchParams
  const salvo = params.salvo === '1'

  const [configuracao, funis] = await Promise.all([obterConfiguracaoWhatsapp(), listarFunis()])
  const responsaveis = await listarResponsaveis(configuracao?.responsavelPadraoId)
  const funisHabilitados = funis.filter((f) => f.whatsappHabilitado && f.ativo)

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="WhatsApp"
        subtitulo="Funil e responsável padrão usados quando a criação automática de lead a partir do WhatsApp existir. Nenhuma automação está ativa ainda — esta tela só guarda a configuração."
        voltar={{ href: '/configuracoes', rotulo: 'Configurações' }}
      />

      {salvo && (
        <div role="status" className={caixaSucessoClass}>
          Configuração salva.
        </div>
      )}

      {configuracao ? (
        <p className="text-sm text-premium-secundario">
          Status da conexão: <span className="font-medium">{ROTULO_STATUS[configuracao.status]}</span>
          {configuracao.numero ? ` — número ${configuracao.numero}` : ''}
        </p>
      ) : (
        <div role="alert" className={caixaAlertaClass}>
          A conexão WhatsApp ainda não foi iniciada — rode o whatsapp-service pelo menos uma vez antes de configurar.
        </div>
      )}

      {funisHabilitados.length === 0 ? (
        <div role="alert" className={caixaAlertaClass}>
          Nenhum funil tem a conversa WhatsApp habilitada ainda. Habilite em{' '}
          <Link href="/configuracoes/funis" className="underline">
            Configurações → Funis
          </Link>{' '}
          antes de escolher aqui.
        </div>
      ) : (
        <WhatsappForm
          desabilitado={!configuracao}
          funis={funisHabilitados}
          responsaveis={responsaveis}
          valoresIniciais={{
            funilId: configuracao?.funilId ?? '',
            responsavelPadraoId: configuracao?.responsavelPadraoId ?? '',
          }}
        />
      )}
    </div>
  )
}
