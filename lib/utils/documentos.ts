/**
 * CPF, CNPJ e telefone são gravados só com dígitos. Estas funções limpam o
 * que o usuário digitou, validam os dígitos verificadores e formatam para
 * exibição.
 */

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false

  const digito = (tamanho: number) => {
    let soma = 0
    for (let i = 0; i < tamanho; i++) {
      soma += Number(cpf[i]) * (tamanho + 1 - i)
    }
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10])
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false

  const digito = (tamanho: number) => {
    const pesos =
      tamanho === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < tamanho; i++) {
      soma += Number(cnpj[i]) * pesos[i]
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  return digito(12) === Number(cnpj[12]) && digito(13) === Number(cnpj[13])
}

export function formatarCpf(cpf: string): string {
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

export function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

/** Formata telefones brasileiros com DDD (10 ou 11 dígitos), com ou sem +55. */
export function formatarTelefone(telefone: string): string {
  const local =
    telefone.length > 11 && telefone.startsWith('55')
      ? telefone.slice(2)
      : telefone

  if (local.length === 11) {
    return local.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  }
  if (local.length === 10) {
    return local.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  }
  return telefone
}

/** Link `wa.me` — exige o código do país. */
export function linkWhatsapp(whatsapp: string): string {
  const numero = whatsapp.length <= 11 ? `55${whatsapp}` : whatsapp
  return `https://wa.me/${numero}`
}
