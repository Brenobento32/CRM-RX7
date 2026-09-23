import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { EtapaFunil } from '@/lib/utils/etapas'
import type { Periodo } from '@/lib/utils/periodo'

type Enums = Database['public']['Enums']

/** Quantos meses o gráfico de vendas mostra, contando o atual. */
export const MESES_EVOLUCAO = 12
const LIMITE_RECENTES = 8

export type Kpis = {
  pipelineValor: number
  abertas: number
  vendidoValor: number
  ganhos: number
  perdidos: number
  reunioesProximas: number
  /** Ganhos ÷ (ganhos + perdidos) no período, de 0 a 1. `null` sem encerramentos. */
  conversao: number | null
}

export type PerformanceUsuario = Kpis & {
  usuarioId: string
  nome: string
  role: Enums['user_role']
  reunioesRealizadas: number
  atividades: number
}

export type EtapaResumo = { etapa: EtapaFunil; quantidade: number; valor: number }

export type VendaMensal = { mes: string; valor: number; quantidade: number }

export type AtividadeRecente = {
  id: string
  tipo: Enums['tipo_atividade']
  descricao: string
  data: string
  clienteId: string
  clienteNome: string | null
  usuario: string | null
}

export type Movimentacao = {
  id: number
  etapaAnterior: EtapaFunil | null
  etapaNova: EtapaFunil
  data: string
  clienteId: string | null
  clienteNome: string | null
  usuario: string | null
}

export type Dashboard = {
  kpis: Kpis
  /** Uma linha por pessoa; para o closer, só ele. */
  porUsuario: PerformanceUsuario[]
  etapas: EtapaResumo[]
  vendasMensais: VendaMensal[]
  atividadesRecentes: AtividadeRecente[]
  movimentacoes: Movimentacao[]
}

/**
 * Taxa de conversão: das negociações encerradas no período, quantas foram
 * ganhas. Negociações ainda abertas não entram — não perderam nem ganharam.
 */
export function taxaConversao(ganhos: number, perdidos: number): number | null {
  const encerradas = ganhos + perdidos
  return encerradas === 0 ? null : ganhos / encerradas
}

/**
 * Tudo o que o dashboard mostra. Nenhuma consulta filtra por dono: as
 * funções `dashboard_*` são SECURITY INVOKER e as tabelas têm RLS, então o
 * closer recebe apenas os próprios números e o gerente os da equipe.
 */
export async function obterDashboard(periodo: Periodo): Promise<Dashboard> {
  await getUsuarioAtual()
  const supabase = await createClient()
  const intervalo = { p_inicio: periodo.inicio, p_fim: periodo.fim }

  const [porUsuario, etapas, vendas, atividades, historico] = await Promise.all([
    supabase.rpc('dashboard_por_usuario', intervalo),
    supabase.rpc('dashboard_etapas', intervalo),
    supabase.rpc('dashboard_vendas_mensais', { p_meses: MESES_EVOLUCAO }),
    supabase
      .from('atividades')
      .select(
        'id, tipo, descricao, data, usuario_id, cliente_id, cliente:clientes!atividades_cliente_id_fkey(nome)',
      )
      .order('data', { ascending: false })
      .limit(LIMITE_RECENTES),
    supabase
      .from('historico_etapas')
      .select(
        `id, etapa_anterior, etapa_nova, created_at, usuario_id,
         negociacao:negociacoes!historico_etapas_negociacao_id_fkey(
           cliente_id, cliente:clientes!negociacoes_cliente_id_fkey(nome)
         )`,
      )
      .order('created_at', { ascending: false })
      .limit(LIMITE_RECENTES),
  ])

  for (const r of [porUsuario, etapas, vendas, atividades, historico]) {
    if (r.error) {
      throw new Error('Não foi possível carregar o dashboard.', { cause: r.error })
    }
  }

  const pessoas: PerformanceUsuario[] = (porUsuario.data ?? []).map((p) => ({
    usuarioId: p.usuario_id,
    nome: p.nome,
    role: p.role,
    pipelineValor: Number(p.pipeline_valor),
    abertas: Number(p.abertas),
    vendidoValor: Number(p.vendido_valor),
    ganhos: Number(p.ganhos),
    perdidos: Number(p.perdidos),
    reunioesProximas: Number(p.reunioes_proximas),
    reunioesRealizadas: Number(p.reunioes_realizadas),
    atividades: Number(p.atividades),
    conversao: taxaConversao(Number(p.ganhos), Number(p.perdidos)),
  }))

  const nomes = await nomesDeUsuarios([
    ...(atividades.data ?? []).map((a) => a.usuario_id),
    ...(historico.data ?? []).flatMap((h) => (h.usuario_id ? [h.usuario_id] : [])),
  ])

  return {
    kpis: somarKpis(pessoas),
    porUsuario: pessoas,
    etapas: (etapas.data ?? []).map((e) => ({
      etapa: e.etapa,
      quantidade: Number(e.quantidade),
      valor: Number(e.valor),
    })),
    vendasMensais: (vendas.data ?? []).map((v) => ({
      mes: v.mes,
      valor: Number(v.valor),
      quantidade: Number(v.quantidade),
    })),
    atividadesRecentes: (atividades.data ?? []).map((a) => ({
      id: a.id,
      tipo: a.tipo,
      descricao: a.descricao,
      data: a.data,
      clienteId: a.cliente_id,
      clienteNome: a.cliente?.nome ?? null,
      usuario: nomes.get(a.usuario_id) ?? null,
    })),
    movimentacoes: (historico.data ?? []).map((h) => ({
      id: h.id,
      etapaAnterior: h.etapa_anterior,
      etapaNova: h.etapa_nova,
      data: h.created_at,
      clienteId: h.negociacao?.cliente_id ?? null,
      clienteNome: h.negociacao?.cliente?.nome ?? null,
      usuario: h.usuario_id ? (nomes.get(h.usuario_id) ?? null) : null,
    })),
  }
}

/** KPIs do topo = soma das linhas por pessoa (mesma fonte da tabela). */
function somarKpis(pessoas: PerformanceUsuario[]): Kpis {
  const total = pessoas.reduce(
    (t, p) => ({
      pipelineValor: t.pipelineValor + p.pipelineValor,
      abertas: t.abertas + p.abertas,
      vendidoValor: t.vendidoValor + p.vendidoValor,
      ganhos: t.ganhos + p.ganhos,
      perdidos: t.perdidos + p.perdidos,
      reunioesProximas: t.reunioesProximas + p.reunioesProximas,
    }),
    {
      pipelineValor: 0,
      abertas: 0,
      vendidoValor: 0,
      ganhos: 0,
      perdidos: 0,
      reunioesProximas: 0,
    },
  )
  return { ...total, conversao: taxaConversao(total.ganhos, total.perdidos) }
}
