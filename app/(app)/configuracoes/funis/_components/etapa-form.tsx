'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { SeletorCor } from '@/components/ui/seletor-cor'
import type { EstadoFormEtapa } from '@/lib/actions/etapas'
import type { TipoEtapa } from '@/lib/utils/etapas'

type Props = {
  action: (estado: EstadoFormEtapa | undefined, formData: FormData) => Promise<EstadoFormEtapa>
  valoresIniciais: { nome?: string; cor?: string; posFechamento?: string; participaConversao?: boolean }
  /** Etapa de sistema: o nome aparece, mas não é editável. */
  nomeTravado?: boolean
  /** Só na criação: zona não pode ser trocada depois nesta fase. */
  mostrarZona?: boolean
  /** Tipo real da etapa (sempre 'aberta' na criação — este form nunca cria ganha/perdida). */
  tipo?: TipoEtapa
  /**
   * Só na EDIÇÃO: zona real da etapa (fixa, nunca muda depois da criação —
   * `editarEtapaSchema` nem aceita este campo). Prop PRÓPRIA, nunca lida de
   * `valoresIniciais`/`valores`: estes só ecoam o que a ACTION devolveu num
   * erro de validação, e `editarEtapaAction` nunca devolve `posFechamento`
   * (o campo não existe no form de edição) — se este dado viesse de
   * `valores`, um erro de cor/nome ao editar uma Recuperação faria o
   * checkbox "esquecer" a zona real e aparecer destravado por engano.
   */
  posFechamentoFixo?: boolean
  rotuloEnviar: string
  cancelarHref: string
}

export function EtapaForm({
  action,
  valoresIniciais,
  nomeTravado = false,
  mostrarZona = false,
  tipo = 'aberta',
  posFechamentoFixo = false,
  rotuloEnviar,
  cancelarHref,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: 'nome' | 'cor' | 'posFechamento') => estado?.campos?.[campo]?.[0]

  // Só usado quando `mostrarZona` (criação): acompanha o radio pra travar o
  // checkbox de participação em tempo real quando "Recuperação" é escolhida
  // — sem isto, o formulário mostraria o checkbox editável com um valor que
  // o servidor vai normalizar pra false de qualquer jeito (ver criarEtapa()).
  const [zonaEscolhida, setZonaEscolhida] = useState(valoresIniciais.posFechamento ?? 'pipeline')
  const posFechamentoAtual = mostrarZona ? zonaEscolhida === 'recuperacao' : posFechamentoFixo

  return (
    <form action={formAction} noValidate className="space-y-6">
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

      <div className="max-w-sm">
        <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
          Nome
        </label>
        <input
          id="nome"
          // Campo desabilitado não é enviado: em etapa de sistema o nome não muda.
          name={nomeTravado ? undefined : 'nome'}
          defaultValue={valores.nome}
          disabled={nomeTravado}
          maxLength={60}
          aria-invalid={erro('nome') ? true : undefined}
          aria-describedby={nomeTravado ? 'nome-ajuda' : undefined}
          className={`${inputClass} disabled:bg-zinc-50 disabled:text-zinc-500 dark:disabled:bg-zinc-900`}
        />
        {nomeTravado && (
          <p id="nome-ajuda" className="mt-1 text-xs text-zinc-500">
            Etapas padrão do funil mantêm o nome e a posição; só a cor pode mudar.
          </p>
        )}
        <ErroCampo mensagem={erro('nome')} />
      </div>

      <SeletorCor name="cor" legenda="Cor" valorInicial={valores.cor} erro={erro('cor')} />

      {mostrarZona && (
        <fieldset className="max-w-sm">
          <legend className="mb-1.5 block text-sm font-medium">Zona</legend>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="posFechamento"
                value="pipeline"
                defaultChecked={(valores.posFechamento ?? 'pipeline') === 'pipeline'}
                onChange={() => setZonaEscolhida('pipeline')}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Fluxo comercial</span>
                <span className="block text-xs text-zinc-500">Entra antes de Fechado/Perdido.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="posFechamento"
                value="recuperacao"
                defaultChecked={valores.posFechamento === 'recuperacao'}
                onChange={() => setZonaEscolhida('recuperacao')}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Recuperação pós-perda</span>
                <span className="block text-xs text-zinc-500">
                  Entra depois de Fechado/Perdido, num fluxo à parte — não conta no funil comercial normal.
                </span>
              </span>
            </label>
          </div>
          <ErroCampo mensagem={erro('posFechamento')} />
        </fieldset>
      )}

      <ParticipaConversaoCampo tipo={tipo} posFechamento={posFechamentoAtual} participaConversao={valores.participaConversao} />

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        <Link
          href={cancelarHref}
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}

/**
 * "Participa do funil de conversão" — editável SÓ pra etapa aberta, não
 * pós-fechamento (pipeline normal): é a única combinação sem regra fixa
 * (ganha sempre true, perdida e recuperação sempre false — normalizado de
 * novo no servidor, `criarEtapa`/`editarEtapa`, nunca só aqui). Travado
 * (disabled) não é enviado no FormData de jeito nenhum — por isso o
 * servidor sempre recalcula o valor final a partir do tipo/zona reais,
 * nunca confia só no que chegaria (ou não) por um campo desabilitado.
 */
function ParticipaConversaoCampo({
  tipo,
  posFechamento,
  participaConversao,
}: {
  tipo: TipoEtapa
  posFechamento: boolean
  participaConversao?: boolean
}) {
  const editavel = tipo === 'aberta' && !posFechamento
  const valorAtual = editavel ? (participaConversao ?? true) : tipo === 'ganha'
  const explicacao = editavel
    ? null
    : tipo === 'ganha'
      ? 'Etapa de fechamento (ganha): sempre participa do funil de conversão.'
      : tipo === 'perdida'
        ? 'Etapa de perda: nunca participa do funil de conversão.'
        : 'Etapa de recuperação pós-fechamento: nunca participa do funil de conversão.'

  return (
    <fieldset className="max-w-sm">
      <label className="flex items-start gap-2 text-sm">
        <input
          // `key` força remontar (e reaplicar `defaultChecked`) quando
          // `editavel` muda em tempo real (troca de zona na criação) — sem
          // isto, desmarcar/travar não atualizaria visualmente um checkbox
          // que o usuário tinha marcado antes de escolher "Recuperação".
          key={editavel ? 'editavel' : 'travado'}
          type="checkbox"
          name="participaConversao"
          defaultChecked={valorAtual}
          disabled={!editavel}
          className="mt-1 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span>
          <span className="block font-medium">Participa do funil de conversão</span>
          <span className="block text-xs text-zinc-500">
            Quando desmarcada, a etapa aparece como estado lateral e não participa das taxas, oportunidades,
            pipeline ou cards parados.
          </span>
          {explicacao && <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">{explicacao}</span>}
        </span>
      </label>
    </fieldset>
  )
}
