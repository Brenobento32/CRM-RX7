import { describe, expect, it, vi } from 'vitest'

import { trocarSenhaComVerificacao, type DependenciasTrocaSenha } from '@/lib/auth/trocar-senha'
import { alterarMinhaSenhaSchema, senhaForte } from '@/lib/validations/auth'

const ATUAL = 'Senha-Atual-123'
const NOVA = 'Nova#Senha2026'

function deps(over: Partial<DependenciasTrocaSenha> = {}) {
  const encerrar = vi.fn(async () => {})
  const d = {
    emailDaSessao: vi.fn(async () => 'pessoa@empresa.test'),
    verificarSenha: vi.fn(async () => ({ ok: true as const, encerrar })),
    atualizarSenha: vi.fn(async () => null),
    ...over,
  }
  return { d, encerrar }
}

describe('troca da própria senha', () => {
  it('confere a senha atual com o e-mail da SESSÃO, encerra a sessão temporária e só então grava a nova', async () => {
    const ordem: string[] = []
    const d: DependenciasTrocaSenha = {
      emailDaSessao: async () => 'pessoa@empresa.test',
      verificarSenha: async (email, senha) => {
        ordem.push(`verificar:${email}:${senha === ATUAL}`)
        return { ok: true, encerrar: async () => void ordem.push('encerrar') }
      },
      atualizarSenha: async (nova, atual) => {
        ordem.push(`atualizar:${nova === NOVA}:${atual === ATUAL}`)
        return null
      },
    }
    expect(await trocarSenhaComVerificacao(d, ATUAL, NOVA)).toEqual({ ok: true })
    expect(ordem).toEqual(['verificar:pessoa@empresa.test:true', 'encerrar', 'atualizar:true:true'])
  })

  it('senha atual errada: recusa no campo certo e NÃO grava nada', async () => {
    const { d } = deps({ verificarSenha: vi.fn(async () => ({ ok: false as const, erro: { code: 'invalid_credentials', status: 400 } })) })
    expect(await trocarSenhaComVerificacao(d, 'errada', NOVA)).toEqual({ ok: false, campo: 'senha_atual', mensagem: 'Senha atual incorreta.' })
    expect(d.atualizarSenha).not.toHaveBeenCalled()
  })

  it('sem sessão: nada é conferido nem gravado', async () => {
    const { d } = deps({ emailDaSessao: vi.fn(async () => null) })
    const r = await trocarSenhaComVerificacao(d, ATUAL, NOVA)
    expect(r.ok).toBe(false)
    expect(d.verificarSenha).not.toHaveBeenCalled()
    expect(d.atualizarSenha).not.toHaveBeenCalled()
  })

  it('muitas tentativas na conferência: mensagem própria, sem gravar', async () => {
    const { d } = deps({ verificarSenha: vi.fn(async () => ({ ok: false as const, erro: { status: 429 } })) })
    const r = await trocarSenhaComVerificacao(d, ATUAL, NOVA)
    expect(r).toEqual({ ok: false, mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' })
    expect(d.atualizarSenha).not.toHaveBeenCalled()
  })

  it.each([
    ['same_password', 'nova_senha', 'A nova senha precisa ser diferente da atual.'],
    ['weak_password', 'nova_senha', 'Senha considerada fraca. Use mais caracteres, com letras, números e símbolos.'],
    ['reauthentication_needed', undefined, 'Por segurança, saia e entre de novo no AVANTE antes de trocar a senha.'],
    ['session_not_found', undefined, 'Sua sessão expirou. Entre de novo para trocar a senha.'],
    ['erro_desconhecido', undefined, 'Não foi possível trocar a senha. Tente de novo.'],
  ])('erro do Supabase Auth %s: mensagem clara em português', async (code, campo, mensagem) => {
    const { d } = deps({ atualizarSenha: vi.fn(async () => ({ code })) })
    expect(await trocarSenhaComVerificacao(d, ATUAL, NOVA)).toEqual(campo ? { ok: false, campo, mensagem } : { ok: false, mensagem })
  })

  it('nenhuma senha aparece nas mensagens nem no console', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d } = deps({ atualizarSenha: vi.fn(async () => ({ code: 'erro_desconhecido' })) })
    const r = await trocarSenhaComVerificacao(d, ATUAL, NOVA)
    const tudo = JSON.stringify([r, log.mock.calls, avisos.mock.calls])
    expect(tudo).not.toContain(ATUAL)
    expect(tudo).not.toContain(NOVA)
    log.mockRestore()
    avisos.mockRestore()
  })
})

describe('validação da senha forte', () => {
  it.each([
    ['curta', 'Ab1!', 'ao menos 10'],
    ['sem maiúscula', 'senhasegura1!', 'maiúscula'],
    ['sem minúscula', 'SENHASEGURA1!', 'minúscula'],
    ['sem número', 'SenhaSegura!!', 'número'],
    ['sem símbolo', 'SenhaSegura12', 'símbolo'],
  ])('%s: recusada', (_caso, senha, trecho) => {
    const r = senhaForte.safeParse(senha)
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain(trecho)
  })

  it('forte: aceita', () => {
    expect(senhaForte.safeParse(NOVA).success).toBe(true)
  })

  it('confirmação diferente e nova igual à atual: recusadas no campo certo', () => {
    const dif = alterarMinhaSenhaSchema.safeParse({ senha_atual: ATUAL, nova_senha: NOVA, confirmar_senha: 'Outra#Senha2026' })
    expect(dif.success).toBe(false)
    expect(dif.error?.issues.some((i) => i.path[0] === 'confirmar_senha' && i.message === 'As senhas não coincidem.')).toBe(true)
    const igual = alterarMinhaSenhaSchema.safeParse({ senha_atual: NOVA, nova_senha: NOVA, confirmar_senha: NOVA })
    expect(igual.success).toBe(false)
    expect(igual.error?.issues.some((i) => i.path[0] === 'nova_senha' && i.message === 'A nova senha precisa ser diferente da atual.')).toBe(true)
  })

  it('senha atual obrigatória', () => {
    const r = alterarMinhaSenhaSchema.safeParse({ senha_atual: '', nova_senha: NOVA, confirmar_senha: NOVA })
    expect(r.error?.issues.some((i) => i.path[0] === 'senha_atual')).toBe(true)
  })
})
