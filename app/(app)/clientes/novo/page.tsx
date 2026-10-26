import type { Metadata } from 'next'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { Secao } from '@/components/ui/secao'
import { criarClienteAction } from '@/lib/actions/clientes'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { listarFunis } from '@/lib/dal/funis'

import { ClienteForm } from '../_components/cliente-form'

export const metadata: Metadata = {
  title: 'Novo cliente',
}

export default async function NovoClientePage() {
  const [usuario, empresa] = await Promise.all([getUsuarioAtual(), getEmpresaAtual()])

  if (empresa.somenteLeitura) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeaderPremium titulo="Novo cliente" voltar={{ href: '/clientes', rotulo: 'Clientes' }} />
        <EstadoVazio
          titulo="Cadastro indisponível"
          descricao="Esta empresa está em modo somente leitura: os dados podem ser consultados, mas não alterados."
          acao={{ href: '/clientes', rotulo: 'Voltar para clientes' }}
        />
      </div>
    )
  }

  const [responsaveis, funis] = await Promise.all([listarResponsaveis(), listarFunis()])
  const funisAtivos = funis.filter((f) => f.ativo)

  if (funisAtivos.length === 0) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeaderPremium titulo="Novo cliente" voltar={{ href: '/clientes', rotulo: 'Clientes' }} />
        <EstadoVazio
          titulo="Nenhum funil liberado para você"
          descricao="Todo cliente novo entra num funil. Peça ao gerente para liberar ao menos um funil nas suas permissões."
          acao={{ href: '/clientes', rotulo: 'Voltar para clientes' }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Novo cliente"
        subtitulo="Uma negociação é aberta automaticamente, na primeira etapa aberta do funil escolhido."
        voltar={{ href: '/clientes', rotulo: 'Clientes' }}
      />

      <Secao>
        <ClienteForm
          action={criarClienteAction}
          valoresIniciais={{
            tipo_cliente: 'pessoa_fisica',
            owner_id: usuario.id,
          }}
          responsaveis={responsaveis}
          funis={funisAtivos}
          rotuloEnviar="Cadastrar cliente"
          cancelarHref="/clientes"
        />
      </Secao>
    </div>
  )
}
