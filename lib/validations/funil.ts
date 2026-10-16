import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
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
 * TCV ou MRR — mesmo enum que classifica uma meta (`lib/validations/meta.ts`
 * reaproveita exatamente esta constante, fonte única). Toda venda NOVA exige
 * um dos dois; vendas antigas ficam "não classificadas" (null), nunca
 * reclassificadas automaticamente.
 */
export const TIPOS_VENDA = Constants.public.Enums.tipo_venda

export const ROTULO_TIPO_VENDA: Record<(typeof TIPOS_VENDA)[number], string> = {
  tcv: 'TCV',
  mrr: 'MRR',
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

const simNao = (mensagem: string) =>
  z.enum(['sim', 'nao'], mensagem).transform((v) => v === 'sim')

/**
 * Modal de fechamento. Todos os campos são obrigatórios, menos o link do
 * contrato. Os booleanos não têm default: o closer precisa responder.
 */
export const fechamentoSchema = z
  .object({
    negociacao_id: z.uuid(),
    posicao,
    /** Toda venda NOVA exige o tipo — o banco também recusa (trigger em `fechamentos`). */
    tipo_venda: z.enum(TIPOS_VENDA, 'Selecione o tipo da venda (TCV ou MRR).'),
    valor_vendido: valorEmReais.pipe(
      z
        .string('Informe o valor vendido.')
        .refine((v) => Number(v) > 0, 'O valor vendido deve ser maior que zero.'),
    ),
    data_fechamento: z
      .iso.date('Informe a data de fechamento.')
      .refine((d) => d <= hojeSaoPaulo(), 'A data de fechamento não pode estar no futuro.'),
    contrato_enviado: simNao('Informe se o contrato foi enviado.'),
    contrato_assinado: simNao('Informe se o contrato foi assinado.'),
    link_contrato: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .pipe(
        z
          .url({ protocol: /^https?$/, error: 'Link inválido. Use um endereço http:// ou https://.' })
          .nullable(),
      ),
    status_pagamento: z.enum(STATUS_PAGAMENTO_FECHAMENTO, 'Selecione o status do pagamento.'),
    status_onboarding: z.enum(STATUS_ONBOARDING, 'Selecione o status do onboarding.'),
    /** Conjunto final de serviços contratados — sincroniza negociacao_servicos. */
    servico_ids: z.array(z.uuid()).default([]),
    observacoes: z
      .string()
      .trim()
      .max(2000, 'Máximo de 2000 caracteres.')
      .transform((v) => (v === '' ? null : v)),
  })
  .superRefine((f, ctx) => {
    // Espelho da constraint fechamentos_assinatura_exige_envio.
    if (f.contrato_assinado && !f.contrato_enviado) {
      ctx.addIssue({
        code: 'custom',
        path: ['contrato_assinado'],
        message: 'Contrato assinado precisa ter sido enviado.',
      })
    }
  })

export type FechamentoInput = z.output<typeof fechamentoSchema>

/**
 * Editar um fechamento já existente. Mesmos campos de `fechamentoSchema`
 * menos `posicao` (a edição nunca mexe na posição do card no Kanban) — o
 * banco (`atualizar_fechamento`) também nunca toca `negociacoes` nem
 * `fechado_em`/`fechado_por`.
 */
export const atualizarFechamentoSchema = z
  .object({
    negociacao_id: z.uuid(),
    /**
     * Opcional aqui: "" (não mexer no tipo) vira `null`, que a RPC
     * `atualizar_fechamento` interpreta como "preserva o que já estava
     * gravado" — nunca reclassifica um histórico sozinho. Só muda se o
     * gerente escolher ativamente TCV ou MRR.
     */
    tipo_venda: z
      .string()
      .default('')
      .transform((v) => (v === '' ? null : v))
      .pipe(z.enum(TIPOS_VENDA).nullable()),
    valor_vendido: valorEmReais.pipe(
      z
        .string('Informe o valor vendido.')
        .refine((v) => Number(v) > 0, 'O valor vendido deve ser maior que zero.'),
    ),
    data_fechamento: z
      .iso.date('Informe a data de fechamento.')
      .refine((d) => d <= hojeSaoPaulo(), 'A data de fechamento não pode estar no futuro.'),
    contrato_enviado: simNao('Informe se o contrato foi enviado.'),
    contrato_assinado: simNao('Informe se o contrato foi assinado.'),
    link_contrato: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .pipe(
        z
          .url({ protocol: /^https?$/, error: 'Link inválido. Use um endereço http:// ou https://.' })
          .nullable(),
      ),
    status_pagamento: z.enum(STATUS_PAGAMENTO_FECHAMENTO, 'Selecione o status do pagamento.'),
    status_onboarding: z.enum(STATUS_ONBOARDING, 'Selecione o status do onboarding.'),
    servico_ids: z.array(z.uuid()).default([]),
    observacoes: z
      .string()
      .trim()
      .max(2000, 'Máximo de 2000 caracteres.')
      .transform((v) => (v === '' ? null : v)),
  })
  .superRefine((f, ctx) => {
    if (f.contrato_assinado && !f.contrato_enviado) {
      ctx.addIssue({
        code: 'custom',
        path: ['contrato_assinado'],
        message: 'Contrato assinado precisa ter sido enviado.',
      })
    }
  })

export type AtualizarFechamentoInput = z.output<typeof atualizarFechamentoSchema>

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
