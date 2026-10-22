import type { Database } from '@/lib/types/database'

/**
 * Catálogo das fontes de leads mostrado na tela de integrações.
 *
 * `situacao` diz o que o CÓDIGO já faz — nunca que a conexão com o provedor
 * foi testada: Meta e WhatsApp só recebem depois da validação real com o
 * token da empresa (`validada_em`).
 */

export type TipoFonte = Database['public']['Enums']['fonte_lead_tipo']
export type StatusFonte = Database['public']['Enums']['fonte_lead_status']

export type ItemCatalogo = {
  tipo: TipoFonte | 'manual'
  nome: string
  descricao: string
  situacao: 'nativo' | 'pronto' | 'requer_configuracao'
  rotuloSituacao: string
  usaToken: boolean
  exigeValidacao: boolean
}

export const CATALOGO: ItemCatalogo[] = [
  {
    tipo: 'formulario_rx7',
    nome: 'Formulário RX7',
    descricao: 'Página pública de captação hospedada pelo próprio CRM. Basta divulgar o link.',
    situacao: 'pronto',
    rotuloSituacao: 'Disponível',
    usaToken: false,
    exigeValidacao: false,
  },
  {
    tipo: 'webhook',
    nome: 'Webhook (API)',
    descricao: 'Qualquer sistema da empresa envia o lead por POST com o token da fonte no header.',
    situacao: 'pronto',
    rotuloSituacao: 'Disponível',
    usaToken: true,
    exigeValidacao: false,
  },
  {
    tipo: 'google_sheets',
    nome: 'Google Sheets',
    descricao: 'Um Apps Script na planilha da empresa envia cada nova linha para o CRM.',
    situacao: 'pronto',
    rotuloSituacao: 'Disponível (requer o Apps Script na planilha)',
    usaToken: true,
    exigeValidacao: false,
  },
  {
    tipo: 'respondi',
    nome: 'Respondi da empresa',
    descricao: 'Webhook do Respondi da própria empresa (não o da Scorpion). Ainda não testado com o Respondi real.',
    situacao: 'pronto',
    rotuloSituacao: 'Disponível — confirmar no primeiro envio',
    usaToken: true,
    exigeValidacao: false,
  },
  {
    tipo: 'meta_lead_ads',
    nome: 'Meta Lead Ads',
    descricao: 'Formulários nativos de anúncios do Facebook/Instagram da página da empresa.',
    situacao: 'requer_configuracao',
    rotuloSituacao: 'Requer app da Meta, token da página e validação',
    usaToken: false,
    exigeValidacao: true,
  },
  {
    tipo: 'whatsapp_cloud',
    nome: 'WhatsApp oficial (Cloud API)',
    descricao: 'Quem escreve para o número oficial da empresa vira lead.',
    situacao: 'requer_configuracao',
    rotuloSituacao: 'Requer app da Meta, número oficial, token e validação',
    usaToken: false,
    exigeValidacao: true,
  },
  {
    tipo: 'manual',
    nome: 'Cadastro manual',
    descricao: 'Clientes e negociações criados pela equipe na tela de Clientes.',
    situacao: 'nativo',
    rotuloSituacao: 'Nativo',
    usaToken: false,
    exigeValidacao: false,
  },
]

export const TIPOS_FONTE: TipoFonte[] = ['formulario_rx7', 'webhook', 'google_sheets', 'respondi', 'meta_lead_ads', 'whatsapp_cloud']

export function itemDoTipo(tipo: TipoFonte): ItemCatalogo {
  return CATALOGO.find((i) => i.tipo === tipo)!
}

/** Situação visível de uma fonte cadastrada (nunca "funcionando" sem prova). */
export function situacaoDaFonte(f: {
  tipo: TipoFonte
  status: StatusFonte
  validadaEm: string | null
  ultimoLeadEm: string | null
}): { rotulo: string; tom: 'ok' | 'espera' | 'parado' } {
  if (f.status === 'revogada') return { rotulo: 'Revogada', tom: 'parado' }
  if (f.status === 'pausada') return { rotulo: 'Pausada', tom: 'parado' }
  if (itemDoTipo(f.tipo).exigeValidacao && !f.validadaEm) return { rotulo: 'Aguardando validação com o provedor', tom: 'espera' }
  if (!f.ultimoLeadEm) return { rotulo: 'Ativa — aguardando o primeiro lead', tom: 'espera' }
  return { rotulo: 'Recebendo leads', tom: 'ok' }
}
