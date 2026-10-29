import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: { absolute: 'AVANTE CRM — gestão comercial da Rio X7' },
  description:
    'AVANTE CRM: funil de vendas, clientes, agenda, metas e captação de leads (formulários, Google Sheets e WhatsApp Business oficial) para as empresas clientes da Rio X7 Agência Digital.',
}

const RECURSOS: { titulo: string; texto: string }[] = [
  { titulo: 'Funil de vendas', texto: 'Vários funis por empresa, etapas configuráveis e permissões por cargo (Administrador, Vendedor, Atendente, SDR e Closer).' },
  { titulo: 'Clientes e negociações', texto: 'Histórico de cada cliente, atividades, propostas e o caminho de cada negociação no funil.' },
  { titulo: 'Agenda da equipe', texto: 'Reuniões e compromissos com aviso de conflito de horário.' },
  { titulo: 'Metas', texto: 'Metas de vendas e de reuniões, com acompanhamento por período.' },
  {
    titulo: 'Captação de leads',
    texto: 'Formulários próprios, formulários Respondi e planilhas do Google Sheets escolhidas pela empresa: cada lead entra no funil, na etapa e com o responsável definidos.',
  },
  {
    titulo: 'WhatsApp Business oficial',
    texto: 'Conexão pela plataforma oficial da Meta (Cloud API), feita pela própria empresa. Em homologação.',
  },
]

/**
 * Apresentação pública do AVANTE (é o que aparece em "/" para quem não está
 * logado). Sem dados de empresas: só o que o produto faz e os links legais.
 */
export default function ApresentacaoPage() {
  return (
    <>
      <section
        className="bg-[#0c0f11] text-white"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 70% 60% at 10% 0%, rgb(45 212 167 / 0.18), transparent 60%), linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px)',
          backgroundSize: 'auto, 48px 48px, 48px 48px',
        }}
      >
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-sm font-medium tracking-wide text-[#5ee3c0] uppercase">AVANTE CRM</p>
          <h1 className="mt-3 max-w-2xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">Do primeiro contato ao fechamento, num só lugar.</h1>
          <p className="mt-5 max-w-2xl text-lg text-white/75">
            O AVANTE é o sistema de gestão comercial da Rio X7 Agência Digital para as suas empresas clientes: organiza leads, funil de vendas, agenda e metas
            de cada empresa, com os dados de uma empresa separados dos de todas as outras.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="rounded-lg bg-[#2dd4a7] px-5 py-2.5 font-medium text-[#08110e] hover:bg-[#5ee3c0]">
              Entrar no AVANTE
            </Link>
            <Link href="/privacidade" className="rounded-lg border border-white/20 px-5 py-2.5 font-medium text-white hover:bg-white/10">
              Como tratamos os dados
            </Link>
          </div>
          <p className="mt-6 text-sm text-white/55">O acesso é criado pela Rio X7 para as empresas clientes; não há cadastro aberto.</p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-premium-texto">O que o AVANTE faz</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RECURSOS.map((r) => (
            <li key={r.titulo} className="rounded-xl border border-premium-borda bg-premium-card p-5">
              <h3 className="font-semibold text-premium-texto">{r.titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-premium-secundario">{r.texto}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <div className="rounded-xl border border-premium-borda bg-premium-card p-6">
          <h2 className="text-xl font-semibold tracking-tight text-premium-texto">Integrações com Google e Meta</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-premium-secundario">
            <li>
              <strong className="text-premium-texto">Google Sheets:</strong> o AVANTE lê somente a planilha que o usuário escolhe no seletor do Google
              (permissão <code>drive.file</code>) para transformar novas linhas em leads. Não altera nem apaga a planilha.
            </li>
            <li>
              <strong className="text-premium-texto">WhatsApp Business:</strong> cada empresa conecta o próprio número pela janela oficial da Meta. As
              conversas ficam só na empresa dona do número, e as respostas seguem a janela de atendimento de 24 horas.
            </li>
            <li>Credenciais das integrações ficam cifradas em cofre no servidor e nunca aparecem na tela.</li>
          </ul>
          <p className="mt-4 text-sm text-premium-mudo">
            Detalhes na{' '}
            <Link href="/privacidade" className="text-premium-acento underline">
              Política de Privacidade
            </Link>{' '}
            e nos{' '}
            <Link href="/termos" className="text-premium-acento underline">
              Termos de Uso
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  )
}
