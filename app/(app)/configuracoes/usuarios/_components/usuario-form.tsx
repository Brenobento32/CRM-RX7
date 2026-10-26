'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass, botaoFantasmaClass, caixaErroClass, arquivoClass } from '@/components/ui/estilos'
import { SeletorCor } from '@/components/ui/seletor-cor'
import type { EstadoFormUsuario } from '@/lib/actions/usuarios'
import type { CorEtapa } from '@/lib/utils/etapas'
import {
  FOTO_TIPOS,
  CARGOS_EM_ORDEM,
  ROTULO_PAPEL,
  type CampoUsuario,
} from '@/lib/validations/usuario'

type Props = {
  modo: 'criar' | 'editar'
  action: (
    estado: EstadoFormUsuario | undefined,
    formData: FormData,
  ) => Promise<EstadoFormUsuario>
  valoresIniciais: Partial<Record<CampoUsuario, string>>
  fotoAtual?: string | null
  /** No próprio usuário, perfil e status ficam travados. */
  proprioUsuario?: boolean
  /** Quem já usa cada cor na agenda (aviso de cor repetida). */
  coresEmUso?: Partial<Record<CorEtapa, string[]>>
}

export function UsuarioForm({
  modo,
  action,
  valoresIniciais,
  fotoAtual = null,
  proprioUsuario = false,
  coresEmUso,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais

  // Prévia local da foto escolhida, antes de enviar.
  const [previa, setPrevia] = useState<string | null>(null)

  const erro = (campo: CampoUsuario) => estado?.campos?.[campo]?.[0]
  const invalido = (campo: CampoUsuario) => (erro(campo) ? true : undefined)
  const nomeExibido = valores.nome || 'Novo usuário'

  return (
    <form action={formAction} noValidate className="space-y-6">
      {estado?.erro && (
        <div
          role="alert"
          className={caixaErroClass}
        >
          {estado.erro}
        </div>
      )}

      <div className="flex items-center gap-4">
        {previa ? (
          // Prévia de um arquivo local (blob:), que o next/image não otimiza.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previa} alt="Prévia da foto" className="size-[72px] rounded-full object-cover" />
        ) : (
          <Avatar nome={nomeExibido} fotoUrl={fotoAtual} tamanho="lg" />
        )}
        <div className="space-y-1.5">
          <label htmlFor="foto" className="block text-sm font-medium">
            Foto <span className="font-normal text-premium-mudo">(opcional, JPG/PNG/WebP até 2 MB)</span>
          </label>
          <input
            id="foto"
            name="foto"
            type="file"
            accept={FOTO_TIPOS.join(',')}
            aria-invalid={invalido('foto')}
            onChange={(e) => {
              const arquivo = e.target.files?.[0]
              setPrevia(arquivo ? URL.createObjectURL(arquivo) : null)
            }}
            className={arquivoClass}
          />
          <ErroCampo mensagem={erro('foto')} />
          {modo === 'editar' && fotoAtual && (
            <label className="flex items-center gap-2 text-sm text-premium-secundario">
              <input type="checkbox" name="remover_foto" defaultChecked={valores.remover_foto === 'on'} />
              Remover foto atual
            </label>
          )}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
            Nome
          </label>
          <input
            id="nome"
            name="nome"
            defaultValue={valores.nome}
            aria-invalid={invalido('nome')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('nome')} />
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={valores.email}
            // O e-mail é o login no Supabase Auth; não é alterado por aqui.
            disabled={modo === 'editar'}
            aria-invalid={invalido('email')}
            className={`${inputClass} disabled:bg-zinc-50 disabled:text-premium-mudo dark:disabled:bg-zinc-900`}
          />
          <ErroCampo mensagem={erro('email')} />
        </div>

        {modo === 'criar' && (
          <div>
            <label htmlFor="senha" className="mb-1.5 block text-sm font-medium">
              Senha inicial
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="new-password"
              aria-invalid={invalido('senha')}
              aria-describedby="senha-ajuda"
              className={inputClass}
            />
            <p id="senha-ajuda" className="mt-1 text-xs text-premium-mudo">
              Mínimo de 8 caracteres. Passe para a pessoa por um canal seguro.
            </p>
            <ErroCampo mensagem={erro('senha')} />
          </div>
        )}

        <div>
          <label htmlFor="telefone" className="mb-1.5 block text-sm font-medium">
            Telefone <span className="font-normal text-premium-mudo">(opcional)</span>
          </label>
          <input
            id="telefone"
            name="telefone"
            type="tel"
            placeholder="(11) 99999-8888"
            defaultValue={valores.telefone}
            aria-invalid={invalido('telefone')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('telefone')} />
        </div>

        <div>
          <label htmlFor="role" className="mb-1.5 block text-sm font-medium">
            Perfil
          </label>
          <select
            id="role"
            name="role"
            defaultValue={valores.role || 'closer'}
            // Campo desabilitado não é enviado: um input oculto leva o valor.
            disabled={proprioUsuario}
            aria-invalid={invalido('role')}
            className={inputClass}
          >
            {CARGOS_EM_ORDEM.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PAPEL[p]}
              </option>
            ))}
          </select>
          {proprioUsuario && <input type="hidden" name="role" value={valores.role} />}
          <ErroCampo mensagem={erro('role')} />
        </div>

        {modo === 'editar' && (
          <div>
            <label htmlFor="ativo" className="mb-1.5 block text-sm font-medium">
              Status
            </label>
            <select
              id="ativo"
              name="ativo"
              defaultValue={valores.ativo || 'sim'}
              disabled={proprioUsuario}
              aria-invalid={invalido('ativo')}
              className={inputClass}
            >
              <option value="sim">Ativo</option>
              <option value="nao">Inativo (não consegue entrar)</option>
            </select>
            {proprioUsuario && <input type="hidden" name="ativo" value={valores.ativo} />}
            <ErroCampo mensagem={erro('ativo')} />
          </div>
        )}
      </div>

      <SeletorCor
        name="cor_agenda"
        legenda="Cor na agenda"
        valorInicial={valores.cor_agenda ?? ''}
        permitirVazio
        emUso={coresEmUso}
        ajuda="As reuniões desta pessoa aparecem nesta cor na agenda."
        erro={erro('cor_agenda')}
      />

      {proprioUsuario && (
        <p className="text-xs text-premium-mudo">
          Perfil e status do próprio usuário não podem ser alterados aqui.
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-premium-borda pt-6">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : modo === 'criar' ? 'Criar usuário' : 'Salvar alterações'}
        </button>
        <Link
          href="/configuracoes/usuarios"
          className={botaoFantasmaClass}
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
