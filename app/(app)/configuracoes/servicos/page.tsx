import type { Metadata } from 'next'
import Link from 'next/link'

import {
  botaoPrimarioClass,
  botaoSecundarioClass,
  botaoPerigoClass,
  caixaErroClass,
  tabelaCaixaClass,
  theadClass,
  tbodyClass,
} from '@/components/ui/estilos'
import { definirAtivoServicoAction, excluirServicoAction } from '@/lib/actions/servicos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { listarServicosAtivos, listarServicosComUso, type Servico, type ServicoComUso } from '@/lib/dal/servicos'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

export const metadata: Metadata = {
  title: 'Serviços',
}

/** Gerente: ativos e desativados, com ações. Closer: só ativos, leitura. */
export default async function ServicosPage({ searchParams }: PageProps<'/configuracoes/servicos'>) {
  const eu = await getUsuarioAtual()
  const gerente = eu.role === 'gerente'

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderPremium
        titulo="Serviços"
        subtitulo={
          <>
            {gerente
              ? 'Catálogo usado nas negociações. Serviço já usado não é excluído: desative-o.'
              : 'Serviços disponíveis para as negociações.'}
          </>
        }
        voltar={{ href: '/configuracoes', rotulo: 'Configurações' }}
        acoes={
          gerente && (
            <Link href="/configuracoes/servicos/novo" className={botaoPrimarioClass}>
              Novo serviço
            </Link>
          )
        }
      />

      {gerente ? <VisaoGerente erro={(await searchParams).erro} /> : <VisaoCloser />}
    </div>
  )
}

async function VisaoCloser() {
  const servicos = await listarServicosAtivos()
  if (servicos.length === 0)
    return <Vazio descricao="Quando o gerente cadastrar serviços, eles aparecem aqui e nas negociações.">Nenhum serviço cadastrado</Vazio>

  return (
    <Tabela colunas={['Serviço', 'Categoria']}>
      {servicos.map((s) => (
        <tr key={s.id}>
          <CelulaNome servico={s} />
          <CelulaCategoria servico={s} />
        </tr>
      ))}
    </Tabela>
  )
}

async function VisaoGerente({ erro }: { erro: string | string[] | undefined }) {
  const servicos = await listarServicosComUso()
  const ativos = servicos.filter((s) => s.ativo)
  const inativos = servicos.filter((s) => !s.ativo)

  return (
    <>
      {typeof erro === 'string' && (
        <p role="alert" className={caixaErroClass}>
          {erro}
        </p>
      )}

      {ativos.length === 0 ? (
        <Vazio
          descricao="Os serviços aparecem nas negociações e propostas. Use “Novo serviço”, acima, para cadastrar o primeiro."
        >
          Nenhum serviço ativo
        </Vazio>
      ) : (
        <TabelaGerente servicos={ativos} />
      )}

      {inativos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Desativados</h2>
          <p className="text-sm text-premium-secundario">
            Fora da escolha em negociações novas, mas mantidos nas negociações que já os usam.
          </p>
          <TabelaGerente servicos={inativos} />
        </section>
      )}
    </>
  )
}

function TabelaGerente({ servicos }: { servicos: ServicoComUso[] }) {
  return (
    <Tabela colunas={['Serviço', 'Categoria', 'Negociações', '']}>
      {servicos.map((s) => (
        <tr key={s.id} className={s.ativo ? undefined : 'text-premium-mudo'}>
          <CelulaNome servico={s} />
          <CelulaCategoria servico={s} />
          <td className="px-4 py-3 text-right tabular-nums">{s.negociacoes}</td>
          <td className="px-4 py-3">
            <span className="flex justify-end gap-2">
              <Link href={`/configuracoes/servicos/${s.id}/editar`} className={botaoSecundarioClass}>
                Editar
              </Link>
              <form action={definirAtivoServicoAction.bind(null, s.id, !s.ativo)}>
                <button type="submit" className={botaoSecundarioClass}>
                  {s.ativo ? 'Desativar' : 'Reativar'}
                </button>
              </form>
              {s.negociacoes === 0 ? (
                <form action={excluirServicoAction.bind(null, s.id)}>
                  <button type="submit" className={botaoPerigoClass}>
                    Excluir
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Usado em negociações: desative em vez de excluir."
                  className={`${botaoSecundarioClass} cursor-not-allowed opacity-50`}
                >
                  Excluir
                </button>
              )}
            </span>
          </td>
        </tr>
      ))}
    </Tabela>
  )
}

function Tabela({ colunas, children }: { colunas: string[]; children: React.ReactNode }) {
  return (
    <div className={tabelaCaixaClass}>
      <table className="w-full text-left text-sm">
        <thead className={theadClass}>
          <tr>
            {colunas.map((c, i) => (
              <th key={i} className={`px-4 py-3 font-medium ${c === 'Negociações' ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tbodyClass}>{children}</tbody>
      </table>
    </div>
  )
}

function CelulaNome({ servico }: { servico: Servico }) {
  return <td className="px-4 py-3 font-medium">{servico.nome}</td>
}

function CelulaCategoria({ servico }: { servico: Servico }) {
  return <td className="px-4 py-3">{servico.categoria ?? <span className="text-premium-mudo">—</span>}</td>
}

/** Estado vazio das listas: mensagem e, quando houver, o próximo passo. */
function Vazio({ children, acao, descricao }: { children: string; acao?: { href: string; rotulo: string }; descricao?: string }) {
  return <EstadoVazio titulo={children} descricao={descricao} acao={acao} />
}
