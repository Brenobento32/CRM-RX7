'use client'

import Image from 'next/image'
import { useActionState, useEffect, useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { arquivoClass, ajudaClass, botaoPrimarioClass, botaoSecundarioClass, caixaErroClass, caixaSucessoClass } from '@/components/ui/estilos'
import { minhaFotoAction } from '@/lib/actions/perfil'
import { FOTO_TAMANHO_MAXIMO, FOTO_TIPOS } from '@/lib/validations/usuario'

/**
 * Meu perfil → Foto: adicionar, trocar ou remover a própria foto. A conferência
 * aqui só antecipa o aviso; o servidor confere de novo o tipo real e o tamanho.
 */
export function FotoForm({ nome, fotoUrl }: { nome: string; fotoUrl: string | null }) {
  const [previa, setPrevia] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Depois de salvar ou remover, a prévia some (o campo de arquivo é limpo pelo próprio formulário).
  const [estado, acao, pendente] = useActionState(async (anterior: Awaited<ReturnType<typeof minhaFotoAction>> | undefined, fd: FormData) => {
    const r = await minhaFotoAction(anterior, fd)
    if (r.ok) setPrevia(null)
    return r
  }, undefined)

  useEffect(() => () => void (previa && URL.revokeObjectURL(previa)), [previa])

  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    setAviso(null)
    setPrevia(null)
    if (!f) return
    if (!(FOTO_TIPOS as readonly string[]).includes(f.type)) return setAviso('Use uma imagem JPG, PNG ou WebP.')
    if (f.size > FOTO_TAMANHO_MAXIMO) return setAviso('A foto pode ter no máximo 2 MB.')
    setPrevia(URL.createObjectURL(f))
  }

  return (
    <form action={acao} noValidate className="space-y-4">
      {estado?.ok && (
        <p role="status" className={caixaSucessoClass}>
          {estado.ok === 'trocada' ? 'Foto atualizada.' : 'Foto removida. Agora aparecem as suas iniciais.'}
        </p>
      )}
      {(estado?.erro || aviso) && (
        <p role="alert" className={caixaErroClass}>
          {aviso ?? estado?.erro}
        </p>
      )}

      <div className="flex items-center gap-4">
        {previa ? (
          <Image src={previa} alt="Prévia da nova foto" width={72} height={72} unoptimized className="size-[72px] shrink-0 rounded-full object-cover" />
        ) : (
          <Avatar nome={nome} fotoUrl={fotoUrl} tamanho="lg" />
        )}
        <p className="text-sm text-premium-secundario">
          {previa ? 'Prévia da nova foto. Salve para aplicar.' : fotoUrl ? 'Sua foto atual.' : 'Sem foto: aparecem as suas iniciais.'}
        </p>
      </div>

      <div>
        <label htmlFor="foto" className="mb-1.5 block text-sm font-medium">
          {fotoUrl ? 'Trocar foto' : 'Adicionar foto'}
        </label>
        <input id="foto" name="foto" type="file" accept="image/jpeg,image/png,image/webp" onChange={escolher} className={arquivoClass} />
        <p className={ajudaClass}>JPG, PNG ou WebP, até 2 MB.</p>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-premium-borda pt-4">
        {fotoUrl && (
          <button type="submit" name="acao" value="remover" disabled={pendente} className={botaoSecundarioClass}>
            Remover foto
          </button>
        )}
        <button type="submit" name="acao" value="trocar" disabled={pendente || !previa} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : 'Salvar foto'}
        </button>
      </div>
    </form>
  )
}
