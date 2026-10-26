import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { botaoPrimarioClass, segmentoClass, segmentoItemClass, botaoSecundarioClass, botaoPerigoClass, inputClass, tabelaCaixaClass, theadClass, tbodyClass } from '@/components/ui/estilos'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import {
  excluirClienteAction,
  restaurarClienteAction,
  restaurarClienteExcluidoAction,
} from '@/lib/actions/clientes'
import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  CLIENTES_POR_PAGINA,
  listarClientes,
  type OrigemFiltroCliente,
  type StatusCliente,
} from '@/lib/dal/clientes'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { formatarTelefone } from '@/lib/utils/documentos'
import { ROTULO_TIPO_CLIENTE } from '@/lib/validations/cliente'

import { BuscaClientes } from './_components/busca-clientes'

export const metadata: Metadata = {
  title: 'Clientes',
}

const ABAS: { valor: StatusCliente; rotulo: string }[] = [
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'arquivados', rotulo: 'Arquivados' },
  { valor: 'excluidos', rotulo: 'Excluídos' },
]

/**
 * "Outbound", nesta arquitetura, É `origem = 'manual'` — não existe um
 * valor de enum "outbound" à parte (`origem_negociacao` só tem
 * `formulario`/`whatsapp`/`manual`, confirmado no banco). WhatsApp não
 * ganha aba própria ainda, só aparece no resumo de origem de cada linha.
 */
const ABAS_ORIGEM: { valor: OrigemFiltroCliente; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'inbound', rotulo: 'Inbound' },
  { valor: 'outbound', rotulo: 'Outbound' },
]

export default async function ClientesPage({
  searchParams,
}: PageProps<'/clientes'>) {
  const [usuario, empresa] = await Promise.all([getUsuarioAtual(), getEmpresaAtual()])
  const params = await searchParams

  const busca = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const pagina = Math.max(1, Number.parseInt(String(params.pagina ?? '1'), 10) || 1)
  const aba: StatusCliente =
    params.aba === 'arquivados' ? 'arquivados' : params.aba === 'excluidos' ? 'excluidos' : 'ativos'
  const origemFiltro: OrigemFiltroCliente =
    params.origem === 'inbound' ? 'inbound' : params.origem === 'outbound' ? 'outbound' : 'todos'

  const { clientes, total } = await listarClientes({ busca, pagina, status: aba, origemFiltro })
  const totalPaginas = Math.max(1, Math.ceil(total / CLIENTES_POR_PAGINA))
  const gerente = usuario.role === 'gerente'
  const arquivados = aba === 'arquivados'
  const excluidos = aba === 'excluidos'
  const temAcoes = arquivados || excluidos
  // Nem arquivado nem excluído abre a página do cliente: obterCliente só enxerga ativos.
  const nomeAbrePagina = aba === 'ativos'

  const hrefPagina = (p: number) => {
    const qs = new URLSearchParams()
    if (busca) qs.set('q', busca)
    if (aba !== 'ativos') qs.set('aba', aba)
    if (origemFiltro !== 'todos') qs.set('origem', origemFiltro)
    if (p > 1) qs.set('pagina', String(p))
    const s = qs.toString()
    return s ? `/clientes?${s}` : '/clientes'
  }

  const hrefAba = (valor: StatusCliente) => {
    const qs = new URLSearchParams()
    if (busca) qs.set('q', busca)
    if (valor !== 'ativos') qs.set('aba', valor)
    if (origemFiltro !== 'todos') qs.set('origem', origemFiltro)
    const s = qs.toString()
    return s ? `/clientes?${s}` : '/clientes'
  }

  const hrefOrigem = (valor: OrigemFiltroCliente) => {
    const qs = new URLSearchParams()
    if (busca) qs.set('q', busca)
    if (aba !== 'ativos') qs.set('aba', aba)
    if (valor !== 'todos') qs.set('origem', valor)
    const s = qs.toString()
    return s ? `/clientes?${s}` : '/clientes'
  }

  return (
    <div className="space-y-6">
      <PageHeaderPremium
        titulo="Clientes"
        subtitulo={gerente ? 'Todos os clientes da equipe.' : 'Sua carteira de clientes.'}
        acoes={
          /* Empresa somente leitura (arquivo): o banco recusa a gravação; a tela nem oferece. */
          empresa.somenteLeitura ? null : (
            <Link href="/clientes/novo" className={botaoPrimarioClass}>
              Novo cliente
            </Link>
          )
        }
      />

      <nav className={segmentoClass} aria-label="Origem">
        {ABAS_ORIGEM.map((a) => (
          <Link
            key={a.valor}
            href={hrefOrigem(a.valor)}
            aria-current={origemFiltro === a.valor ? 'page' : undefined}
            className={segmentoItemClass(origemFiltro === a.valor)}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      <nav className="flex gap-1 border-b border-premium-borda" aria-label="Status do cliente">
        {ABAS.map((a) => (
          <Link
            key={a.valor}
            href={hrefAba(a.valor)}
            aria-current={aba === a.valor ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              aba === a.valor
                ? 'border-premium-acento text-premium-texto'
                : 'border-transparent text-premium-mudo hover:text-premium-texto'
            }`}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      <div className="max-w-md">
        <BuscaClientes valorInicial={busca} />
      </div>

      <div className={tabelaCaixaClass}>
        <table className="w-full text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Contato</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              {gerente && <th className="px-4 py-3 font-medium">Carteira</th>}
              {temAcoes && <th className="px-4 py-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {clientes.map((c) => (
              <tr key={c.id} className="hover:bg-premium-bg">
                <td className="px-4 py-3">
                  {nomeAbrePagina ? (
                    <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                      {c.nome}
                    </Link>
                  ) : (
                    <span className="font-medium">{c.nome}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-premium-secundario">
                  {c.empresa ?? '—'}
                </td>
                <td className="px-4 py-3 text-premium-secundario">
                  {ROTULO_TIPO_CLIENTE[c.tipo_cliente]}
                </td>
                <td className="px-4 py-3 text-premium-secundario">
                  {c.whatsapp
                    ? formatarTelefone(c.whatsapp)
                    : c.telefone
                      ? formatarTelefone(c.telefone)
                      : (c.email ?? '—')}
                </td>
                <td className="px-4 py-3 text-premium-secundario">{c.origens}</td>
                {gerente && (
                  <td className="px-4 py-3 text-premium-secundario">
                    {c.dono ?? '—'}
                  </td>
                )}
                {arquivados && (
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={restaurarClienteAction.bind(null, c.id)}>
                        <button
                          type="submit"
                          className={botaoSecundarioClass}
                        >
                          Restaurar
                        </button>
                      </form>
                      <form action={excluirClienteAction.bind(null, c.id)} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          name="motivo"
                          required
                          placeholder="Motivo da exclusão"
                          aria-label={`Motivo da exclusão de ${c.nome}`}
                          className={`${inputClass} w-40 py-1.5 text-xs`}
                        />
                        <BotaoConfirmar
                          pergunta="Excluir este cliente? O histórico de negociações e fechamentos não é apagado, mas ele some de Ativos e Arquivados."
                          className={`${botaoPerigoClass} shrink-0`}
                        >
                          Excluir
                        </BotaoConfirmar>
                      </form>
                    </div>
                  </td>
                )}
                {excluidos && (
                  <td className="px-4 py-3">
                    <form action={restaurarClienteExcluidoAction.bind(null, c.id)}>
                      <button
                        type="submit"
                        className={botaoSecundarioClass}
                      >
                        Restaurar
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {clientes.length === 0 && (
              <tr>
                <td
                  colSpan={(gerente ? 6 : 5) + (temAcoes ? 1 : 0)}
                  className="px-4 py-4"
                >
                  {busca ? (
                    <EstadoVazio compacto titulo={`Nenhum cliente encontrado para “${busca}”`} descricao="Confira a grafia ou busque pelo telefone, e-mail ou nome da empresa." />
                  ) : arquivados ? (
                    <EstadoVazio compacto titulo="Nenhum cliente arquivado" descricao="Clientes arquivados saem da carteira ativa e aparecem aqui." />
                  ) : excluidos ? (
                    <EstadoVazio compacto titulo="Nenhum cliente excluído" />
                  ) : (
                    <EstadoVazio
                      compacto
                      titulo="Nenhum cliente cadastrado ainda"
                      descricao="Cadastre o primeiro cliente — ele já entra no funil escolhido."
                      acao={empresa.somenteLeitura ? undefined : { href: '/clientes/novo', rotulo: 'Novo cliente' }}
                    />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-premium-secundario">
          <span>
            {total} {total === 1 ? 'cliente' : 'clientes'}
          </span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-2">
              {pagina > 1 && (
                <Link href={hrefPagina(pagina - 1)} className="rounded-md px-3 py-1 hover:bg-premium-bg">
                  Anterior
                </Link>
              )}
              <span>
                Página {pagina} de {totalPaginas}
              </span>
              {pagina < totalPaginas && (
                <Link href={hrefPagina(pagina + 1)} className="rounded-md px-3 py-1 hover:bg-premium-bg">
                  Próxima
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
