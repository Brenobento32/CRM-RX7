import { CARGOS_POR_AREA, type Cargo } from '@/lib/validations/usuario'

/** Nome do ícone (o desenho fica em `components/layout/icones.tsx`). */
export type NomeIcone =
  | 'inicio' | 'agenda' | 'crm' | 'kanban' | 'metricas' | 'leads' | 'configuracoes' | 'etapas' | 'nichos'
  | 'servicos' | 'clientes' | 'metas' | 'propostas' | 'abertas' | 'fechadas' | 'relatorios' | 'vendas'
  | 'conversao' | 'exportacao' | 'empresa' | 'usuarios' | 'integracoes' | 'assinatura' | 'conversas'

/**
 * Item do menu lateral: link (`href`) ou grupo (`filhos`), em até três níveis
 * (CRM → Configurações → Etapas). `cargos`: quem vê (matriz de cargos);
 * `somenteGerente`: só o Gerente; sem nenhum dos dois, todos os cargos. Um
 * grupo sem filhos visíveis some inteiro — nunca aparece link para página
 * que o cargo não pode abrir (o banco e cada página conferem de novo).
 */
export type NoMenu = {
  chave: string
  rotulo: string
  icone: NomeIcone
  href?: string
  filhos?: NoMenu[]
  cargos?: readonly Cargo[]
  somenteGerente?: boolean
  /** Nome acessível mais completo (ex.: "Configurações do CRM"). */
  titulo?: string
  /** Outras rotas que também marcam este link como ativo (Etapas abre /configuracoes/funis/…). */
  tambem?: string[]
}

export const MENU: NoMenu[] = [
  { chave: 'inicio', href: '/', rotulo: 'Início', icone: 'inicio' },
  { chave: 'agenda', href: '/agenda', rotulo: 'Agenda', icone: 'agenda' },
  {
    chave: 'crm',
    rotulo: 'CRM',
    icone: 'crm',
    filhos: [
      { chave: 'crm-funil', href: '/funil', rotulo: 'Funil', icone: 'kanban' },
      { chave: 'crm-metricas', href: '/funil/metricas', rotulo: 'Métricas', icone: 'metricas', cargos: CARGOS_POR_AREA.relatorios },
      { chave: 'crm-leads', href: '/funil/leads', rotulo: 'Leads', icone: 'leads' },
      {
        chave: 'crm-config',
        rotulo: 'Configurações',
        titulo: 'Configurações do CRM',
        icone: 'configuracoes',
        somenteGerente: true,
        filhos: [
          { chave: 'crm-etapas', href: '/configuracoes/etapas', tambem: ['/configuracoes/funis'], rotulo: 'Etapas', icone: 'etapas', somenteGerente: true },
          { chave: 'crm-nichos', href: '/configuracoes/nichos', rotulo: 'Nichos', icone: 'nichos', somenteGerente: true },
          { chave: 'crm-servicos', href: '/configuracoes/servicos', rotulo: 'Serviços', icone: 'servicos', somenteGerente: true },
        ],
      },
    ],
  },
  { chave: 'clientes', href: '/clientes', rotulo: 'Clientes', icone: 'clientes' },
  // WhatsApp oficial: todos os cargos; o banco mostra só as conversas da carteira de cada um.
  { chave: 'conversas', href: '/conversas', rotulo: 'Conversas', icone: 'conversas' },
  { chave: 'metas', href: '/metas', rotulo: 'Metas', icone: 'metas', cargos: CARGOS_POR_AREA.metas },
  {
    chave: 'propostas',
    rotulo: 'Propostas',
    icone: 'propostas',
    cargos: CARGOS_POR_AREA.propostas,
    filhos: [
      { chave: 'propostas-abertas', href: '/propostas/abertas', rotulo: 'Abertas', icone: 'abertas' },
      { chave: 'propostas-fechadas', href: '/propostas/fechadas', rotulo: 'Fechadas', icone: 'fechadas' },
    ],
  },
  {
    chave: 'relatorios',
    rotulo: 'Relatórios',
    icone: 'relatorios',
    cargos: CARGOS_POR_AREA.relatorios,
    filhos: [
      { chave: 'relatorios-vendas', href: '/relatorios/vendas', rotulo: 'Vendas', icone: 'vendas' },
      { chave: 'relatorios-conversao', href: '/relatorios/conversao', rotulo: 'Conversão', icone: 'conversao' },
      { chave: 'relatorios-exportacao', href: '/relatorios/exportacao', rotulo: 'Exportação', icone: 'exportacao' },
    ],
  },
  {
    chave: 'empresa',
    rotulo: 'Configurações',
    titulo: 'Configurações da empresa',
    icone: 'configuracoes',
    somenteGerente: true,
    filhos: [
      { chave: 'empresa-dados', href: '/configuracoes/empresa', rotulo: 'Dados da empresa', icone: 'empresa', somenteGerente: true },
      { chave: 'empresa-usuarios', href: '/configuracoes/usuarios', rotulo: 'Usuários', icone: 'usuarios', somenteGerente: true },
      { chave: 'empresa-integracoes', href: '/configuracoes/integracoes', rotulo: 'Integrações', icone: 'integracoes', somenteGerente: true },
      { chave: 'empresa-assinatura', href: '/configuracoes/assinatura', rotulo: 'Assinatura', icone: 'assinatura', somenteGerente: true },
    ],
  },
]

/** Só o que o cargo pode usar; grupo sem filhos visíveis some. */
export function filtrarMenu(papel: Cargo, nos: NoMenu[] = MENU): NoMenu[] {
  return nos.flatMap((n) => {
    if (n.somenteGerente && papel !== 'gerente') return []
    if (n.cargos && !n.cargos.includes(papel)) return []
    if (!n.filhos) return [n]
    const filhos = filtrarMenu(papel, n.filhos)
    return filhos.length > 0 ? [{ ...n, filhos }] : []
  })
}

export function folhasMenu(nos: NoMenu[]): NoMenu[] {
  return nos.flatMap((n) => (n.filhos ? folhasMenu(n.filhos) : [n]))
}

function dentroDe(pathname: string, rota: string) {
  if (rota === '/') return pathname === '/'
  return pathname === rota || pathname.startsWith(`${rota}/`)
}

/** Link ativo: o mais específico que contém a rota (/funil/metricas vence /funil). */
export function hrefAtivoMenu(pathname: string, nos: NoMenu[]): string | undefined {
  return folhasMenu(nos)
    .flatMap((f) => [f.href!, ...(f.tambem ?? [])].map((rota) => ({ href: f.href!, rota })))
    .filter((x) => dentroDe(pathname, x.rota))
    .sort((a, b) => b.rota.length - a.rota.length)[0]?.href
}

/** O nó (ou algum descendente) é o link ativo — grupo ancestral abre sozinho. */
export function contemMenu(n: NoMenu, href: string | undefined): boolean {
  if (!href) return false
  return n.href === href || (n.filhos ?? []).some((f) => contemMenu(f, href))
}

/** Árvore de rótulos (e links) que um cargo vê — usada nos testes da matriz. */
export function menuDoCargo(papel: Cargo): string[] {
  const linhas = (nos: NoMenu[], nivel: number): string[] =>
    nos.flatMap((n) => [`${'  '.repeat(nivel)}${n.rotulo}${n.href ? ` ${n.href}` : ''}`, ...(n.filhos ? linhas(n.filhos, nivel + 1) : [])])
  return linhas(filtrarMenu(papel), 0)
}

export type PassoTrilha = { rotulo: string; href?: string }

const ROTAS_FORA_DO_MENU: Record<string, string> = { '/perfil': 'Meu perfil', '/configuracoes': 'Configurações' }
/** Telas internas sem item no menu (ex.: edição de negociação, aberta a partir do cliente ou do funil). */
const PREFIXOS_FORA_DO_MENU: Record<string, string> = { '/negociacoes/': 'Negociação' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Trilha "onde estou" do cabeçalho: grupos do menu até o link ativo e, para
 * páginas internas (novo, editar, detalhe), um último passo descritivo. Só
 * usa o menu já filtrado pelo cargo — nunca revela área proibida.
 */
export function trilhaMenu(pathname: string, papel: Cargo): PassoTrilha[] {
  if (ROTAS_FORA_DO_MENU[pathname]) return [{ rotulo: ROTAS_FORA_DO_MENU[pathname] }]
  const nos = filtrarMenu(papel)
  const ativo = hrefAtivoMenu(pathname, nos)
  if (!ativo) {
    const prefixo = Object.keys(PREFIXOS_FORA_DO_MENU).find((p) => pathname.startsWith(p))
    return prefixo ? [{ rotulo: PREFIXOS_FORA_DO_MENU[prefixo] }] : []
  }

  const caminho: NoMenu[] = []
  const buscar = (lista: NoMenu[]): boolean =>
    lista.some((n) => {
      caminho.push(n)
      if (n.href === ativo || (n.filhos && buscar(n.filhos))) return true
      caminho.pop()
      return false
    })
  buscar(nos)

  const trilha: PassoTrilha[] = caminho.map((n) => ({ rotulo: n.rotulo, href: n.href }))
  if (ativo === '/') return trilha

  const resto = pathname.slice(ativo.length).split('/').filter(Boolean)
  const ultimo = resto.at(-1)
  if (ultimo) {
    const rotulo = ultimo === 'novo' || ultimo === 'nova' ? 'Novo' : ultimo === 'editar' ? 'Editar' : UUID.test(ultimo) ? 'Detalhes' : null
    if (rotulo) trilha.push({ rotulo })
  }
  return trilha
}
