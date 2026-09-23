/**
 * Edge Function `admin-usuarios` — operações que exigem a API de admin do Auth.
 *
 * É o ÚNICO lugar do sistema que usa a chave service_role. Ela chega aqui
 * pelo ambiente das Edge Functions (SUPABASE_SERVICE_ROLE_KEY é injetada pelo
 * Supabase) e nunca passa pelo Next.
 *
 * Toda chamada:
 *   1. traz o JWT do usuário logado (verificado pelo gateway, verify_jwt);
 *   2. é conferida com `public.is_gerente()` usando esse JWT — ou seja, a
 *      mesma regra da RLS decide quem pode administrar usuários;
 *   3. só então usa o cliente admin.
 *
 * Ações:
 *   criar          → cria no Auth (e-mail já confirmado); o trigger
 *                    on_auth_user_created cria o profile com o papel.
 *   definir_acesso → ativa/desativa: profiles.ativo + bloqueio de login no Auth.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

type Papel = 'gerente' | 'closer'

type Pedido =
  | {
      acao: 'criar'
      nome: string
      email: string
      senha: string
      telefone: string | null
      role: Papel
    }
  | { acao: 'definir_acesso'; usuario_id: string; ativo: boolean }

/** Bloqueio "para sempre" no Auth: 100 anos. */
const BLOQUEIO = '876000h'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function resposta(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const erro = (status: number, codigo: string, mensagem: string) =>
  resposta(status, { ok: false, codigo, mensagem })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validação mínima: a completa (Zod) roda no Next antes de chamar. */
function validar(p: unknown): Pedido | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>

  if (o.acao === 'criar') {
    const papel = o.role === 'gerente' || o.role === 'closer' ? o.role : null
    if (
      typeof o.nome !== 'string' || !o.nome.trim() ||
      typeof o.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email) ||
      typeof o.senha !== 'string' || o.senha.length < 8 ||
      (o.telefone !== null && (typeof o.telefone !== 'string' || !/^\d{10,13}$/.test(o.telefone))) ||
      !papel
    ) {
      return null
    }
    return {
      acao: 'criar',
      nome: o.nome.trim(),
      email: o.email.trim().toLowerCase(),
      senha: o.senha,
      telefone: o.telefone as string | null,
      role: papel,
    }
  }

  if (o.acao === 'definir_acesso') {
    if (typeof o.usuario_id !== 'string' || !UUID.test(o.usuario_id) || typeof o.ativo !== 'boolean') {
      return null
    }
    return { acao: 'definir_acesso', usuario_id: o.usuario_id, ativo: o.ativo }
  }

  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return erro(405, 'metodo', 'Use POST.')

  const authorization = req.headers.get('Authorization')
  if (!authorization) return erro(401, 'nao_autenticado', 'Sessão ausente.')

  // Cliente com o JWT de quem chama: a pergunta "é gerente?" passa pela
  // mesma função que as policies de RLS usam.
  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: usuario } = await comoUsuario.auth.getUser()
  if (!usuario?.user) return erro(401, 'nao_autenticado', 'Sessão inválida.')

  const { data: gerente, error: erroGerente } = await comoUsuario.rpc('is_gerente')
  if (erroGerente || gerente !== true) {
    return erro(403, 'sem_permissao', 'Somente gerentes administram usuários.')
  }

  let pedido: Pedido | null
  try {
    pedido = validar(await req.json())
  } catch {
    pedido = null
  }
  if (!pedido) return erro(400, 'pedido_invalido', 'Dados inválidos.')

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (pedido.acao === 'criar') {
    const { data, error } = await admin.auth.admin.createUser({
      email: pedido.email,
      password: pedido.senha,
      email_confirm: true,
      // app_metadata só é gravável pela API de admin: é daqui que o trigger
      // handle_new_user tira o papel.
      app_metadata: { role: pedido.role },
      user_metadata: { nome: pedido.nome },
    })

    if (error || !data.user) {
      const codigo = (error as { code?: string } | null)?.code
      if (codigo === 'email_exists' || /already been registered/i.test(error?.message ?? '')) {
        return erro(409, 'email_existe', 'Já existe um usuário com este e-mail.')
      }
      if (codigo === 'weak_password') {
        return erro(400, 'senha_fraca', 'Senha fraca demais para as regras do Supabase Auth.')
      }
      console.error('createUser', error)
      return erro(500, 'erro_auth', 'Não foi possível criar o usuário.')
    }

    if (pedido.telefone) {
      const { error: erroPerfil } = await admin
        .from('profiles')
        .update({ telefone: pedido.telefone })
        .eq('id', data.user.id)
      if (erroPerfil) console.error('telefone do novo usuário', erroPerfil)
    }

    return resposta(201, { ok: true, usuario_id: data.user.id })
  }

  // definir_acesso
  if (pedido.usuario_id === usuario.user.id && !pedido.ativo) {
    return erro(400, 'auto_desativacao', 'Você não pode desativar o próprio usuário.')
  }

  // Perfil primeiro, e com o JWT do gerente: o trigger que protege `ativo`
  // só aceita a mudança vinda de um gerente (com a service_role não há
  // usuário logado), e profiles_mantem_gerente pode recusar o último gerente
  // — nesse caso o Auth nem é tocado.
  const { data: perfil, error: erroPerfil } = await comoUsuario
    .from('profiles')
    .update({ ativo: pedido.ativo })
    .eq('id', pedido.usuario_id)
    .select('id')
    .maybeSingle()

  if (erroPerfil) {
    if (erroPerfil.code === '23514') {
      return erro(400, 'ultimo_gerente', 'É preciso manter ao menos um gerente ativo.')
    }
    console.error('profiles.ativo', erroPerfil)
    return erro(500, 'erro_perfil', 'Não foi possível atualizar o usuário.')
  }
  if (!perfil) return erro(404, 'nao_encontrado', 'Usuário não encontrado.')

  const { error: erroBan } = await admin.auth.admin.updateUserById(pedido.usuario_id, {
    ban_duration: pedido.ativo ? 'none' : BLOQUEIO,
  })

  if (erroBan) {
    // Desfaz o perfil para os dois lados não ficarem em desacordo.
    await comoUsuario.from('profiles').update({ ativo: !pedido.ativo }).eq('id', pedido.usuario_id)
    console.error('ban_duration', erroBan)
    return erro(500, 'erro_auth', 'Não foi possível atualizar o acesso no Auth.')
  }

  return resposta(200, { ok: true })
})
