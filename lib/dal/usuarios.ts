import 'server-only'

import { FunctionsHttpError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { CorEtapa } from '@/lib/utils/etapas'
import type {
  CampoUsuario,
  CriarUsuarioInput,
  EditarUsuarioInput,
  Papel,
} from '@/lib/validations/usuario'

/**
 * Nome de exibição dos usuários, via `public.nomes_de_usuarios`: a RLS de
 * profiles não deixa um closer ler o perfil de outra pessoa, mas timeline e
 * agenda precisam mostrar quem registrou ou é dono do compromisso.
 *
 * Quem chama já passou por `getUsuarioAtual()`.
 */
export async function nomesDeUsuarios(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('nomes_de_usuarios', { p_ids: unicos })

  if (error) {
    throw new Error('Não foi possível carregar os usuários.', { cause: error })
  }
  return new Map(data.map((u) => [u.id, u.nome]))
}

// ---------------------------------------------------------------------------
// Gestão de usuários — somente gerente.
//
// Editar perfil é UPDATE em `profiles` com a sessão do gerente (RLS + trigger
// que protege papel e status). Criar usuário e ativar/desativar o login
// passam pela Edge Function `admin-usuarios`, a única com a chave
// service_role; ela confere de novo se quem chama é gerente.
// ---------------------------------------------------------------------------

export type Usuario = {
  id: string
  nome: string
  email: string
  telefone: string | null
  fotoUrl: string | null
  role: Papel
  ativo: boolean
  corAgenda: CorEtapa | null
}

export type ResultadoUsuario =
  | { ok: true; id: string; aviso?: string }
  | { ok: false; mensagem: string; campo?: CampoUsuario }

const BUCKET = 'avatares'

/**
 * Checagem de papel antes de qualquer operação. Não substitui a RLS nem a
 * Edge Function — evita chamadas que seriam recusadas lá e dá uma mensagem
 * clara.
 */
async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') {
    throw new Error('Somente gerentes administram usuários.')
  }
  return usuario
}

export async function listarUsuarios(): Promise<Usuario[]> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome, email, telefone, foto_url, role, ativo, cor_agenda')
    .order('ativo', { ascending: false })
    .order('nome')

  if (error) throw new Error('Não foi possível carregar os usuários.', { cause: error })
  return data.map(paraUsuario)
}

export async function obterUsuario(id: string): Promise<Usuario | null> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome, email, telefone, foto_url, role, ativo, cor_agenda')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error('Não foi possível carregar o usuário.', { cause: error })
  return data ? paraUsuario(data) : null
}

function paraUsuario(p: {
  id: string
  nome: string
  email: string
  telefone: string | null
  foto_url: string | null
  role: Papel
  ativo: boolean
  cor_agenda: CorEtapa | null
}): Usuario {
  return {
    id: p.id,
    nome: p.nome,
    email: p.email,
    telefone: p.telefone,
    fotoUrl: p.foto_url,
    role: p.role,
    ativo: p.ativo,
    corAgenda: p.cor_agenda,
  }
}

/**
 * Quem já usa cada cor na agenda, entre os usuários ativos — para o aviso de
 * cor repetida no formulário (não bloqueia). `exceto` tira o próprio usuário.
 */
export async function coresEmUso(exceto?: string): Promise<Partial<Record<CorEtapa, string[]>>> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome, cor_agenda')
    .eq('ativo', true)
    .not('cor_agenda', 'is', null)

  if (error) throw new Error('Não foi possível carregar as cores da agenda.', { cause: error })

  const uso: Partial<Record<CorEtapa, string[]>> = {}
  for (const p of data) {
    if (!p.cor_agenda || p.id === exceto) continue
    ;(uso[p.cor_agenda] ??= []).push(p.nome)
  }
  return uso
}

type RespostaFuncao = { ok: boolean; codigo?: string; mensagem?: string; usuario_id?: string }

/** Chama a Edge Function com a sessão do gerente e normaliza o erro. */
async function chamarAdmin(corpo: Record<string, unknown>): Promise<RespostaFuncao> {
  const supabase = await createClient()
  const { data, error } = await supabase.functions.invoke<RespostaFuncao>('admin-usuarios', {
    body: corpo,
  })

  if (!error) return data ?? { ok: false, mensagem: 'Resposta vazia do servidor.' }

  if (error instanceof FunctionsHttpError) {
    try {
      return (await error.context.json()) as RespostaFuncao
    } catch {
      // cai no erro genérico abaixo
    }
  }
  console.error('admin-usuarios', error)
  return { ok: false, mensagem: 'Não foi possível falar com o serviço de usuários.' }
}

export async function criarUsuario(
  input: CriarUsuarioInput,
  foto: File | null,
): Promise<ResultadoUsuario> {
  await exigirGerente()

  const r = await chamarAdmin({ acao: 'criar', ...input })
  if (!r.ok || !r.usuario_id) {
    return {
      ok: false,
      campo: r.codigo === 'email_existe' ? 'email' : r.codigo === 'senha_fraca' ? 'senha' : undefined,
      mensagem: r.mensagem ?? 'Não foi possível criar o usuário.',
    }
  }

  // O usuário já existe; se só a cor ou a foto falharem, a criação não é desfeita.
  if (input.cor_agenda) {
    const supabase = await createClient()
    const { error } = await supabase.from('profiles').update({ cor_agenda: input.cor_agenda }).eq('id', r.usuario_id)
    if (error) console.error('cor da agenda do novo usuário', error)
  }
  const erroFoto = foto ? await trocarFoto(r.usuario_id, foto, null) : null
  return erroFoto
    ? { ok: true, id: r.usuario_id, aviso: `Usuário criado, mas a foto não foi salva: ${erroFoto}` }
    : { ok: true, id: r.usuario_id }
}

export async function editarUsuario(
  id: string,
  input: EditarUsuarioInput,
  foto: File | null,
): Promise<ResultadoUsuario> {
  const eu = await exigirGerente()
  const atual = await obterUsuario(id)
  if (!atual) return { ok: false, mensagem: 'Usuário não encontrado.' }

  if (id === eu.id && input.role !== 'gerente') {
    return { ok: false, campo: 'role', mensagem: 'Você não pode tirar o próprio perfil de gerente.' }
  }
  if (id === eu.id && !input.ativo) {
    return { ok: false, campo: 'ativo', mensagem: 'Você não pode desativar o próprio usuário.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({ nome: input.nome, telefone: input.telefone, role: input.role, cor_agenda: input.cor_agenda })
    .eq('id', id)

  if (error) {
    if (error.code === '23514') {
      return { ok: false, campo: 'role', mensagem: 'É preciso manter ao menos um gerente ativo.' }
    }
    console.error('editar usuário', error)
    return { ok: false, mensagem: 'Não foi possível salvar o usuário.' }
  }

  if (foto) {
    const erroFoto = await trocarFoto(id, foto, atual.fotoUrl)
    if (erroFoto) return { ok: false, campo: 'foto', mensagem: erroFoto }
  } else if (input.remover_foto && atual.fotoUrl) {
    await supabase.from('profiles').update({ foto_url: null }).eq('id', id)
    await removerArquivo(atual.fotoUrl)
  }

  if (input.ativo !== atual.ativo) {
    const r = await definirAcesso(id, input.ativo)
    if (!r.ok) return { ok: false, campo: 'ativo', mensagem: r.mensagem }
  }

  return { ok: true, id }
}

/** Ativa/desativa: `profiles.ativo` + bloqueio do login no Auth (Edge Function). */
export async function definirAcesso(id: string, ativo: boolean): Promise<ResultadoUsuario> {
  const eu = await exigirGerente()
  if (id === eu.id && !ativo) {
    return { ok: false, mensagem: 'Você não pode desativar o próprio usuário.' }
  }

  const r = await chamarAdmin({ acao: 'definir_acesso', usuario_id: id, ativo })
  return r.ok ? { ok: true, id } : { ok: false, mensagem: r.mensagem ?? 'Não foi possível alterar o acesso.' }
}

/**
 * Sobe a foto nova, aponta o perfil para ela e só então apaga a antiga — se
 * algo falhar no meio, o perfil nunca fica apontando para um arquivo que não
 * existe. Devolve a mensagem de erro, ou `null`.
 */
async function trocarFoto(
  usuarioId: string,
  foto: File,
  fotoAnterior: string | null,
): Promise<string | null> {
  const supabase = await createClient()
  const extensao = foto.type === 'image/png' ? 'png' : foto.type === 'image/webp' ? 'webp' : 'jpg'
  const caminho = `${usuarioId}/${crypto.randomUUID()}.${extensao}`

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, foto, { contentType: foto.type, upsert: false })
  if (erroUpload) {
    console.error('upload avatar', erroUpload)
    return 'Não foi possível enviar a foto.'
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(caminho)
  const { error } = await supabase.from('profiles').update({ foto_url: data.publicUrl }).eq('id', usuarioId)
  if (error) {
    await supabase.storage.from(BUCKET).remove([caminho])
    console.error('foto_url', error)
    return 'Não foi possível salvar a foto.'
  }

  if (fotoAnterior) await removerArquivo(fotoAnterior)
  return null
}

/** Apaga do bucket a foto de uma URL pública. Falha aqui só deixa lixo. */
async function removerArquivo(urlPublica: string) {
  const marcador = `/storage/v1/object/public/${BUCKET}/`
  const i = urlPublica.indexOf(marcador)
  if (i < 0) return
  const supabase = await createClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([decodeURIComponent(urlPublica.slice(i + marcador.length))])
  if (error) console.warn('remover avatar antigo', error)
}
