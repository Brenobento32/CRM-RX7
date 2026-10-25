import type { Metadata } from 'next'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import { ROTULO_PAPEL } from '@/lib/validations/usuario'

import { PerfilForm } from './_components/perfil-form'

export const metadata: Metadata = {
  title: 'Meu perfil',
}

/** "Editar perfil" do menu do usuário — vale para todos os papéis. */
export default async function PerfilPage() {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('nome, telefone, cor_agenda, email').eq('id', usuario.id).maybeSingle()

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Meu perfil</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {data?.email ?? ''} · {ROTULO_PAPEL[usuario.role]}. E-mail e perfil de acesso são alterados pelo gerente.
        </p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <PerfilForm nome={data?.nome ?? usuario.nome} telefone={data?.telefone ?? ''} cor={data?.cor_agenda ?? ''} />
      </div>
    </div>
  )
}
