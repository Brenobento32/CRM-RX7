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

/** Regras da senha forte (Meu perfil), na ordem em que aparecem na tela. */
export const REGRAS_SENHA_FORTE = [
  'Ao menos 10 caracteres',
  'Uma letra maiúscula e uma minúscula',
  'Um número',
  'Um símbolo (por exemplo ! @ # $)',
] as const

/** Senha forte. Máximo de 72 caracteres, o limite do bcrypt do Supabase Auth. */
export const senhaForte = z
  .string()
  .min(10, 'A nova senha precisa ter ao menos 10 caracteres.')
  .max(72, 'Máximo de 72 caracteres.')
  .regex(/[a-z]/, 'Use ao menos uma letra minúscula.')
  .regex(/[A-Z]/, 'Use ao menos uma letra maiúscula.')
  .regex(/[0-9]/, 'Use ao menos um número.')
  .regex(/[^A-Za-z0-9]/, 'Use ao menos um símbolo (por exemplo ! @ # $).')

/** Troca da própria senha: exige a atual; a nova é forte, confirmada e diferente da atual. */
export const alterarMinhaSenhaSchema = z
  .object({
    senha_atual: z.string().min(1, 'Informe a senha atual.').max(72, 'Máximo de 72 caracteres.'),
    nova_senha: senhaForte,
    confirmar_senha: z.string().min(1, 'Confirme a nova senha.'),
  })
  .refine((v) => v.nova_senha === v.confirmar_senha, {
    message: 'As senhas não coincidem.',
    path: ['confirmar_senha'],
  })
  .refine((v) => v.nova_senha !== v.senha_atual, {
    message: 'A nova senha precisa ser diferente da atual.',
    path: ['nova_senha'],
  })

export type AlterarMinhaSenhaInput = z.infer<typeof alterarMinhaSenhaSchema>
