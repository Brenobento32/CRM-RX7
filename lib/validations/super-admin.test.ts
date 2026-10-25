import { describe, expect, it } from 'vitest'

import { assinaturaSchema, novaEmpresaSchema, planoSchema, validarLogo } from './super-admin'

describe('novaEmpresaSchema', () => {
  it('normaliza e aceita convite sem senha', () => {
    const r = novaEmpresaSchema.parse({
      nome: 'Empresa A', slug: ' Empresa-A ', admin_nome: 'Ana', admin_email: 'ANA@Teste.com', admin_senha: '',
    })
    expect(r.slug).toBe('empresa-a')
    expect(r.admin_email).toBe('ana@teste.com')
    expect(r.admin_senha).toBeNull()
  })

  it('recusa slug inválido e senha curta', () => {
    const base = { nome: 'A', slug: 'a', admin_nome: 'Ana', admin_email: 'a@b.com', admin_senha: '' }
    expect(novaEmpresaSchema.safeParse({ ...base, nome: 'Empresa', slug: 'com espaço' }).success).toBe(false)
    expect(novaEmpresaSchema.safeParse({ ...base, nome: 'Empresa', admin_senha: '123' }).success).toBe(false)
  })
})

describe('planoSchema', () => {
  const base = {
    codigo: 'pro', nome: 'Pro', preco_mensal: '', preco_anual: '', limite_usuarios: '', limite_integracoes: '',
    dias_teste: '', recursos: ['metas'], status: 'rascunho',
  }

  it('campos vazios viram null (preço e limite a definir)', () => {
    const r = planoSchema.parse(base)
    expect(r.preco_mensal).toBeNull()
    expect(r.limite_usuarios).toBeNull()
  })

  it('aceita vírgula decimal e recusa limite fracionário, negativo ou recurso desconhecido', () => {
    expect(planoSchema.parse({ ...base, preco_mensal: '99,90' }).preco_mensal).toBe(99.9)
    expect(planoSchema.safeParse({ ...base, limite_usuarios: '2.5' }).success).toBe(false)
    expect(planoSchema.safeParse({ ...base, limite_usuarios: '0' }).success).toBe(false)
    expect(planoSchema.safeParse({ ...base, preco_anual: '-1' }).success).toBe(false)
    expect(planoSchema.safeParse({ ...base, recursos: ['tudo'] }).success).toBe(false)
  })
})

describe('assinaturaSchema', () => {
  const base = {
    plano_codigo: 'starter', status: 'ativa', ciclo: 'mensal', renovacao_em: '2026-11-22', teste_ate: '',
    motivo: 'Pagamento confirmado', provedor: '', provedor_assinatura_id: '',
  }

  it('exige motivo e converte datas', () => {
    const r = assinaturaSchema.parse(base)
    expect(r.renovacao_em).toBe('2026-11-22T12:00:00-03:00')
    expect(r.teste_ate).toBeNull()
    expect(r.provedor).toBeNull()
    expect(assinaturaSchema.safeParse({ ...base, motivo: '' }).success).toBe(false)
    expect(assinaturaSchema.safeParse({ ...base, status: 'paga' }).success).toBe(false)
  })
})

describe('cadastro completo da empresa', () => {
  const base = { nome: 'Empresa A', slug: 'empresa-a', admin_nome: 'Ana', admin_email: 'a@b.com', admin_senha: '' }

  it('aceita os campos opcionais vazios (viram null) e normaliza telefone/e-mail', () => {
    const vazio = novaEmpresaSchema.parse({ ...base, telefone: '', email: '', responsavel_nome: '' })
    expect([vazio.telefone, vazio.email, vazio.responsavel_nome]).toEqual([null, null, null])
    const cheio = novaEmpresaSchema.parse({ ...base, telefone: '(11) 98888-7777', email: ' Contato@A.com ', responsavel_nome: ' Fulana ' })
    expect([cheio.telefone, cheio.email, cheio.responsavel_nome]).toEqual(['11988887777', 'contato@a.com', 'Fulana'])
  })

  it('recusa endereço reservado pelo sistema, telefone curto e e-mail inválido', () => {
    const campos = { telefone: '', email: '', responsavel_nome: '' }
    for (const slug of ['agenda', 'login', 'admin', 'e', 'configuracoes']) {
      expect(novaEmpresaSchema.safeParse({ ...base, ...campos, slug }).success).toBe(false)
    }
    expect(novaEmpresaSchema.safeParse({ ...base, ...campos, telefone: '1234' }).success).toBe(false)
    expect(novaEmpresaSchema.safeParse({ ...base, ...campos, email: 'sem-arroba' }).success).toBe(false)
  })

  it('logo: só PNG/JPG/WebP até 2 MB; vazio = sem logo', () => {
    expect(validarLogo(null)).toBeNull()
    expect(validarLogo(new File([], 'vazio.png', { type: 'image/png' }))).toBeNull()
    expect(typeof validarLogo(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))).toBe('string')
    expect(typeof validarLogo(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'g.png', { type: 'image/png' }))).toBe('string')
    expect(validarLogo(new File(['x'], 'ok.webp', { type: 'image/webp' }))).toBeInstanceOf(File)
  })
})
