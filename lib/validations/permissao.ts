import { z } from 'zod'

/**
 * Uma linha do conjunto final enviado por "Permissões comerciais"
 * (Configurações -> Usuários -> editar). Duas formas válidas:
 *   - acesso ao funil: `etapaId`/`podeVer`/`podeMover` todos `null`;
 *   - permissão de etapa: os quatro campos preenchidos.
 * "Misturar" (ex.: etapaId preenchido com podeVer null) é rejeitado — mesma
 * forma que a constraint `permissoes_colaborador_campos_por_tipo` no banco.
 *
 * `podeMover` sem `podeVer`: rejeitado aqui também (mesma regra da
 * constraint `permissoes_colaborador_mover_exige_ver`) — a tela já evita
 * isso ao vivo (marcar "Movimentar" liga "Visualizar" sozinho), esta
 * validação é só o backstop caso algo diferente chegue no payload.
 */
export const itemPermissaoSchema = z
  .object({
    funilId: z.uuid(),
    etapaId: z.uuid().nullable(),
    podeVer: z.boolean().nullable(),
    podeMover: z.boolean().nullable(),
  })
  .refine((i) => (i.etapaId === null) === (i.podeVer === null) && (i.etapaId === null) === (i.podeMover === null), {
    message: 'Linha de permissão inconsistente.',
  })
  .refine((i) => !i.podeMover || i.podeVer, {
    message: 'Não é possível movimentar uma etapa sem poder visualizá-la.',
  })

export const permissoesColaboradorSchema = z.array(itemPermissaoSchema)
