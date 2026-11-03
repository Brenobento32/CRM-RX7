'use client'

import { useState } from 'react'

import { botaoPrimarioClass, botaoSecundarioClass, cartaoClass, inputClass, labelClass, legendaClass } from '@/components/ui/estilos'
import { definirRegrasComerciaisAction } from '@/lib/actions/super-admin'
import {
  CAMPOS_COM_CONFIRMACAO,
  CAMPOS_FECHAMENTO,
  PADRAO_POR_PERFIL,
  REGRAS_CAMPO,
  ROTULO_CAMPO_FECHAMENTO,
  ROTULO_PERFIL,
  ROTULO_REGRA_CAMPO,
  TIPOS_VENDA_REGRAS,
  type CampoFechamento,
  type PerfilComercial,
  type RegraCampo,
  type RegrasComerciais,
  type TipoVendaRegra,
} from '@/lib/utils/regras-comerciais'

const ROTULO_TIPO: Record<TipoVendaRegra, { nome: string; ajuda: string }> = {
  tcv: { nome: 'TCV', ajuda: 'Valor total de contratos' },
  mrr: { nome: 'MRR', ajuda: 'Receita recorrente mensal' },
  venda: { nome: 'Venda comum', ajuda: 'Vendas pontuais: faturamento e quantidade' },
}

/**
 * Regras comerciais desta empresa: o que o Administrador dela vê e é obrigado
 * a preencher. O banco confere tudo de novo e registra na auditoria.
 */
export function RegrasComerciaisEmpresa({
  tenantId,
  regras,
  uso,
}: {
  tenantId: string
  regras: RegrasComerciais
  uso: { fechamentos: Record<string, number>; metas: Record<string, number> }
}) {
  const [perfil, setPerfil] = useState<PerfilComercial>(regras.perfil)
  const [tipos, setTipos] = useState<TipoVendaRegra[]>(regras.tiposVenda)
  const [campos, setCampos] = useState<Record<CampoFechamento, RegraCampo>>(regras.campos)

  function aplicarPadrao() {
    setTipos([...PADRAO_POR_PERFIL[perfil].tiposVenda])
    setCampos({ ...PADRAO_POR_PERFIL[perfil].campos })
  }

  const usoTexto = (tipo: TipoVendaRegra) => {
    const f = uso.fechamentos[tipo] ?? 0
    const m = uso.metas[tipo] ?? 0
    return f || m ? `${f} fechamento(s) e ${m} meta(s) já cadastrados — continuam guardados e visíveis.` : ROTULO_TIPO[tipo].ajuda
  }

  return (
    <form id="regras-comerciais" action={definirRegrasComerciaisAction} className={`${cartaoClass} space-y-5 p-5`}>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div>
        <h2 className={legendaClass}>Regras comerciais da empresa</h2>
        <p className="mt-0.5 text-xs text-premium-mudo">
          {regras.configurado ? 'Configuradas para esta empresa.' : 'Ainda no padrão genérico (nada foi configurado).'} O Administrador da empresa só usa o que
          estiver liberado aqui; nada que já foi cadastrado é apagado ao mudar.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={labelClass}>Perfil</span>
          <select name="perfil" value={perfil} onChange={(e) => setPerfil(e.target.value as PerfilComercial)} className={inputClass}>
            {(Object.keys(ROTULO_PERFIL) as PerfilComercial[]).map((p) => (
              <option key={p} value={p}>
                {ROTULO_PERFIL[p]}
              </option>
            ))}
          </select>
          <button type="button" onClick={aplicarPadrao} className={`${botaoSecundarioClass} mt-2`}>
            Aplicar os padrões deste perfil
          </button>
        </label>
        <fieldset className="text-sm">
          <legend className={labelClass}>Menu Metas</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name="metas_ativo" value="sim" defaultChecked={regras.metasAtivo} /> Ativado
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="metas_ativo" value="nao" defaultChecked={!regras.metasAtivo} /> Desativado (oculto no CRM)
            </label>
          </div>
        </fieldset>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className={labelClass}>Tipos de venda e de meta liberados</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TIPOS_VENDA_REGRAS.map((t) => (
            <label key={t} className="flex items-start gap-2 rounded-md border border-premium-borda p-3">
              <input
                type="checkbox"
                name="tipos_venda"
                value={t}
                checked={tipos.includes(t)}
                onChange={(e) => setTipos((atual) => (e.target.checked ? [...atual, t] : atual.filter((x) => x !== t)))}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{ROTULO_TIPO[t].nome}</span>
                <span className="block text-xs text-premium-mudo">{usoTexto(t)}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-premium-mudo">Cada venda conta só no seu tipo: TCV, MRR e Venda comum nunca se somam.</p>
      </fieldset>

      <fieldset className="space-y-2 text-sm">
        <legend className={labelClass}>Ao fechar (finalizar) uma negociação</legend>
        <p className="text-xs text-premium-mudo">Tipo, valor e data da venda são sempre pedidos. Os demais itens seguem a regra abaixo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAMPOS_FECHAMENTO.map((c) => (
            <label key={c} className="block">
              <span className="mb-1 block text-xs text-premium-secundario">{ROTULO_CAMPO_FECHAMENTO[c]}</span>
              <select
                name={`campo_${c}`}
                value={campos[c]}
                onChange={(e) => setCampos((atual) => ({ ...atual, [c]: e.target.value as RegraCampo }))}
                className={inputClass}
              >
                {REGRAS_CAMPO.filter((r) => r !== 'confirmar' || CAMPOS_COM_CONFIRMACAO.includes(c)).map((r) => (
                  <option key={r} value={r}>
                    {ROTULO_REGRA_CAMPO[r]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm">
        <span className={labelClass}>Motivo (fica na auditoria)</span>
        <input name="motivo" required minLength={3} maxLength={500} className={inputClass} placeholder="Ex.: cliente de varejo, não usa contrato" />
      </label>
      <button type="submit" className={botaoPrimarioClass}>
        Salvar regras comerciais
      </button>
    </form>
  )
}
