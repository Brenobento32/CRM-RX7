import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Aviso } from '@/components/ui/aviso'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { opcoesDeDestino } from '@/lib/dal/fontes-leads'
import { integracoesHabilitadas, podeAdministrarIntegracoes } from '@/lib/dal/integracoes-oficiais'

import { AssistenteWhatsapp } from './assistente-whatsapp'

export const metadata: Metadata = { title: 'Conectar WhatsApp Business' }

export default async function ConectarWhatsappPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()
  const [podeGerir, opcoes, responsaveis, habilitadas] = await Promise.all([
    podeAdministrarIntegracoes(),
    opcoesDeDestino(),
    listarResponsaveis(),
    integracoesHabilitadas(),
  ])

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Conectar WhatsApp Business"
        subtitulo="Número oficial da empresa pela plataforma da Meta (WhatsApp Cloud API). Cada empresa conecta o próprio número; nada é compartilhado com outras empresas."
        voltar={{ href: '/configuracoes/integracoes', rotulo: 'Integrações' }}
      />
      {!habilitadas.whatsappOficial ? (
        <Aviso tom="info" titulo="Em homologação">O WhatsApp oficial ainda não foi liberado na plataforma. Nenhuma conexão é aberta enquanto isso.</Aviso>
      ) : podeGerir ? (
        <AssistenteWhatsapp opcoes={opcoes} responsaveis={responsaveis.map((r) => ({ id: r.id, nome: r.nome }))} />
      ) : (
        <Aviso tom="info">Somente o Administrador da empresa conecta números de WhatsApp.</Aviso>
      )}
    </div>
  )
}
