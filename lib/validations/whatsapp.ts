import { z } from 'zod'

/**
 * Configuração da conexão WhatsApp: funil e responsável padrão usados pela
 * automação futura de lead (ainda não implementada). Espelha
 * `whatsapp_conexoes.funil_id` / `responsavel_padrao_id`.
 */
export const configuracaoWhatsappSchema = z.object({
  funilId: z.uuid('Selecione o funil.'),
  responsavelPadraoId: z.uuid('Selecione o responsável padrão.'),
})

export type ConfiguracaoWhatsappInput = z.output<typeof configuracaoWhatsappSchema>
