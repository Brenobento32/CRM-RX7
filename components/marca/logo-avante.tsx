/* eslint-disable @next/next/no-img-element -- logo de tamanho livre, vinda do storage ou de /public */
import { ICONE_OFICIAL, obterIdentidadeAvante, type IdentidadeAvante } from '@/lib/dal/identidade'

/**
 * Marca do AVANTE CRM. As duas variantes vão no HTML e o CSS mostra a do tema
 * ativo (`data-tema` no <html>, variante `dark:`) — sem piscar na troca de tema
 * e sem depender de JavaScript. `fundo="escuro"`: superfícies que são escuras
 * nos dois temas (capa do login).
 */
export function LogoAvante({
  identidade,
  className = 'h-8 w-auto',
  fundo = 'tema',
}: {
  identidade: IdentidadeAvante
  className?: string
  fundo?: 'tema' | 'escuro'
}) {
  if (fundo === 'escuro') {
    return <img src={identidade.escuro} alt="AVANTE CRM" className={className} />
  }
  return (
    <>
      <img src={identidade.claro} alt="AVANTE CRM" className={`${className} dark:hidden`} />
      <img src={identidade.escuro} alt="AVANTE CRM" className={`${className} hidden dark:block`} />
    </>
  )
}

/** Emblema oficial (sem o nome), para o menu recolhido. Decorativo. */
export function IconeAvante({ className = 'size-8' }: { className?: string }) {
  return (
    <>
      <img src={ICONE_OFICIAL.claro} alt="" aria-hidden className={`${className} object-contain dark:hidden`} />
      <img src={ICONE_OFICIAL.escuro} alt="" aria-hidden className={`${className} hidden object-contain dark:block`} />
    </>
  )
}

/** Marca do AVANTE CRM já com a identidade global (componente de servidor). */
export async function MarcaAvante(props: { className?: string; fundo?: 'tema' | 'escuro' }) {
  return <LogoAvante identidade={await obterIdentidadeAvante()} {...props} />
}
