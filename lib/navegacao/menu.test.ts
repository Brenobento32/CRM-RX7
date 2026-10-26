import { describe, expect, it } from 'vitest'

import { menuDoCargo, trilhaMenu } from './menu'

describe('menu lateral por cargo', () => {
  it('Gerente: CRM com Configurações (Etapas, Nichos, Serviços) e as Configurações da empresa', () => {
    const m = menuDoCargo('gerente')
    expect(m).toEqual(
      expect.arrayContaining([
        'CRM',
        '  Funil /funil',
        '  Métricas /funil/metricas',
        '  Leads /funil/leads',
        '  Configurações',
        '    Etapas /configuracoes/etapas',
        '    Nichos /configuracoes/nichos',
        '    Serviços /configuracoes/servicos',
        'Configurações',
        '  Dados da empresa /configuracoes/empresa',
        '  Usuários /configuracoes/usuarios',
      ]),
    )
    // CRM fica entre Agenda e Clientes, na ordem pedida.
    expect(m.slice(m.indexOf('CRM'), m.indexOf('CRM') + 8)).toEqual([
      'CRM',
      '  Funil /funil',
      '  Métricas /funil/metricas',
      '  Leads /funil/leads',
      '  Configurações',
      '    Etapas /configuracoes/etapas',
      '    Nichos /configuracoes/nichos',
      '    Serviços /configuracoes/servicos',
    ])
  })

  it.each(['vendedor', 'sdr', 'closer'] as const)('%s: CRM sem Configurações; sem Configurações da empresa', (cargo) => {
    const m = menuDoCargo(cargo)
    expect(m).toContain('  Métricas /funil/metricas')
    expect(m.some((l) => l.includes('/configuracoes/'))).toBe(false)
    expect(m.filter((l) => l.trim() === 'Configurações')).toEqual([])
  })

  it('Atendente: só Funil e Leads no CRM; sem Métricas, Metas, Propostas, Relatórios e Configurações', () => {
    const m = menuDoCargo('atendente')
    expect(m).toEqual(['Início /', 'Agenda /agenda', 'CRM', '  Funil /funil', '  Leads /funil/leads', 'Clientes /clientes'])
  })

  it('Propostas só para Gerente, Vendedor e Closer; Metas e Relatórios também para SDR', () => {
    expect(menuDoCargo('sdr').some((l) => l.startsWith('Propostas'))).toBe(false)
    expect(menuDoCargo('sdr')).toContain('Metas /metas')
    expect(menuDoCargo('vendedor').some((l) => l.startsWith('Propostas'))).toBe(true)
    expect(menuDoCargo('closer').some((l) => l.startsWith('Propostas'))).toBe(true)
  })
})

describe('trilha do cabeçalho', () => {
  it('mostra os grupos até a página ativa', () => {
    expect(trilhaMenu('/configuracoes/funis/abc', 'gerente').map((p) => p.rotulo)).toEqual(['CRM', 'Configurações', 'Etapas'])
    expect(trilhaMenu('/funil/metricas', 'closer').map((p) => p.rotulo)).toEqual(['CRM', 'Métricas'])
    expect(trilhaMenu('/', 'sdr').map((p) => p.rotulo)).toEqual(['Início'])
  })

  it('descreve páginas internas: novo, editar e detalhe', () => {
    expect(trilhaMenu('/clientes/novo', 'vendedor').map((p) => p.rotulo)).toEqual(['Clientes', 'Novo'])
    expect(trilhaMenu('/clientes/2baefe3b-5644-41e1-9e15-7528ba5fa9c3', 'atendente').map((p) => p.rotulo)).toEqual(['Clientes', 'Detalhes'])
    expect(trilhaMenu('/configuracoes/usuarios/2baefe3b-5644-41e1-9e15-7528ba5fa9c3/editar', 'gerente').map((p) => p.rotulo)).toEqual([
      'Configurações',
      'Usuários',
      'Editar',
    ])
  })

  it('nunca revela área proibida: rota sem permissão não gera trilha', () => {
    expect(trilhaMenu('/configuracoes/usuarios', 'atendente')).toEqual([])
    expect(trilhaMenu('/funil/metricas', 'atendente').map((p) => p.rotulo)).toEqual(['CRM', 'Funil'])
  })

  it('telas internas fora do menu ganham um rótulo próprio', () => {
    expect(trilhaMenu('/negociacoes/2baefe3b-5644-41e1-9e15-7528ba5fa9c3/editar', 'closer').map((p) => p.rotulo)).toEqual(['Negociação'])
    expect(trilhaMenu('/rota-que-nao-existe', 'gerente')).toEqual([])
  })
})
