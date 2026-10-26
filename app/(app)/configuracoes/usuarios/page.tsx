import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Avatar } from '@/components/ui/avatar'
import {
  botaoPrimarioClass,
  botaoSecundarioClass,
  caixaErroClass,
  caixaAlertaClass,
  tabelaCaixaClass,
  theadClass,
  tbodyClass,
} from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { definirAcessoAction } from '@/lib/actions/usuarios'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarUsuarios } from '@/lib/dal/usuarios'
import { formatarTelefone } from '@/lib/utils/documentos'
import { PALETA_ETAPAS } from '@/lib/utils/etapas'
import { ROTULO_PAPEL } from '@/lib/validations/usuario'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'

export const metadata: Metadata = {
  title: 'Usuários',
}

export default async function UsuariosPage({ searchParams }: PageProps<'/configuracoes/usuarios'>) {
  const eu = await getUsuarioAtual()
  // Para o closer a rota simplesmente não existe.
  if (eu.role !== 'gerente') notFound()

  const { erro, aviso } = await searchParams
  const usuarios = await listarUsuarios()

  return (
    <div className="space-y-6">
      <PageHeaderPremium
        titulo="Usuários"
        voltar={{ href: '/configuracoes', rotulo: 'Configurações' }}
        acoes={
          <Link href="/configuracoes/usuarios/novo" className={botaoPrimarioClass}>
            Novo usuário
          </Link>
        }
      />

      {typeof erro === 'string' && (
        <p role="alert" className={caixaErroClass}>
          {erro}
        </p>
      )}
      {typeof aviso === 'string' && (
        <p role="status" className={caixaAlertaClass}>
          {aviso}
        </p>
      )}

      <div className={tabelaCaixaClass}>
        <table className="w-full text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3 font-medium">Usuário</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Telefone</th>
              <th className="px-4 py-3 font-medium">Perfil</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {usuarios.map((u) => (
              <tr key={u.id} className={u.ativo ? undefined : 'text-premium-mudo'}>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-3">
                    <Avatar nome={u.nome} fotoUrl={u.fotoUrl} tamanho="sm" />
                    <span className="flex items-center gap-1.5 font-medium">
                      {u.corAgenda && (
                        <span title={`Cor na agenda: ${PALETA_ETAPAS[u.corAgenda].rotulo}`}>
                          <PontoEtapa cor={u.corAgenda} />
                        </span>
                      )}
                      {u.nome}
                      {u.id === eu.id && <span className="ml-1 text-xs font-normal text-premium-mudo">(você)</span>}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 whitespace-nowrap">{u.telefone ? formatarTelefone(u.telefone) : '—'}</td>
                <td className="px-4 py-3">{ROTULO_PAPEL[u.role]}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      u.ativo
                        ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300'
                        : 'rounded-full bg-premium-bg px-2 py-0.5 text-xs font-medium text-premium-secundario'
                    }
                  >
                    {u.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex justify-end gap-2">
                    <Link href={`/configuracoes/usuarios/${u.id}/editar`} className={botaoSecundarioClass}>
                      Editar
                    </Link>
                    {u.id !== eu.id && (
                      <form action={definirAcessoAction.bind(null, u.id, !u.ativo)}>
                        <button type="submit" className={botaoSecundarioClass}>
                          {u.ativo ? 'Desativar' : 'Reativar'}
                        </button>
                      </form>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-premium-mudo">
        Usuários não são excluídos. Desativar bloqueia o login e mantém o histórico e a carteira — transfira os clientes para outra pessoa
        pela edição de cada cliente.
      </p>
    </div>
  )
}
