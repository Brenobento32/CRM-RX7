import { describe, expect, it } from 'vitest'

import { estadoInicial, paraItens, type FunilOpcao } from './permissoes-comerciais'

const FUNIL_A: FunilOpcao = { id: 'funil-a', nome: 'Inbound' }
const FUNIL_B: FunilOpcao = { id: 'funil-b', nome: 'Outbound' }

describe('estadoInicial', () => {
  it('2/11. sem nenhuma permissão, todo funil nasce sem acesso e sem etapas', () => {
    const estado = estadoInicial([FUNIL_A, FUNIL_B], [])
    expect(estado[FUNIL_A.id]).toEqual({ acesso: false, etapas: {} })
    expect(estado[FUNIL_B.id]).toEqual({ acesso: false, etapas: {} })
  })

  it('linha com etapaId null marca acesso ao funil, sem afetar etapas', () => {
    const estado = estadoInicial(
      [FUNIL_A],
      [{ funilId: FUNIL_A.id, etapaId: null, podeVer: null, podeMover: null }],
    )
    expect(estado[FUNIL_A.id].acesso).toBe(true)
    expect(estado[FUNIL_A.id].etapas).toEqual({})
  })

  it('12/13. linha de etapa hidrata pode_ver/pode_mover daquela etapa específica, sem tocar outras', () => {
    const estado = estadoInicial(
      [FUNIL_A],
      [
        { funilId: FUNIL_A.id, etapaId: null, podeVer: null, podeMover: null },
        { funilId: FUNIL_A.id, etapaId: 'etapa-1', podeVer: true, podeMover: true },
        { funilId: FUNIL_A.id, etapaId: 'etapa-2', podeVer: true, podeMover: false },
      ],
    )
    expect(estado[FUNIL_A.id].etapas['etapa-1']).toEqual({ podeVer: true, podeMover: true })
    expect(estado[FUNIL_A.id].etapas['etapa-2']).toEqual({ podeVer: true, podeMover: false })
    expect(estado[FUNIL_A.id].etapas['etapa-3']).toBeUndefined()
  })

  it('ignora permissão de um funil que não está mais na lista (excluído) em vez de quebrar', () => {
    const estado = estadoInicial(
      [FUNIL_A],
      [{ funilId: 'funil-removido', etapaId: null, podeVer: null, podeMover: null }],
    )
    expect(estado[FUNIL_A.id]).toEqual({ acesso: false, etapas: {} })
    expect(estado['funil-removido']).toBeUndefined()
  })
})

describe('paraItens', () => {
  it('17. funil sem acesso não gera NENHUM item, mesmo com etapas marcadas no estado', () => {
    const itens = paraItens({
      [FUNIL_A.id]: { acesso: false, etapas: { 'etapa-1': { podeVer: true, podeMover: true } } },
    })
    expect(itens).toEqual([])
  })

  it('funil com acesso gera a linha de acesso ao funil (etapaId null)', () => {
    const itens = paraItens({ [FUNIL_A.id]: { acesso: true, etapas: {} } })
    expect(itens).toEqual([{ funilId: FUNIL_A.id, etapaId: null, podeVer: null, podeMover: null }])
  })

  it('4/5. etapa com pode_ver e/ou pode_mover marcado gera uma linha própria', () => {
    const itens = paraItens({
      [FUNIL_A.id]: {
        acesso: true,
        etapas: {
          'etapa-ver-so': { podeVer: true, podeMover: false },
          'etapa-ver-e-mover': { podeVer: true, podeMover: true },
        },
      },
    })
    expect(itens).toContainEqual({ funilId: FUNIL_A.id, etapaId: 'etapa-ver-so', podeVer: true, podeMover: false })
    expect(itens).toContainEqual({ funilId: FUNIL_A.id, etapaId: 'etapa-ver-e-mover', podeVer: true, podeMover: true })
  })

  it('etapa sem nenhum dos dois marcado não gera linha nenhuma (desmarcar = remover, não gravar falso)', () => {
    const itens = paraItens({
      [FUNIL_A.id]: { acesso: true, etapas: { 'etapa-1': { podeVer: false, podeMover: false } } },
    })
    expect(itens).toEqual([{ funilId: FUNIL_A.id, etapaId: null, podeVer: null, podeMover: null }])
  })

  it('15/16. funis diferentes geram conjuntos de itens independentes', () => {
    const itens = paraItens({
      [FUNIL_A.id]: { acesso: true, etapas: { 'etapa-a1': { podeVer: true, podeMover: true } } },
      [FUNIL_B.id]: { acesso: true, etapas: { 'etapa-b1': { podeVer: true, podeMover: false } } },
    })
    expect(itens).toContainEqual({ funilId: FUNIL_A.id, etapaId: 'etapa-a1', podeVer: true, podeMover: true })
    expect(itens).toContainEqual({ funilId: FUNIL_B.id, etapaId: 'etapa-b1', podeVer: true, podeMover: false })
    expect(itens.filter((i) => i.funilId === FUNIL_A.id && i.etapaId !== null)).toHaveLength(1)
    expect(itens.filter((i) => i.funilId === FUNIL_B.id && i.etapaId !== null)).toHaveLength(1)
  })
})
