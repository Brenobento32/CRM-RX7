import type { Metadata } from 'next'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import { ROTULO_CARGO } from '@/lib/validations/usuario'

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
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium titulo="Meu perfil" subtitulo="Seus dados de contato e a cor das suas reuniões na agenda." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Secao titulo="Dados pessoais" className="lg:col-span-2">
          <PerfilForm nome={data?.nome ?? usuario.nome} telefone={data?.telefone ?? ''} cor={data?.cor_agenda ?? ''} />
        </Secao>

        <Secao titulo="Acesso" descricao="Alterados pelo administrador da empresa." className="lg:self-start">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-premium-mudo">E-mail de acesso</dt>
              <dd className="mt-0.5 break-all text-premium-texto">{data?.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-premium-mudo">Cargo</dt>
              <dd className="mt-0.5 text-premium-texto">{ROTULO_CARGO[usuario.role]}</dd>
            </div>
          </dl>
        </Secao>
      </div>
    </div>
  )
}
