import { caixaErroClass, caixaSucessoClass } from '@/components/ui/estilos'

/** Mensagem de retorno das actions (?ok= / ?erro=). Texto vindo da URL, renderizado como texto. */
export function Aviso({ ok, erro }: { ok?: string | string[]; erro?: string | string[] }) {
  const mensagemOk = Array.isArray(ok) ? ok[0] : ok
  const mensagemErro = Array.isArray(erro) ? erro[0] : erro
  if (mensagemErro) {
    return (
      <p role="alert" className={caixaErroClass}>
        {mensagemErro}
      </p>
    )
  }
  if (mensagemOk) {
    return (
      <p role="status" className={caixaSucessoClass}>
        {mensagemOk}
      </p>
    )
  }
  return null
}

export const ROTULO_STATUS_EMPRESA: Record<string, string> = {
  teste: 'Teste',
  ativo: 'Ativa',
  suspenso: 'Suspensa',
  cancelado: 'Cancelada',
  arquivo: 'Arquivo (somente leitura)',
}

export const ROTULO_TIPO_EMPRESA: Record<string, string> = {
  assinante: 'Assinante',
  interno: 'Interna',
  arquivo: 'Arquivo',
}
