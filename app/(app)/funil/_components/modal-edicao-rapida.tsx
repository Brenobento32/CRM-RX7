'use client'

import { startTransition, useActionState, useEffect, useState } from 'react'

import { botaoPrimarioClass, opcaoClass, caixaAlertaClass } from '@/components/ui/estilos'
import {
  atualizarFechamentoRapidoAction,
  obterNegociacaoEdicaoAction,
  salvarEMoverNegociacaoAction,
  salvarNegociacaoRapidaAction,
  type EstadoEdicaoRapidaFechamento,
  type EstadoSalvarEMover,
} from '@/lib/actions/negociacoes'
import type { CardFunil } from '@/lib/dal/funil'
import type { FechamentoEdicao, NegociacaoEdicao } from '@/lib/dal/negociacoes'
import type { Servico } from '@/lib/dal/servicos'
import { CampoTipoVenda, CamposComplementaresFechamento, ROTULOS_CAMPOS_FECHAMENTO, valoresIniciaisFechamento } from '@/components/funil/campos-fechamento'
import { ResumoErros } from '@/components/ui/resumo-erros'
import { formatarDia, formatarMoeda, hojeSaoPaulo } from '@/lib/utils/formatacao'
import {
  CAMPO_FORMULARIO,
  CAMPOS_ETAPA,
  ROTULO_CAMPO_ETAPA,
  camposObrigatorios,
  camposVisiveis,
  descreverRequisitos,
  type CampoEtapa,
  type RegraEtapa,
  type RegrasEtapas,
  type RequisitosEtapa,
} from '@/lib/utils/regras-etapas'
import type { RegrasFechamento } from '@/lib/validations/funil'
import {
  FORMAS_PAGAMENTO,
  ROTULO_FORMA_PAGAMENTO,
  ROTULO_TEMPERATURA,
  TEMPERATURAS,
  type CampoEdicaoNegociacao,
} from '@/lib/validations/negociacao'

import { BotoesModal, ErroCampo, ErroGeral, inputClass, Modal } from './modal'

/** Mesma frase de `NEGOCIACAO_ENCERRADA` em lib/dal/negociacoes.ts — esse arquivo é server-only, não dá pra importar valores dele aqui. */
const NEGOCIACAO_ENCERRADA_MSG = 'Negociação encerrada: dados comerciais não podem ser alterados.'

/** Nomes no aviso perto do botão (sem o "· obrigatório nesta etapa" do rótulo). */
const ROTULOS_RESUMO: Record<string, string> = {
  ...Object.fromEntries(CAMPOS_ETAPA.map((c) => [CAMPO_FORMULARIO[c], ROTULO_CAMPO_ETAPA[c]])),
  checklist: 'Confirmações',
}

function valorParaCampo(valor: number | null): string {
  return valor === null ? '' : valor.toFixed(2).replace('.', ',')
}

type Props = {
  card: CardFunil
  /** Catálogo ativo; os desativados que já estão nesta negociação entram depois de carregar os dados. */
  servicosAtivos: Servico[]
  /** Regras comerciais da empresa (tipos de venda e itens do fechamento). */
  regras: RegrasFechamento
  /** Exigências por etapa: campos "Não usar" ficam fora do formulário (o valor gravado fica). */
  regrasEtapas: RegrasEtapas
  /**
   * Movimento recusado pelas exigências da etapa de destino: o formulário
   * pede o que falta e "Salvar e mover" grava tudo numa transação só.
   */
  destino?: { posicao: number; requisitos: RequisitosEtapa }
  onCancelar: () => void
  onConcluido: () => void
}

/**
 * Edição rápida do lápis: busca a negociação ao abrir e mostra o formulário
 * certo pra etapa dela, sem sair do Kanban — mesmo padrão de `ModalFechamento`
 * e `ModalPerda`, mas com um fetch antes do formulário aparecer.
 */
export function ModalEdicaoRapida({ card, servicosAtivos, regras, regrasEtapas, destino, onCancelar, onConcluido }: Props) {
  const [dados, setDados] = useState<NegociacaoEdicao | null>(null)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    startTransition(async () => {
      const resultado = await obterNegociacaoEdicaoAction(card.id)
      if (resultado) setDados(resultado)
      else setErroCarregar('Não foi possível carregar a negociação.')
      setCarregando(false)
    })
  }, [card.id])

  const titulo = destino
    ? `Para mover para "${destino.requisitos.etapaNome}"`
    : dados?.etapa.tipo === 'ganha'
      ? 'Editar fechamento'
      : dados?.etapa.tipo === 'perdida'
        ? 'Negociação'
        : 'Editar negociação'

  const descricao = (
    <>
      {card.clienteNome}
      {card.clienteEmpresa && ` · ${card.clienteEmpresa}`}
    </>
  )

  const servicos = dados
    ? [...servicosAtivos, ...dados.servicos.filter((s) => !servicosAtivos.some((a) => a.id === s.id))].sort(
        (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
      )
    : servicosAtivos

  return (
    <Modal titulo={titulo} descricao={descricao} onCancelar={onCancelar}>
      {carregando && <p className="text-sm text-premium-mudo">Carregando…</p>}

      {erroCarregar && (
        <div className="space-y-5">
          <ErroGeral mensagem={erroCarregar} />
          <div className="flex justify-end border-t border-premium-borda pt-5">
            <BotaoFechar onClick={onCancelar} />
          </div>
        </div>
      )}

      {dados && dados.etapa.tipo === 'aberta' && (
        <FormularioAberta
          dados={dados}
          servicos={servicos}
          regraAtual={regrasEtapas[dados.etapaId]}
          regraDestino={destino ? regrasEtapas[destino.requisitos.etapaId] : undefined}
          destino={destino}
          onCancelar={onCancelar}
          onConcluido={onConcluido}
        />
      )}

      {dados && destino && dados.etapa.tipo !== 'aberta' && (
        <div className="space-y-5">
          <ErroGeral
            mensagem={`${descreverRequisitos(destino.requisitos)} A negociação está encerrada e os dados comerciais não mudam aqui: reabra numa etapa sem exigências, preencha e depois mova.`}
          />
          <div className="flex justify-end border-t border-premium-borda pt-5">
            <BotaoFechar onClick={onCancelar} />
          </div>
        </div>
      )}

      {dados && !destino && dados.etapa.tipo === 'ganha' && dados.fechamento && (
        <FormularioFechamento
          dados={dados}
          fechamento={dados.fechamento}
          servicos={servicos}
          regras={regras}
          onCancelar={onCancelar}
          onConcluido={onConcluido}
        />
      )}

      {dados && !destino && dados.etapa.tipo === 'perdida' && <ResumoSomenteLeitura dados={dados} onFechar={onCancelar} />}
    </Modal>
  )
}

function BotaoFechar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={botaoPrimarioClass}
    >
      Fechar
    </button>
  )
}

/**
 * Etapa aberta: qualificação, proposta e serviços — mesmos campos de `NegociacaoForm`, sem navegar.
 * Com `destino`, é o formulário das exigências da etapa para onde o card foi
 * arrastado: mostra os campos conforme a regra do destino, marca os
 * obrigatórios, pede o checklist e "Salvar e mover" grava tudo de uma vez.
 * Campos "Não usar" não aparecem; o valor gravado deles fica.
 */
function FormularioAberta({
  dados,
  servicos,
  regraAtual,
  regraDestino,
  destino,
  onCancelar,
  onConcluido,
}: {
  dados: NegociacaoEdicao
  servicos: Servico[]
  regraAtual?: RegraEtapa
  regraDestino?: RegraEtapa
  destino?: { posicao: number; requisitos: RequisitosEtapa }
  onCancelar: () => void
  onConcluido: () => void
}) {
  // Ao abrir pelo movimento recusado, os campos que faltam já aparecem em vermelho.
  const inicial: EstadoSalvarEMover | undefined = destino
    ? {
        erro: descreverRequisitos(destino.requisitos),
        campos: Object.fromEntries([
          ...destino.requisitos.campos.map((c) => [CAMPO_FORMULARIO[c], ['Obrigatório para entrar nesta etapa.']]),
          ...(destino.requisitos.checklist.length > 0 ? [['checklist', ['Confirme todos os itens para entrar nesta etapa.']]] : []),
        ]),
      }
    : undefined

  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoSalvarEMover | undefined, formData: FormData): Promise<EstadoSalvarEMover> => {
      const resultado = destino
        ? await salvarEMoverNegociacaoAction(dados.id, { etapaId: destino.requisitos.etapaId, posicao: destino.posicao }, anterior, formData)
        : await salvarNegociacaoRapidaAction(dados.id, anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    inicial,
  )

  const valores = estado?.valores
  const erro = (campo: CampoEdicaoNegociacao) => estado?.campos?.[campo]?.[0]
  const marcados = new Set(valores?.servico_ids ?? dados.servicos.map((s) => s.id))
  const visiveis = camposVisiveis(regraAtual, destino ? regraDestino : undefined)
  const obrigatorios = new Set(destino ? camposObrigatorios(regraDestino) : [])
  const usa = (c: CampoEtapa) => visiveis.has(c)
  const rotulo = (c: CampoEtapa, texto: string) => (
    <>
      {texto}
      {obrigatorios.has(c) && <span className="ml-1 text-xs font-normal text-red-700 dark:text-red-400">· obrigatório nesta etapa</span>}
    </>
  )
  // Itens a confirmar: os que o banco disse que faltam (os já confirmados numa entrada anterior não voltam).
  const itens = destino?.requisitos.checklist ?? []
  const confirmados = new Set(estado?.confirmados ?? [])
  const primeiro = CAMPOS_ETAPA.find((c) => usa(c) && c !== 'servicos')

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(() => action(formData))
      }}
    >
      {!destino && <ErroGeral mensagem={estado?.erro} />}
      {destino && (
        <p role="note" className={caixaAlertaClass}>
          O card só entra em &quot;{destino.requisitos.etapaNome}&quot; com estes dados. Preencha e clique em Salvar e mover; se cancelar,
          ele volta para onde estava e nada é gravado.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {usa('valor_estimado') && (
          <div>
            <label htmlFor="valor_estimado" className="mb-1.5 block text-sm font-medium">
              {rotulo('valor_estimado', 'Valor estimado (R$)')}
            </label>
            <input
              id="valor_estimado"
              name="valor_estimado"
              inputMode="decimal"
              placeholder="15.000,00"
              defaultValue={valores?.valor_estimado ?? valorParaCampo(dados.valorEstimado)}
              aria-invalid={erro('valor_estimado') ? true : undefined}
              aria-required={obrigatorios.has('valor_estimado') || undefined}
              aria-describedby="valor_estimado-erro"
              className={inputClass}
              autoFocus={primeiro === 'valor_estimado'}
            />
            <ErroCampo id="valor_estimado-erro" mensagem={erro('valor_estimado')} />
          </div>
        )}

        {usa('temperatura') && (
          <div>
            <label htmlFor="temperatura" className="mb-1.5 block text-sm font-medium">
              {rotulo('temperatura', 'Temperatura')}
            </label>
            <select
              id="temperatura"
              name="temperatura"
              defaultValue={valores?.temperatura ?? dados.temperatura ?? ''}
              aria-invalid={erro('temperatura') ? true : undefined}
              aria-required={obrigatorios.has('temperatura') || undefined}
              aria-describedby="temperatura-erro"
              className={inputClass}
              autoFocus={primeiro === 'temperatura'}
            >
              <option value="">Não avaliada</option>
              {TEMPERATURAS.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TEMPERATURA[t]}
                </option>
              ))}
            </select>
            <ErroCampo id="temperatura-erro" mensagem={erro('temperatura')} />
          </div>
        )}

        {usa('data_primeira_reuniao') && (
          <div>
            <label htmlFor="data_primeira_reuniao" className="mb-1.5 block text-sm font-medium">
              {rotulo('data_primeira_reuniao', 'Primeira reunião')}
            </label>
            <input
              id="data_primeira_reuniao"
              name="data_primeira_reuniao"
              type="date"
              defaultValue={valores?.data_primeira_reuniao ?? dados.dataPrimeiraReuniao ?? ''}
              aria-invalid={erro('data_primeira_reuniao') ? true : undefined}
              aria-required={obrigatorios.has('data_primeira_reuniao') || undefined}
              aria-describedby="data_primeira_reuniao-erro"
              className={inputClass}
              autoFocus={primeiro === 'data_primeira_reuniao'}
            />
            <ErroCampo id="data_primeira_reuniao-erro" mensagem={erro('data_primeira_reuniao')} />
          </div>
        )}

        {usa('data_proposta') && (
          <div>
            <label htmlFor="data_proposta" className="mb-1.5 block text-sm font-medium">
              {rotulo('data_proposta', 'Data da proposta')}
            </label>
            <input
              id="data_proposta"
              name="data_proposta"
              type="date"
              defaultValue={valores?.data_proposta ?? dados.dataProposta ?? ''}
              aria-invalid={erro('data_proposta') ? true : undefined}
              aria-required={obrigatorios.has('data_proposta') || undefined}
              aria-describedby="data_proposta-erro"
              className={inputClass}
              autoFocus={primeiro === 'data_proposta'}
            />
            <ErroCampo id="data_proposta-erro" mensagem={erro('data_proposta')} />
          </div>
        )}
      </div>

      {usa('objecao_principal') && (
        <div>
          <label htmlFor="objecao_principal" className="mb-1.5 block text-sm font-medium">
            {rotulo('objecao_principal', 'Objeção principal')}
          </label>
          <textarea
            id="objecao_principal"
            name="objecao_principal"
            rows={2}
            maxLength={2000}
            defaultValue={valores?.objecao_principal ?? dados.objecaoPrincipal ?? ''}
            aria-invalid={erro('objecao_principal') ? true : undefined}
            aria-required={obrigatorios.has('objecao_principal') || undefined}
            aria-describedby="objecao_principal-erro"
            className={inputClass}
            autoFocus={primeiro === 'objecao_principal'}
          />
          <ErroCampo id="objecao_principal-erro" mensagem={erro('objecao_principal')} />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {usa('valor_proposta') && (
          <div>
            <label htmlFor="valor_proposta" className="mb-1.5 block text-sm font-medium">
              {rotulo('valor_proposta', 'Valor da proposta (R$)')}
            </label>
            <input
              id="valor_proposta"
              name="valor_proposta"
              inputMode="decimal"
              placeholder="12.000,00"
              defaultValue={valores?.valor_proposta ?? valorParaCampo(dados.valorProposta)}
              aria-invalid={erro('valor_proposta') ? true : undefined}
              aria-required={obrigatorios.has('valor_proposta') || undefined}
              aria-describedby="valor_proposta-erro"
              className={inputClass}
              autoFocus={primeiro === 'valor_proposta'}
            />
            <ErroCampo id="valor_proposta-erro" mensagem={erro('valor_proposta')} />
          </div>
        )}

        {usa('forma_pagamento') && (
          <div>
            <label htmlFor="forma_pagamento" className="mb-1.5 block text-sm font-medium">
              {rotulo('forma_pagamento', 'Forma de pagamento')}
            </label>
            <select
              id="forma_pagamento"
              name="forma_pagamento"
              defaultValue={valores?.forma_pagamento ?? dados.formaPagamento ?? ''}
              aria-invalid={erro('forma_pagamento') ? true : undefined}
              aria-required={obrigatorios.has('forma_pagamento') || undefined}
              aria-describedby="forma_pagamento-erro"
              className={inputClass}
              autoFocus={primeiro === 'forma_pagamento'}
            >
              <option value="">Não definida</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FORMA_PAGAMENTO[f]}
                </option>
              ))}
            </select>
            <ErroCampo id="forma_pagamento-erro" mensagem={erro('forma_pagamento')} />
          </div>
        )}
      </div>

      {usa('servicos') && (
        <ListaServicos
          servicos={servicos}
          marcados={marcados}
          erro={erro('servico_ids')}
          legenda={obrigatorios.has('servicos') ? 'Serviços · obrigatório nesta etapa' : 'Serviços'}
        />
      )}

      {itens.length > 0 && (
        <fieldset id="checklist" aria-describedby="checklist-erro" className="space-y-2">
          <legend className="mb-1.5 block text-sm font-medium">Confirmações para entrar nesta etapa</legend>
          {itens.map((i) => (
            <label key={i.id} className={opcaoClass}>
              <input
                type="checkbox"
                name="confirmacao"
                value={i.id}
                defaultChecked={confirmados.has(i.id)}
                className="size-4 accent-zinc-900 dark:accent-zinc-100"
              />
              <span className="flex-1">{i.texto}</span>
            </label>
          ))}
          <ErroCampo id="checklist-erro" mensagem={estado?.campos?.checklist?.[0]} />
        </fieldset>
      )}

      <BotoesModal
        pendente={pendente}
        rotulo={destino ? 'Salvar e mover' : 'Salvar'}
        onCancelar={onCancelar}
        resumo={<ResumoErros campos={estado?.campos} rotulos={ROTULOS_RESUMO} erro={estado?.erro} />}
      />
    </form>
  )
}

/** Etapa ganha: mesmos campos de `EditarFechamentoForm`, sem navegar. */
function FormularioFechamento({
  dados,
  fechamento,
  servicos,
  regras,
  onCancelar,
  onConcluido,
}: {
  dados: NegociacaoEdicao
  fechamento: FechamentoEdicao
  servicos: Servico[]
  regras: RegrasFechamento
  onCancelar: () => void
  onConcluido: () => void
}) {
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoEdicaoRapidaFechamento | undefined, formData: FormData) => {
      const resultado = await atualizarFechamentoRapidoAction(dados.id, anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    undefined,
  )

  const valores = estado?.valores
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]
  const hoje = hojeSaoPaulo()

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(() => action(formData))
      }}
    >
      <ErroGeral mensagem={estado?.erro} />

      <div className="grid gap-5 sm:grid-cols-2">
        <CampoTipoVenda regras={regras} modo="edicao" tipoAtual={fechamento.tipoVenda} valor={valores?.tipo_venda} erro={erro('tipo_venda')} />

        <div>
          <label htmlFor="valor_vendido" className="mb-1.5 block text-sm font-medium">
            Valor vendido (R$)
          </label>
          <input
            id="valor_vendido"
            name="valor_vendido"
            inputMode="decimal"
            defaultValue={
              valores?.valor_vendido ??
              fechamento.valorVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
            }
            aria-invalid={erro('valor_vendido') ? true : undefined}
            aria-describedby="valor_vendido-erro"
            className={inputClass}
            autoFocus
          />
          <ErroCampo id="valor_vendido-erro" mensagem={erro('valor_vendido')} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="data_fechamento" className="mb-1.5 block text-sm font-medium">
            Data de fechamento
          </label>
          <input
            id="data_fechamento"
            name="data_fechamento"
            type="date"
            max={hoje}
            defaultValue={valores?.data_fechamento ?? fechamento.dataFechamento}
            aria-invalid={erro('data_fechamento') ? true : undefined}
            aria-describedby="data_fechamento-erro"
            className={inputClass}
          />
          <ErroCampo id="data_fechamento-erro" mensagem={erro('data_fechamento')} />
        </div>
      </div>

      <CamposComplementaresFechamento
        regras={regras}
        valores={valoresIniciaisFechamento(fechamento, valores)}
        servicos={servicos}
        servicoIdsAtuais={dados.servicos.map((s) => s.id)}
        erro={erro}
      />

      <BotoesModal
        pendente={pendente}
        rotulo="Salvar"
        onCancelar={onCancelar}
        resumo={<ResumoErros campos={estado?.campos} rotulos={ROTULOS_CAMPOS_FECHAMENTO} erro={estado?.erro} />}
      />
    </form>
  )
}

/** Etapa perdida: o banco recusa qualquer alteração comercial — só leitura, igual à página /negociacoes/[id]/editar. */
function ResumoSomenteLeitura({ dados, onFechar }: { dados: NegociacaoEdicao; onFechar: () => void }) {
  const moeda = (v: number | null) => (v === null ? null : formatarMoeda(v))
  const dia = (d: string | null) => (d === null ? null : formatarDia(d))

  const itens: [string, React.ReactNode][] = [
    ['Valor estimado', moeda(dados.valorEstimado)],
    ['Temperatura', dados.temperatura && ROTULO_TEMPERATURA[dados.temperatura]],
    ['Primeira reunião', dia(dados.dataPrimeiraReuniao)],
    ['Data da proposta', dia(dados.dataProposta)],
    ['Valor da proposta', moeda(dados.valorProposta)],
    ['Forma de pagamento', dados.formaPagamento && ROTULO_FORMA_PAGAMENTO[dados.formaPagamento]],
  ]

  return (
    <div className="space-y-5">
      <p
        role="note"
        className={caixaAlertaClass}
      >
        {NEGOCIACAO_ENCERRADA_MSG}
      </p>
      <dl className="grid gap-4 sm:grid-cols-2">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo}>
            <dt className="text-sm text-premium-mudo">{rotulo}</dt>
            <dd className="mt-0.5 text-sm">{valor || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end border-t border-premium-borda pt-5">
        <BotaoFechar onClick={onFechar} />
      </div>
    </div>
  )
}

function ListaServicos({
  servicos,
  marcados,
  erro,
  legenda = 'Serviços',
}: {
  servicos: Servico[]
  marcados: Set<string>
  erro?: string
  legenda?: string
}) {
  return (
    <fieldset aria-describedby={erro ? 'servicos-erro' : undefined}>
      <legend className="mb-1.5 block text-sm font-medium">{legenda}</legend>
      {servicos.length === 0 ? (
        <p className="text-sm text-premium-mudo">Nenhum serviço cadastrado. O administrador cadastra em Configurações → Serviços.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {servicos.map((s) => (
            <label
              key={s.id}
              className={opcaoClass}
            >
              <input
                type="checkbox"
                name="servico_ids"
                value={s.id}
                defaultChecked={marcados.has(s.id)}
                className="size-4 accent-zinc-900 dark:accent-zinc-100"
              />
              <span className="flex-1">{s.nome}</span>
              {!s.ativo && (
                <span className="rounded bg-premium-bg px-1.5 py-0.5 text-xs text-premium-secundario">
                  desativado
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      <ErroCampo id="servicos-erro" mensagem={erro} />
    </fieldset>
  )
}

