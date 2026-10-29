/**
 * Dados da Rio X7 usados nas páginas públicas (/privacidade, /termos e
 * apresentação), aprovados pelo proprietário em 28/10/2026. Nada aqui é
 * inventado: um campo `null` aparece DESTACADO na página como pendente, com um
 * aviso de rascunho no topo. Não há endereço físico completo por decisão do
 * proprietário (só a cidade), nem encarregado nomeado: o atendimento é feito
 * pelo setor indicado em `atendimento`.
 *
 * Pontos que dependem de revisão jurídica (sem bloquear a página) estão em
 * `docs/PAGINAS-PUBLICAS-REVISAO-JURIDICA.md`.
 */
export type DadosLegais = {
  /** Nome comercial usado no produto (rodapé do login e metadados). */
  marca: string
  razaoSocial: string | null
  cnpj: string | null
  /** Só cidade e estado (o endereço completo não é publicado). */
  localidade: string | null
  /** Canal para pedidos de titulares e de exclusão de dados. */
  emailPrivacidade: string | null
  /** Quem atende os pedidos (não é a indicação formal de um encarregado). */
  atendimento: string | null
  /** Prazo para responder os pedidos dos titulares. */
  prazoAtendimento: string | null
  /** Foro dos Termos de Uso. */
  foro: string | null
  /** Data dos documentos (exibida como "Vigência"). */
  vigencia: string | null
}

export const DADOS_LEGAIS: DadosLegais = {
  marca: 'Rio X7 Agência Digital',
  razaoSocial: 'MG Gestão e Suporte LTDA',
  cnpj: '61.164.464/0001-28',
  localidade: 'Petrópolis – RJ',
  emailPrivacidade: 'suporte@riox7comunicacao.com.br',
  atendimento: 'Setor de Privacidade e Proteção de Dados',
  prazoAtendimento: 'até 15 dias, observados os direitos e prazos legais específicos',
  foro: 'Petrópolis – RJ, ressalvadas as regras legais aplicáveis',
  vigencia: '28 de outubro de 2026',
}

export const SITE_AVANTE = 'https://avante.riox7comunicacao.com.br'

/** Rótulos legíveis de cada campo pendente (para o aviso de rascunho). */
export const ROTULOS_PENDENTES: Record<Exclude<keyof DadosLegais, 'marca'>, string> = {
  razaoSocial: 'razão social da Rio X7',
  cnpj: 'CNPJ',
  localidade: 'cidade e estado',
  emailPrivacidade: 'e-mail para privacidade e exclusão de dados',
  atendimento: 'setor de atendimento dos titulares',
  prazoAtendimento: 'prazo de atendimento dos pedidos',
  foro: 'foro dos Termos',
  vigencia: 'data dos documentos',
}

export function pendencias(d: DadosLegais = DADOS_LEGAIS): string[] {
  return (Object.keys(ROTULOS_PENDENTES) as (keyof typeof ROTULOS_PENDENTES)[]).filter((k) => !d[k]).map((k) => ROTULOS_PENDENTES[k])
}
