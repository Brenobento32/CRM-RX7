import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Aviso } from '@/components/ui/aviso'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { opcoesDeDestino } from '@/lib/dal/fontes-leads'
import { integracoesHabilitadas, listarContasGoogle, podeAdministrarIntegracoes } from '@/lib/dal/integracoes-oficiais'

import { AssistentePlanilha } from './assistente-planilha'

export const metadata: Metadata = { title: 'Conectar planilha do Google' }

const MOTIVOS: Record<string, string> = {
  permissao_negada: 'Para ler a planilha, marque a permissão de acesso aos arquivos escolhidos no AVANTE (Google Drive) na tela do Google.',
  estado_invalido: 'A autorização não veio desta tela. Comece de novo pelo botão "Conectar conta Google".',
  estado_expirado: 'A autorização expirou (10 minutos) ou já foi usada. Tente de novo.',
  sem_refresh: 'O Google não devolveu autorização permanente. Tente de novo e confirme todas as permissões.',
  google_recusou: 'O Google recusou a autorização. Tente de novo.',
  nao_salvo: 'Não foi possível guardar a conexão com segurança. Tente de novo.',
  nao_configurado: 'A integração com o Google ainda não foi configurada na plataforma (fale com o suporte da Rio X7).',
  sem_codigo: 'O Google não devolveu o código de autorização. Tente de novo.',
}

export default async function ConectarPlanilhaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()
  const [podeGerir, contas, opcoes, responsaveis, params, habilitadas] = await Promise.all([
    podeAdministrarIntegracoes(),
    listarContasGoogle(),
    opcoesDeDestino(),
    listarResponsaveis(),
    searchParams,
    integracoesHabilitadas(),
  ])
  const p = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : null)
  const retorno = p('google')
  const aviso =
    retorno === 'conectado'
      ? { tom: 'sucesso' as const, texto: 'Conta Google conectada. Agora cole o link da planilha.' }
      : retorno === 'cancelado'
        ? { tom: 'alerta' as const, texto: 'Autorização cancelada no Google. Nada foi conectado.' }
        : retorno === 'erro'
          ? { tom: 'erro' as const, texto: MOTIVOS[p('motivo') ?? ''] ?? 'Não foi possível conectar a conta Google.' }
          : null

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Conectar planilha do Google"
        subtitulo="Conta Google da empresa → planilha → aba → colunas → funil, etapa e responsável. Sem Apps Script: o AVANTE lê a planilha pela API oficial do Google, só com a permissão que você der."
        voltar={{ href: '/configuracoes/integracoes', rotulo: 'Integrações' }}
      />
      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}
      {!habilitadas.googleSheets ? (
        <Aviso tom="info" titulo="Em homologação">O Google Sheets ainda não foi liberado na plataforma. Nenhuma conexão é aberta enquanto isso.</Aviso>
      ) : podeGerir ? (
        <AssistentePlanilha
          contas={contas.filter((c) => c.ativa).map((c) => ({ id: c.id, email: c.email, comErro: Boolean(c.ultimoErro) }))}
          contaInicial={retorno === 'conectado' ? p('conta') : null}
          reconectar={p('reconectar') === '1'}
          opcoes={opcoes}
          responsaveis={responsaveis.map((r) => ({ id: r.id, nome: r.nome }))}
        />
      ) : (
        <Aviso tom="info">Somente o Administrador da empresa conecta planilhas.</Aviso>
      )}
    </div>
  )
}
