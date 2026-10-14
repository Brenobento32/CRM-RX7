import type { ItemPermissao, PermissaoColaboradorLinha } from '@/lib/dal/permissoes'

export type FunilOpcao = { id: string; nome: string }

export type EstadoEtapa = { podeVer: boolean; podeMover: boolean }
export type EstadoFunil = { acesso: boolean; etapas: Record<string, EstadoEtapa> }
export type Estado = Record<string, EstadoFunil>

export function estadoInicial(funis: FunilOpcao[], permissoesAtuais: PermissaoColaboradorLinha[]): Estado {
  const estado: Estado = {}
  for (const f of funis) estado[f.id] = { acesso: false, etapas: {} }

  for (const p of permissoesAtuais) {
    const funil = estado[p.funilId]
    if (!funil) continue // permissão de um funil que não existe mais (excluído) — ignorada na tela

    if (p.etapaId === null) {
      funil.acesso = true
    } else {
      funil.etapas[p.etapaId] = { podeVer: p.podeVer === true, podeMover: p.podeMover === true }
    }
  }

  return estado
}

export function paraItens(estado: Estado): ItemPermissao[] {
  const itens: ItemPermissao[] = []

  for (const [funilId, funil] of Object.entries(estado)) {
    if (!funil.acesso) continue // funil desmarcado: nenhuma linha dele entra, nem as etapas marcadas antes

    itens.push({ funilId, etapaId: null, podeVer: null, podeMover: null })

    for (const [etapaId, { podeVer, podeMover }] of Object.entries(funil.etapas)) {
      if (podeVer || podeMover) {
        itens.push({ funilId, etapaId, podeVer, podeMover })
      }
    }
  }

  return itens
}
