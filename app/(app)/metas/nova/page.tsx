import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarAlvosDeMeta } from '@/lib/dal/metas'
import { lerMes } from '@/lib/utils/periodo'
import { ALVO_EMPRESA, TIPOS_META } from '@/lib/validations/meta'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

import { MetaForm } from '../_components/meta-form'

export const metadata: Metadata = {
  title: 'Nova meta',
}

/** `?alvo=`, `?tipo=` e `?mes=` vêm do botão "Definir meta" da lista. */
export default async function NovaMetaPage({ searchParams }: PageProps<'/metas/nova'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { alvo, tipo, mes: param } = await searchParams
  const mes = lerMes(param)
  const alvos = await listarAlvosDeMeta()
  const alvoInicial = alvos.some((a) => a.valor === alvo) ? String(alvo) : ALVO_EMPRESA
  const tipoInicial = (TIPOS_META as readonly string[]).includes(String(tipo)) ? String(tipo) : TIPOS_META[0]

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium titulo="Nova meta" subtitulo="Uma meta por mês, por tipo (TCV ou MRR), para a empresa e para cada closer."
        voltar={{ href: `/metas?mes=${mes}`, rotulo: 'Metas' }}
      />

      <Secao>
        <MetaForm
          action={criarMetaAction}
          alvos={alvos}
          valoresIniciais={{ alvo: alvoInicial, tipo_meta: tipoInicial, mes }}
          cancelarHref={`/metas?mes=${mes}`}
          rotuloEnviar="Criar meta"
        />
      </Secao>
    </div>
  )
}
