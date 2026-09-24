import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { salvarNegociacaoAction } from '@/lib/actions/negociacoes'
import {
  NEGOCIACAO_ENCERRADA,
  negociacaoEncerrada,
  obterNegociacaoParaEdicao,
  type NegociacaoEdicao,
} from '@/lib/dal/negociacoes'
import { listarServicosAtivos, ordenarServicos } from '@/lib/dal/servicos'
import { formatarDia, formatarMoeda } from '@/lib/utils/formatacao'
import { ROTULO_FORMA_PAGAMENTO, ROTULO_TEMPERATURA } from '@/lib/validations/negociacao'

import { NegociacaoForm } from './_components/negociacao-form'

export const metadata: Metadata = {
  title: 'Negociação',
}

/** 15000 → "15000,00" (o campo aceita o formato brasileiro de volta). */
function valorParaCampo(valor: number | null): string {
  return valor === null ? '' : valor.toFixed(2).replace('.', ',')
}

/**
 * Dados comerciais da negociação: qualificação, proposta e serviços.
 * Aberta: formulário. Ganha/perdida: somente leitura (o banco também recusa).
 * Etapa, dono e motivo de perda mudam só pelo funil. A RLS decide quem abre:
 * closer que tente a negociação de outro recebe 404.
 */
export default async function EditarNegociacaoPage({ params }: PageProps<'/negociacoes/[id]/editar'>) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const negociacao = await obterNegociacaoParaEdicao(id)
  if (!negociacao) notFound()

  const encerrada = negociacaoEncerrada(negociacao)
  const voltar = `/clientes/${negociacao.clienteId}`

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={voltar} className="text-sm text-zinc-500 hover:underline">
          ← {negociacao.clienteNome}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{encerrada ? 'Negociação' : 'Editar negociação'}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
            <PontoEtapa cor={negociacao.etapa.cor} />
            {negociacao.etapa.nome}
          </span>
          <span>· A etapa muda pelo funil.</span>
        </p>
      </div>

      {encerrada ? (
        <>
          <p
            role="note"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          >
            {NEGOCIACAO_ENCERRADA}
          </p>
          <SomenteLeitura negociacao={negociacao} />
        </>
      ) : (
        <Formulario negociacao={negociacao} voltar={voltar} />
      )}
    </div>
  )
}

async function Formulario({ negociacao, voltar }: { negociacao: NegociacaoEdicao; voltar: string }) {
  // Desativados só aparecem se já estão nesta negociação.
  const ativos = await listarServicosAtivos()
  const idsAtivos = new Set(ativos.map((s) => s.id))
  const servicos = ordenarServicos([
    ...ativos,
    ...negociacao.servicos.filter((s) => !idsAtivos.has(s.id)),
  ])

  return (
    <NegociacaoForm
      action={salvarNegociacaoAction.bind(null, negociacao.id, negociacao.clienteId)}
      servicos={servicos}
      cancelarHref={voltar}
      valoresIniciais={{
        valor_estimado: valorParaCampo(negociacao.valorEstimado),
        temperatura: negociacao.temperatura ?? '',
        data_primeira_reuniao: negociacao.dataPrimeiraReuniao ?? '',
        data_proposta: negociacao.dataProposta ?? '',
        objecao_principal: negociacao.objecaoPrincipal ?? '',
        valor_proposta: valorParaCampo(negociacao.valorProposta),
        forma_pagamento: negociacao.formaPagamento ?? '',
        servico_ids: negociacao.servicos.map((s) => s.id),
      }}
    />
  )
}

function SomenteLeitura({ negociacao: n }: { negociacao: NegociacaoEdicao }) {
  const moeda = (v: number | null) => (v === null ? null : formatarMoeda(v))
  const dia = (d: string | null) => (d === null ? null : formatarDia(d))

  const blocos: { titulo: string; itens: [string, React.ReactNode][] }[] = [
    {
      titulo: 'Qualificação',
      itens: [
        ['Valor estimado', moeda(n.valorEstimado)],
        ['Temperatura', n.temperatura && ROTULO_TEMPERATURA[n.temperatura]],
        ['Primeira reunião', dia(n.dataPrimeiraReuniao)],
        ['Data da proposta', dia(n.dataProposta)],
        ['Objeção principal', n.objecaoPrincipal],
      ],
    },
    {
      titulo: 'Proposta',
      itens: [
        ['Valor da proposta', moeda(n.valorProposta)],
        ['Forma de pagamento', n.formaPagamento && ROTULO_FORMA_PAGAMENTO[n.formaPagamento]],
      ],
    },
  ]

  return (
    <div className="space-y-8">
      {blocos.map((b) => (
        <section key={b.titulo} className="space-y-3">
          <h2 className="text-base font-semibold">{b.titulo}</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            {b.itens.map(([rotulo, valor]) => (
              <div key={rotulo} className={rotulo === 'Objeção principal' ? 'sm:col-span-2' : undefined}>
                <dt className="text-sm text-zinc-500">{rotulo}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm">{valor || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Serviços</h2>
        {n.servicos.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum serviço.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {ordenarServicos([...n.servicos]).map((s) => (
              <li
                key={s.id}
                className="rounded bg-zinc-100 px-2 py-1 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {s.nome}
                {!s.ativo && <span className="text-zinc-500"> (desativado)</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
