import type { Metadata } from 'next'
import Link from 'next/link'

import { getUsuarioAtual } from '@/lib/dal/auth'

export const metadata: Metadata = {
  title: 'Configurações',
}

type Item = { href: string; titulo: string; descricao: string }

const ITENS_GERENTE: Item[] = [
  {
    href: '/configuracoes/usuarios',
    titulo: 'Usuários',
    descricao: 'Criar, editar e desativar gerentes e closers.',
  },
  {
    href: '/configuracoes/funis',
    titulo: 'Funis',
    descricao: 'Criar funis, configurar etapas, cores e a ordem das colunas.',
  },
  {
    href: '/configuracoes/servicos',
    titulo: 'Serviços',
    descricao: 'Catálogo de serviços das negociações. Criar, categorizar e desativar.',
  },
  {
    href: '/configuracoes/agenda',
    titulo: 'Agenda Google',
    descricao: 'Conectar o Google Calendar da empresa e diagnosticar as cores usadas.',
  },
  {
    href: '/configuracoes/whatsapp',
    titulo: 'WhatsApp',
    descricao: 'Funil e responsável padrão da conexão WhatsApp.',
  },
]

const ITENS_CLOSER: Item[] = [
  {
    href: '/configuracoes/servicos',
    titulo: 'Serviços',
    descricao: 'Catálogo de serviços disponíveis (consulta).',
  },
]

export default async function ConfiguracoesPage() {
  const usuario = await getUsuarioAtual()
  const itens = usuario.role === 'gerente' ? ITENS_GERENTE : ITENS_CLOSER

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      <ul className="grid gap-4 sm:grid-cols-2">
        {itens.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
            >
              <p className="font-medium">{item.titulo}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{item.descricao}</p>
            </Link>
          </li>
        ))}
      </ul>

      {usuario.role !== 'gerente' && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Para alterar seus dados de acesso, fale com o gerente.
        </p>
      )}
    </div>
  )
}
