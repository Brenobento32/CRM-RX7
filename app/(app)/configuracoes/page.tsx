import type { Metadata } from 'next'
import Link from 'next/link'

import {
  IconeAssinatura,
  IconeClientes,
  IconeEmpresa,
  IconeEtapas,
  IconeIntegracoes,
  IconeLeads,
  IconeNichos,
  IconeServicos,
} from '@/components/layout/icones'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { getUsuarioAtual } from '@/lib/dal/auth'

export const metadata: Metadata = {
  title: 'Configurações',
}

type Icone = (p: { className?: string }) => React.ReactNode
type Item = { href: string; titulo: string; descricao: string; Icone: Icone }
type Grupo = { titulo: string; descricao: string; itens: Item[] }

const GRUPOS_GERENTE: Grupo[] = [
  {
    titulo: 'Empresa',
    descricao: 'Identidade, equipe e plano',
    itens: [
      { href: '/configuracoes/empresa', titulo: 'Dados da empresa', descricao: 'Logotipo, telefone, e-mail e responsável.', Icone: IconeEmpresa },
      { href: '/configuracoes/usuarios', titulo: 'Usuários', descricao: 'Equipe por cargo: Gerente, Vendedor, Atendente, SDR e Closer.', Icone: IconeClientes },
      { href: '/configuracoes/assinatura', titulo: 'Minha assinatura', descricao: 'Plano, situação, limites e consumo.', Icone: IconeAssinatura },
    ],
  },
  {
    titulo: 'CRM',
    descricao: 'Como o funil funciona na sua empresa',
    itens: [
      { href: '/configuracoes/funis', titulo: 'Funis e etapas', descricao: 'Etapas, cores, ordem e liberação para Atendentes.', Icone: IconeEtapas },
      { href: '/configuracoes/nichos', titulo: 'Nichos', descricao: 'Segmentos dos leads; decidem a borda do card.', Icone: IconeNichos },
      { href: '/configuracoes/servicos', titulo: 'Serviços', descricao: 'Catálogo de serviços das negociações.', Icone: IconeServicos },
    ],
  },
  {
    titulo: 'Integrações',
    descricao: 'Entrada automática de leads',
    itens: [
      { href: '/configuracoes/integracoes', titulo: 'Integrações e fontes', descricao: 'Credenciais do webhook de leads desta empresa.', Icone: IconeIntegracoes },
      { href: '/configuracoes/whatsapp', titulo: 'WhatsApp', descricao: 'Funil e responsável padrão da conexão.', Icone: IconeLeads },
    ],
  },
]

const GRUPOS_EQUIPE: Grupo[] = [
  {
    titulo: 'CRM',
    descricao: 'Consulta',
    itens: [
      { href: '/configuracoes/nichos', titulo: 'Nichos', descricao: 'Nichos disponíveis para os leads.', Icone: IconeNichos },
      { href: '/configuracoes/servicos', titulo: 'Serviços', descricao: 'Catálogo de serviços disponíveis.', Icone: IconeServicos },
    ],
  },
]

export default async function ConfiguracoesPage() {
  const usuario = await getUsuarioAtual()
  const gerente = usuario.role === 'gerente'
  const grupos = gerente ? GRUPOS_GERENTE : GRUPOS_EQUIPE

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeaderPremium
        titulo="Configurações"
        subtitulo={gerente ? 'Tudo o que define como a sua empresa usa o AVANTE.' : 'Itens de consulta. Para mudar seus dados de acesso, fale com o gerente.'}
      />

      {grupos.map((g) => (
        <section key={g.titulo} aria-labelledby={`grupo-${g.titulo}`} className="space-y-3">
          <div>
            <h2 id={`grupo-${g.titulo}`} className="text-[15px] font-semibold tracking-tight text-premium-texto">
              {g.titulo}
            </h2>
            <p className="text-xs text-premium-mudo">{g.descricao}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.itens.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group flex h-full items-start gap-3 rounded-xl border border-premium-borda bg-premium-card p-4 shadow-premium transition hover:border-premium-acento/50 hover:shadow-premium-alta"
                >
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-premium-acento-suave text-premium-acento">
                    <item.Icone className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-medium text-premium-texto">
                      {item.titulo}
                      <span aria-hidden className="text-premium-mudo transition group-hover:translate-x-0.5 group-hover:text-premium-acento">
                        →
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-premium-secundario">{item.descricao}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
