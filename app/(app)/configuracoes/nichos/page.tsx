import type { Metadata } from 'next'

import { EstadoVazio } from '@/components/ui/estado-vazio'
import { cartaoClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarNichosAtivos, listarNichosComUso } from '@/lib/dal/nichos'
import { PALETA_ETAPAS } from '@/lib/utils/etapas'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

import { ListaNichosGerente } from './_components/lista-nichos-gerente'

export const metadata: Metadata = {
  title: 'Nichos',
}

/** Gerente: CRUD completo. Closer: só os ativos, leitura. */
export default async function NichosPage() {
  const eu = await getUsuarioAtual()
  const gerente = eu.role === 'gerente'

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Nichos"
        subtitulo={
          <>
            {gerente
              ? 'Segmento de mercado do lead — a cor decide a borda do card no Kanban. Nicho já usado nunca é excluído: desative-o.'
              : 'Nichos disponíveis para os leads.'}
          </>
        }
        voltar={{ href: '/configuracoes', rotulo: 'Configurações' }}
      />

      {gerente ? <ListaNichosGerente nichos={await listarNichosComUso()} /> : <VisaoCloser />}
    </div>
  )
}

async function VisaoCloser() {
  const nichos = await listarNichosAtivos()
  if (nichos.length === 0) {
    return <EstadoVazio titulo="Nenhum nicho cadastrado" descricao="O administrador cadastra os nichos em Configurações. Eles classificam os leads no funil." />
  }

  return (
    <ul className={`${cartaoClass} divide-y divide-premium-borda-suave`}>
      {nichos.map((n) => (
        <li key={n.id} className="flex items-center gap-2 px-4 py-3 text-sm">
          <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: PALETA_ETAPAS[n.cor].hex }} />
          {n.nome}
        </li>
      ))}
    </ul>
  )
}
