import { z } from 'zod'

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Informe o e-mail.')
    .pipe(z.email('E-mail inválido.')),
  senha: z.string().min(1, 'Informe a senha.'),
})

export type LoginInput = z.infer<typeof loginSchema>

export const esqueciSenhaSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Informe o e-mail.')
    .pipe(z.email('E-mail inválido.')),
})

export type EsqueciSenhaInput = z.infer<typeof esqueciSenhaSchema>

/** Mesmo limite de 72 caracteres do bcrypt usado pelo Supabase Auth (ver `criarUsuarioSchema`). */
export const redefinirSenhaSchema = z
  .object({
    senha: z
      .string()
      .min(8, 'A senha precisa ter ao menos 8 caracteres.')
      .max(72, 'Máximo de 72 caracteres.'),
    confirmar_senha: z.string().min(1, 'Confirme a nova senha.'),
  })
  .refine((v) => v.senha === v.confirmar_senha, {
    message: 'As senhas não coincidem.',
    path: ['confirmar_senha'],
  })

export type RedefinirSenhaInput = z.infer<typeof redefinirSenhaSchema>
