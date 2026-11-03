import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
import { REGRAS_ANTERIORES, type RegraCampo, type RegrasComerciais } from '@/lib/utils/regras-comerciais'
import { valorEmReais } from '@/lib/validations/negociacao'

type Enums = Database['public']['Enums']

/**
 * Status oferecidos no fechamento. `atrasado` existe no banco, mas não faz
 * sentido no momento em que o negócio acabou de ser fechado.
 */
export const STATUS_PAGAMENTO_FECHAMENTO = [
  'pendente',
  'parcial',
  'pago',
  'cancelado',
] as const satisfies readonly Enums['status_pagamento'][]

export const ROTULO_STATUS_PAGAMENTO: Record<Enums['status_pagamento'], string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
}

export const STATUS_ONBOARDING = Constants.public.Enums.status_onboarding

/**
 * TCV, MRR ou Venda comum — mesmo enum que classifica uma meta (`lib/validations/meta.ts`
 * reaproveita exatamente esta constante, fonte única). Toda venda NOVA exige
 * um dos dois; vendas antigas ficam "não classificadas" (null), nunca
 * reclassificadas automaticamente.
 */
export const TIPOS_VENDA = Constants.public.Enums.tipo_venda

export const ROTULO_TIPO_VENDA: Record<(typeof TIPOS_VENDA)[number], string> = {
  tcv: 'TCV',
  mrr: 'MRR',
  venda: 'Venda comum',
}

export const ROTULO_STATUS_ONBOARDING: Record<Enums['status_onboarding'], string> = {
  nao_iniciado: 'Não iniciado',
  em_andamento: 'Em andamento',
  concluido: 'Finalizado',
}

const posicao = z.coerce.number('Posição inválida.').refine(Number.isFinite, 'Posição inválida.')

/**
 * Arrastar o card (ou "Mover para"). Nas etapas ganha/perdida só reordena um
 * card que já está lá — entrar nelas exige o modal (ver `fechamentoSchema` /
 * `perdaSchema`). O tipo da etapa é conferido no banco, nunca vem do cliente.
 */
export const moverSchema = z.object({
  id: z.uuid(),
  etapaId: z.uuid('Etapa inválida.'),
  posicao,
  /**
   * Outros cards da coluna de destino com posição nova, quando o Kanban
   * precisou renumerar a coluna por falta de espaço entre os vizinhos.
   */
  reposicionar: z
    .array(z.object({ id: z.uuid(), posicao }))
    .max(1000, 'Coluna grande demais para renumerar.')
    .default([]),
})

/** Regras do fechamento que o formulário e a Server Action seguem (o banco confere de novo). */
export type RegrasFechamento = Pick<RegrasComerciais, 'tiposVenda' | 'campos'>

// Campo oculto para a empresa: pode nem vir no formulário; vira "não se aplica".
const vazioParaNull = z.unknown().optional().transform((): null => null)

/** Sim/Não conforme a regra: oculto (não se aplica), opcional, obrigatório ou "precisa ser Sim". */
function campoSimNao(regra: RegraCampo, rotulo: string) {
  switch (regra) {
    case 'oculto':
      return vazioParaNull
    case 'opcional':
      return z
        .enum(['sim', 'nao', ''], `Informe "${rotulo}".`)
        .default('')
        .transform((v): boolean | null => (v === '' ? null : v === 'sim'))
    case 'confirmar':
      return z
        .enum(['sim', 'nao'], `Informe "${rotulo}".`)
        .refine((v) => v === 'sim', `Confirme "${rotulo}" para finalizar.`)
        .transform((): boolean | null => true)
    default:
      return z.enum(['sim', 'nao'], `Informe "${rotulo}".`).transform((v): boolean | null => v === 'sim')
  }
}

function campoLista<T extends string>(regra: RegraCampo, valores: readonly [T, ...T[]], mensagem: string) {
  if (regra === 'oculto') return z.unknown().optional().transform((): T | null => null)
  if (regra === 'opcional') {
    return z
      .union([z.literal(''), z.enum(valores)], mensagem)
      .default('')
      .transform((v): T | null => (v === '' ? null : (v as T)))
  }
  return z.enum(valores, mensagem).transform((v): T | null => v as T)
}

/** `validar` devolve a mensagem de erro, ou null quando o texto (já aparado, não vazio) serve. */
function campoTexto(regra: RegraCampo, rotulo: string, validar: (v: string) => string | null) {
  if (regra === 'oculto') return z.unknown().optional().transform((): string | null => null)
  return z
    .string()
    .default('')
    .transform((v) => v.trim())
    .superRefine((v, ctx) => {
      if (v === '') {
        if (regra !== 'opcional') ctx.addIssue({ code: 'custom', message: `Preencha "${rotulo}".` })
        return
      }
      const erro = validar(v)
      if (erro) ctx.addIssue({ code: 'custom', message: erro })
    })
    .transform((v): string | null => (v === '' ? null : v))
}

const validarLink = (v: string) => (/^https?:\/\/\S+$/i.test(v) && URL.canParse(v) ? null : 'Link inválido. Use um endereço http:// ou https://.')
const validarObservacoes = (v: string) => (v.length > 2000 ? 'Máximo de 2000 caracteres.' : null)

type TipoVenda = (typeof TIPOS_VENDA)[number]

function rotuloTipos(tipos: readonly TipoVenda[]) {
  return tipos.map((t) => ROTULO_TIPO_VENDA[t]).join(', ')
}

/**
 * Campos do fechamento montados pelas regras da empresa (Super Admin): tipo
 * de venda só entre os liberados; itens de agência ocultos, opcionais,
 * obrigatórios ou "precisa ser Sim".
 */
function camposFechamento(regras: RegrasFechamento, edicao: boolean) {
  const c = regras.campos
  const liberados = TIPOS_VENDA.filter((t) => (regras.tiposVenda as readonly string[]).includes(t))
  const tipos = (liberados.length > 0 ? liberados : [...TIPOS_VENDA]) as [TipoVenda, ...TipoVenda[]]
  const mensagemTipo = `Selecione o tipo da venda (${rotuloTipos(tipos)}).`
  return {
    negociacao_id: z.uuid(),
    /**
     * Fechamento NOVO: tipo obrigatório, só entre os liberados (o banco também recusa).
     * Edição: "" (não mexer) vira null, que a RPC preserva — nunca reclassifica sozinho.
     */
    tipo_venda: edicao
      ? z
          .string()
          .default('')
          .transform((v) => (v === '' ? null : v))
          .pipe(z.enum(tipos, mensagemTipo).nullable())
      : z.enum(tipos, mensagemTipo).transform((v): TipoVenda | null => v),
    valor_vendido: valorEmReais.pipe(
      z
        .string('Informe o valor vendido.')
        .refine((v) => Number(v) > 0, 'O valor vendido deve ser maior que zero.'),
    ),
    data_fechamento: z
      .iso.date('Informe a data de fechamento.')
      .refine((d) => d <= hojeSaoPaulo(), 'A data de fechamento não pode estar no futuro.'),
    contrato_enviado: campoSimNao(c.contrato_enviado, 'Contrato enviado'),
    contrato_assinado: campoSimNao(c.contrato_assinado, 'Contrato assinado'),
    link_contrato: campoTexto(c.link_contrato, 'Link do contrato', validarLink),
    status_pagamento: campoLista(c.status_pagamento, STATUS_PAGAMENTO_FECHAMENTO, 'Selecione o status do pagamento.'),
    status_onboarding: campoLista(c.status_onboarding, STATUS_ONBOARDING, 'Selecione o status do onboarding.'),
    /** Conjunto final de serviços contratados — sincroniza negociacao_servicos. */
    servico_ids:
      c.servicos === 'obrigatorio'
        ? z.array(z.uuid()).min(1, 'Escolha ao menos um serviço contratado.')
        : z.array(z.uuid()).default([]),
    observacoes: campoTexto(c.observacoes, 'Observações', validarObservacoes),
  }
}

function exigeEnvioParaAssinatura(f: { contrato_enviado: boolean | null; contrato_assinado: boolean | null }, ctx: z.RefinementCtx) {
  // Espelho da constraint fechamentos_assinatura_exige_envio.
  if (f.contrato_assinado && !f.contrato_enviado) {
    ctx.addIssue({ code: 'custom', path: ['contrato_assinado'], message: 'Contrato assinado precisa ter sido enviado.' })
  }
}

/** Modal de fechamento conforme as regras da empresa. */
export function criarFechamentoSchema(regras: RegrasFechamento) {
  return z.object({ ...camposFechamento(regras, false), posicao }).superRefine(exigeEnvioParaAssinatura)
}

/**
 * Editar um fechamento já existente. Mesmos campos, menos `posicao` (a edição
 * nunca mexe na posição do card) — o banco (`atualizar_fechamento`) também
 * nunca toca `negociacoes` nem `fechado_em`/`fechado_por`; item oculto para a
 * empresa nunca é apagado (gatilho `fechamentos_regras_empresa`).
 */
export function criarAtualizarFechamentoSchema(regras: RegrasFechamento) {
  return z.object(camposFechamento(regras, true)).superRefine(exigeEnvioParaAssinatura)
}

/** Comportamento anterior às regras por empresa (agência: TCV/MRR e todos os itens). */
export const fechamentoSchema = criarFechamentoSchema(REGRAS_ANTERIORES)
export const atualizarFechamentoSchema = criarAtualizarFechamentoSchema(REGRAS_ANTERIORES)

export type FechamentoInput = z.output<ReturnType<typeof criarFechamentoSchema>>
export type AtualizarFechamentoInput = z.output<ReturnType<typeof criarAtualizarFechamentoSchema>>

export const perdaSchema = z.object({
  negociacao_id: z.uuid(),
  posicao,
  motivo_perda: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo da perda.')
    .max(2000, 'Máximo de 2000 caracteres.'),
})

export type PerdaInput = z.output<typeof perdaSchema>

/** Modal "Desqualificar lead" (drawer do Kanban) — motivo obrigatório. */
export const desqualificarSchema = z.object({
  negociacao_id: z.uuid(),
  motivo: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo da desqualificação.')
    .max(2000, 'Máximo de 2000 caracteres.'),
})

export type DesqualificarInput = z.output<typeof desqualificarSchema>

/** Modal "Excluir lead" (tela de Leads, aba Arquivados) — motivo obrigatório. */
export const excluirLeadSchema = z.object({
  negociacao_id: z.uuid(),
  motivo: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo da exclusão.')
    .max(2000, 'Máximo de 2000 caracteres.'),
})

export type ExcluirLeadInput = z.output<typeof excluirLeadSchema>

/** Campo vazio de `<select>` (ex.: "Outros"/"Não avaliada") vira `null`. */
const vazioParaNulo = (v: string) => (v.trim() === '' ? null : v.trim())

export const ORIGENS_NEGOCIACAO = Constants.public.Enums.origem_negociacao

export const ROTULO_ORIGEM: Record<Enums['origem_negociacao'], string> = {
  formulario: 'Formulário',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
}

/**
 * Fonte exata gravada pelas integrações em `negociacoes.atribuicao.fonte`.
 * A CLASSE da origem (`origem_negociacao`) continua como está no banco — o
 * Google Sheets entra como "formulario" (lead que chega por cadastro externo)
 * e isso não é reclassificado; aqui só se mostra o nome certo da fonte.
 */
const ROTULO_FONTE: Record<string, string> = {
  google_sheets: 'Google Sheets',
}

export function rotuloDaOrigem(origem: Enums['origem_negociacao'], atribuicao?: { fonte?: unknown } | null): string {
  const fonte = typeof atribuicao?.fonte === 'string' ? atribuicao.fonte : null
  return (fonte && ROTULO_FONTE[fonte]) || ROTULO_ORIGEM[origem]
}

/**
 * "Dados comerciais" editáveis na ficha do cliente (item 3/4 do refinamento):
 * nicho, temperatura e proposta/valor. Funil, etapa e responsável ficam fora
 * daqui — têm telas próprias (Mover, carteira do cliente). `origem` também
 * fica fora: é fato histórico de como o lead entrou (formulário/WhatsApp/
 * manual), nunca editável depois da criação, nem por gerente (trigger
 * `negociacoes_origem_imutavel`, proposta em
 * `supabase/migrations_propostas/20261015130000_...sql`) — a ficha só
 * mostra, nunca envia esse campo. `valor_estimado`/`temperatura`/`nicho_id`
 * só são aceitos pelo banco em etapa aberta (trigger
 * `negociacoes_encerrada_somente_leitura`); a ficha também desabilita esses
 * campos nesse caso, mas o schema não precisa saber da etapa.
 */
export const dadosComerciaisSchema = z.object({
  negociacao_id: z.uuid(),
  nicho_id: z
    .string()
    .transform(vazioParaNulo)
    .pipe(z.uuid('Nicho inválido.').nullable()),
  temperatura: z
    .string()
    .transform(vazioParaNulo)
    .pipe(z.enum(Constants.public.Enums.temperatura_negociacao, 'Temperatura inválida.').nullable()),
  valor_estimado: valorEmReais,
})

export type DadosComerciaisInput = z.output<typeof dadosComerciaisSchema>
