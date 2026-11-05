/**
 * Troca da PRÓPRIA senha (Meu perfil), sem depender do Administrador.
 *
 * O Supabase Auth só exige a senha atual no `updateUser` quando a opção do
 * projeto está ligada; por isso a senha atual é conferida aqui, numa sessão
 * temporária (sem cookie), que é encerrada logo depois. Só então a senha nova
 * é gravada na sessão do próprio usuário — nunca na de outra pessoa (o e-mail
 * vem da sessão, nunca do formulário).
 *
 * Nenhuma senha vai para log, mensagem de erro ou banco de perfis.
 */

export type ErroAuth = { code?: string; status?: number; name?: string } | null

export type DependenciasTrocaSenha = {
  /** E-mail da sessão atual (Supabase Auth), ou null sem sessão. */
  emailDaSessao: () => Promise<string | null>
  /** Confere a senha numa sessão temporária; `encerrar` revoga essa sessão. */
  verificarSenha: (email: string, senha: string) => Promise<{ ok: true; encerrar: () => Promise<void> } | { ok: false; erro: ErroAuth }>
  /** Grava a senha nova na sessão do próprio usuário. */
  atualizarSenha: (nova: string, atual: string) => Promise<ErroAuth>
}

export type ResultadoTrocaSenha = { ok: true } | { ok: false; campo?: 'senha_atual' | 'nova_senha'; mensagem: string }

const SESSAO_EXPIRADA = 'Sua sessão expirou. Entre de novo para trocar a senha.'
const MUITAS_TENTATIVAS = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'

function limite(e: ErroAuth): boolean {
  return Boolean(e && (e.status === 429 || e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit'))
}

export async function trocarSenhaComVerificacao(deps: DependenciasTrocaSenha, atual: string, nova: string): Promise<ResultadoTrocaSenha> {
  const email = await deps.emailDaSessao()
  if (!email) return { ok: false, mensagem: SESSAO_EXPIRADA }

  const conferida = await deps.verificarSenha(email, atual)
  if (!conferida.ok) {
    if (limite(conferida.erro)) return { ok: false, mensagem: MUITAS_TENTATIVAS }
    return { ok: false, campo: 'senha_atual', mensagem: 'Senha atual incorreta.' }
  }
  try {
    await conferida.encerrar()
  } catch {
    // A sessão temporária some sozinha ao trocar a senha; seguir é seguro.
  }

  const erro = await deps.atualizarSenha(nova, atual)
  if (!erro) return { ok: true }
  if (erro.code === 'same_password') return { ok: false, campo: 'nova_senha', mensagem: 'A nova senha precisa ser diferente da atual.' }
  if (erro.code === 'weak_password') {
    return { ok: false, campo: 'nova_senha', mensagem: 'Senha considerada fraca. Use mais caracteres, com letras, números e símbolos.' }
  }
  if (erro.code === 'reauthentication_needed' || erro.code === 'reauth_nonce_missing' || erro.code === 'current_password_required') {
    return { ok: false, mensagem: 'Por segurança, saia e entre de novo no AVANTE antes de trocar a senha.' }
  }
  if (erro.code === 'session_not_found' || erro.code === 'session_expired' || erro.name === 'AuthSessionMissingError') {
    return { ok: false, mensagem: SESSAO_EXPIRADA }
  }
  if (limite(erro)) return { ok: false, mensagem: MUITAS_TENTATIVAS }
  return { ok: false, mensagem: 'Não foi possível trocar a senha. Tente de novo.' }
}
