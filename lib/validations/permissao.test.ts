import { describe, expect, it } from 'vitest'

import { itemPermissaoSchema, permissoesColaboradorSchema } from '@/lib/validations/permissao'

const FUNIL_ID = '11111111-1111-1111-8111-111111111111'
const ETAPA_ID = '22222222-2222-2222-8222-222222222222'

describe('itemPermissaoSchema', () => {
  it('aceita uma linha de acesso ao funil (os três campos null)', () => {
    expect(itemPermissaoSchema.safeParse({ funilId: FUNIL_ID, etapaId: null, podeVer: null, podeMover: null }).success).toBe(
      true,
    )
  })

  it('4/5. aceita uma linha de etapa com os quatro campos preenchidos', () => {
    expect(
      itemPermissaoSchema.safeParse({ funilId: FUNIL_ID, etapaId: ETAPA_ID, podeVer: true, podeMover: false }).success,
    ).toBe(true)
  })

  it('6. rejeita pode_mover=true sem pode_ver=true — mesma regra da constraint no banco', () => {
    const resultado = itemPermissaoSchema.safeParse({
      funilId: FUNIL_ID,
      etapaId: ETAPA_ID,
      podeVer: false,
      podeMover: true,
    })
    expect(resultado.success).toBe(false)
  })

  it('rejeita mistura: etapaId preenchido com podeVer null (forma inconsistente)', () => {
    const resultado = itemPermissaoSchema.safeParse({
      funilId: FUNIL_ID,
      etapaId: ETAPA_ID,
      podeVer: null,
      podeMover: null,
    })
    expect(resultado.success).toBe(false)
  })

  it('rejeita mistura inversa: etapaId null com podeVer preenchido', () => {
    const resultado = itemPermissaoSchema.safeParse({
      funilId: FUNIL_ID,
      etapaId: null,
      podeVer: true,
      podeMover: false,
    })
    expect(resultado.success).toBe(false)
  })
})

describe('permissoesColaboradorSchema', () => {
  it('aceita lista vazia (remover todas as permissões do colaborador)', () => {
    expect(permissoesColaboradorSchema.safeParse([]).success).toBe(true)
  })

  it('15/16. aceita múltiplas linhas de funis/etapas diferentes', () => {
    const resultado = permissoesColaboradorSchema.safeParse([
      { funilId: FUNIL_ID, etapaId: null, podeVer: null, podeMover: null },
      { funilId: FUNIL_ID, etapaId: ETAPA_ID, podeVer: true, podeMover: true },
    ])
    expect(resultado.success).toBe(true)
  })
})
