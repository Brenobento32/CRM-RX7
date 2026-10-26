import Link from 'next/link'

import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'

/**
 * 404 dentro da área autenticada (mantém menu e cabeçalho): página que não
 * existe OU que o cargo não pode abrir — de propósito a mesma mensagem, para
 * não revelar que a área existe para outros cargos.
 */
export default function NaoEncontrada() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <p className="text-sm font-semibold tracking-wide text-premium-acento">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-premium-texto">Página não encontrada</h1>
      <p className="mt-2 text-sm text-premium-secundario">
        O endereço não existe ou não está disponível para o seu perfil. Se você chegou aqui por um link, ele pode estar
        desatualizado.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/" className={botaoPrimarioClass}>
          Ir para o Início
        </Link>
        <Link href="/agenda" className={botaoSecundarioClass}>
          Abrir a agenda
        </Link>
      </div>
    </div>
  )
}
