'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { Aviso } from '@/components/ui/aviso'
import { ajudaClass, botaoPrimarioClass, botaoSecundarioClass, inputClass, labelClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import {
  acessoSeletorAction,
  conectarPlanilhaAction,
  iniciarGoogleAction,
  lerColunasAction,
  lerPlanilhaAction,
  type Aba,
  type ResumoSincronizacao,
} from '@/lib/actions/integracoes-oficiais'
import { escolherPlanilhaNoGoogle } from '@/lib/integracoes/janelas-provedores'

import { SeletorDestino, type Destino, type OpcoesDestino } from '../_components/seletor-destino'

type Campo = 'nome' | 'telefone' | 'email' | 'empresa' | 'meta_lead_id'
const CAMPOS: { campo: Campo; rotulo: string }[] = [
  { campo: 'nome', rotulo: 'Nome' },
  { campo: 'telefone', rotulo: 'Telefone / WhatsApp' },
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'empresa', rotulo: 'Empresa' },
  { campo: 'meta_lead_id', rotulo: 'ID do lead Meta (Lead Ads) — opcional' },
]

type Planilha = { planilhaId: string; titulo: string; abas: Aba[] }
type Colunas = { cabecalho: string[]; amostra: string[][] }

/**
 * Assistente: conta Google → link → aba → colunas → destino → conectar.
 * Cada passo chama o servidor; nenhum token fica guardado no navegador.
 */
export function AssistentePlanilha({
  contas,
  contaInicial,
  reconectar,
  opcoes,
  responsaveis,
}: {
  contas: { id: string; email: string; comErro: boolean }[]
  contaInicial: string | null
  reconectar: boolean
  opcoes: OpcoesDestino
  responsaveis: { id: string; nome: string }[]
}) {
  const [conta, setConta] = useState(contaInicial && contas.some((c) => c.id === contaInicial) ? contaInicial : (contas[0]?.id ?? ''))
  const [link, setLink] = useState('')
  const [planilha, setPlanilha] = useState<Planilha | null>(null)
  const [precisaAutorizar, setPrecisaAutorizar] = useState<string | null>(null)
  const [abaId, setAbaId] = useState<number | null>(null)
  const [linhaCabecalho, setLinhaCabecalho] = useState(1)
  const [colunas, setColunas] = useState<Colunas | null>(null)
  const [mapa, setMapa] = useState<Partial<Record<Campo, string>>>({})
  const [chave, setChave] = useState<string>('')
  const [importar, setImportar] = useState(true)
  const [nome, setNome] = useState('')
  const [destino, setDestino] = useState<Destino>({ funilId: opcoes.funis[0]?.id ?? '', etapaId: opcoes.funis[0]?.etapas.find((e) => e.inicial)?.id ?? opcoes.funis[0]?.etapas[0]?.id ?? '', responsavelId: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<ResumoSincronizacao | null>(null)
  const [pendente, iniciar] = useTransition()

  const aba = planilha?.abas.find((a) => a.id === abaId) ?? null
  const passo = (fn: () => Promise<void>) =>
    iniciar(async () => {
      setErro(null)
      try {
        await fn()
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.')
      }
    })

  const conectarConta = () =>
    passo(async () => {
      const r = await iniciarGoogleAction()
      if (!r.ok) return setErro(r.mensagem)
      window.location.assign(r.url)
    })

  const buscarPlanilha = (id?: string) =>
    passo(async () => {
      setPlanilha(null)
      setColunas(null)
      const r = await lerPlanilhaAction(conta, id ?? link)
      if (!r.ok) {
        if (r.codigo === 'autorizar_arquivo') {
          setPrecisaAutorizar(r.planilhaId ?? null)
          return
        }
        return setErro(r.mensagem)
      }
      setPrecisaAutorizar(null)
      setPlanilha({ planilhaId: r.planilhaId, titulo: r.titulo, abas: r.abas })
      setAbaId(r.abaSugerida !== null && r.abas.some((a) => a.id === r.abaSugerida) ? r.abaSugerida : (r.abas[0]?.id ?? null))
      setNome((n) => n || r.titulo.slice(0, 80))
    })

  const abrirSeletor = () =>
    passo(async () => {
      const acesso = await acessoSeletorAction(conta)
      if (!acesso.ok) return setErro(acesso.mensagem)
      const escolhida = await escolherPlanilhaNoGoogle(acesso, precisaAutorizar)
      if (!escolhida) return setErro('Nenhuma planilha escolhida no Google.')
      setLink(`https://docs.google.com/spreadsheets/d/${escolhida}/edit`)
      const r = await lerPlanilhaAction(conta, escolhida)
      if (!r.ok) return setErro(r.mensagem)
      setPrecisaAutorizar(null)
      setPlanilha({ planilhaId: r.planilhaId, titulo: r.titulo, abas: r.abas })
      setAbaId(r.abas[0]?.id ?? null)
      setNome((n) => n || r.titulo.slice(0, 80))
    })

  const lerColunas = () =>
    passo(async () => {
      if (!planilha || !aba) return
      const r = await lerColunasAction(conta, planilha.planilhaId, aba.titulo, linhaCabecalho)
      if (!r.ok) return setErro(r.mensagem)
      setColunas({ cabecalho: r.cabecalho, amostra: r.amostra })
      setMapa(r.mapeamento as Partial<Record<Campo, string>>)
      setChave(r.chave ?? '')
    })

  const conectar = () =>
    passo(async () => {
      if (!planilha || !aba) return
      const r = await conectarPlanilhaAction({
        contaId: conta,
        planilhaId: planilha.planilhaId,
        planilhaNome: planilha.titulo,
        abaId: aba.id,
        abaNome: aba.titulo,
        linhaCabecalho,
        mapeamento: mapa,
        colunaChave: chave || null,
        importarExistentes: importar,
        nome,
        funilId: destino.funilId,
        etapaId: destino.etapaId,
        responsavelId: destino.responsavelId,
      })
      if (!r.ok) return setErro(r.mensagem)
      setFeito(r.resumo ?? { ok: true, emAndamento: true })
    })

  if (feito) {
    return (
      <Secao titulo="Planilha conectada">
        <div className="space-y-3 pb-5 text-sm">
          {feito.ok ? (
            <Aviso tom="sucesso">
              Primeira sincronização concluída: {feito.importadas ?? 0} oportunidade(s) criada(s)
              {feito.novas_oportunidades ? ` (${feito.novas_oportunidades} para clientes que já existiam)` : ''}, {feito.existentes ?? 0} com negociação aberta
              reaproveitada
              {feito.ignoradas_inicio ? `, ${feito.ignoradas_inicio} linha(s) antigas ignoradas (só entram as novas)` : ''}
              {feito.invalidas ? `, ${feito.invalidas} sem telefone/e-mail válido` : ''}.
            </Aviso>
          ) : (
            <Aviso tom="alerta">A conexão foi salva, mas a primeira leitura falhou: {feito.erro}. O AVANTE tenta de novo automaticamente.</Aviso>
          )}
          <p className="text-premium-secundario">A partir de agora, a planilha é lida automaticamente a cada 10 minutos. Você pode pausar, sincronizar na hora ou mudar o destino em Integrações.</p>
          <Link href="/configuracoes/integracoes#google-sheets" className={botaoPrimarioClass}>
            Ver em Integrações
          </Link>
        </div>
      </Secao>
    )
  }

  const telefoneOuEmail = Boolean(mapa.telefone || mapa.email)
  const pronto = Boolean(planilha && aba && colunas && telefoneOuEmail && destino.funilId && destino.etapaId && destino.responsavelId && nome.trim().length >= 2)

  return (
    <div className="space-y-5">
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <Secao titulo="1. Conta Google" descricao="O AVANTE pede só: seu e-mail e acesso aos arquivos que você escolher. Ele não vê o resto do seu Google Drive.">
        <div className="space-y-3 pb-5">
          {contas.length > 0 && (
            <label className="block text-sm">
              <span className={labelClass}>Conta conectada</span>
              <select className={inputClass} value={conta} onChange={(e) => setConta(e.target.value)}>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.email}
                    {c.comErro ? ' (reconectar)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {reconectar && <Aviso tom="alerta">Para reconectar, entre de novo com a mesma conta Google: as planilhas dela voltam a sincronizar.</Aviso>}
          <button type="button" className={contas.length ? botaoSecundarioClass : botaoPrimarioClass} disabled={pendente} onClick={conectarConta}>
            {contas.length ? 'Conectar outra conta (ou reconectar)' : 'Conectar conta Google'}
          </button>
        </div>
      </Secao>

      {conta && (
        <Secao titulo="2. Planilha" descricao="Cole o link da planilha. Se ela for privada, o Google pede para você escolher o arquivo uma vez — só o link não libera o acesso.">
          <div className="space-y-3 pb-5">
            <label className="block text-sm">
              <span className={labelClass}>Link da planilha</span>
              <input className={inputClass} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" inputMode="url" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={botaoPrimarioClass} disabled={pendente || !link.trim()} onClick={() => buscarPlanilha()}>
                {pendente ? 'Buscando…' : 'Buscar planilha'}
              </button>
              <button type="button" className={botaoSecundarioClass} disabled={pendente} onClick={abrirSeletor}>
                Escolher no Google Drive
              </button>
            </div>
            {precisaAutorizar && (
              <Aviso tom="alerta">
                O Google ainda não liberou esta planilha para o AVANTE. Clique em <strong>Escolher no Google Drive</strong> e selecione a mesma planilha: isso libera só este arquivo.
              </Aviso>
            )}
            {planilha && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className={labelClass}>Aba ({planilha.titulo})</span>
                  <select className={inputClass} value={abaId ?? ''} onChange={(e) => (setAbaId(Number(e.target.value)), setColunas(null))}>
                    {planilha.abas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.titulo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className={labelClass}>Linha do cabeçalho</span>
                  <input type="number" min={1} max={50} className={inputClass} value={linhaCabecalho} onChange={(e) => (setLinhaCabecalho(Math.min(50, Math.max(1, Number(e.target.value) || 1))), setColunas(null))} />
                  <span className={ajudaClass}>A linha com os nomes das colunas (normalmente a 1).</span>
                </label>
                <div className="sm:col-span-2">
                  <button type="button" className={botaoSecundarioClass} disabled={pendente || !aba} onClick={lerColunas}>
                    {pendente ? 'Lendo…' : 'Ler colunas'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Secao>
      )}

      {colunas && (
        <Secao titulo="3. Colunas" descricao="Confirme qual coluna vira cada campo do lead. Telefone ou e-mail é obrigatório.">
          <div className="space-y-4 pb-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPOS.map(({ campo, rotulo }) => (
                <label key={campo} className="block text-sm">
                  <span className={labelClass}>{rotulo}</span>
                  <select className={inputClass} value={mapa[campo] ?? ''} onChange={(e) => setMapa((m) => ({ ...m, [campo]: e.target.value || undefined }))}>
                    <option value="">— não usar —</option>
                    {colunas.cabecalho.filter(Boolean).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="block text-sm sm:col-span-2">
                <span className={labelClass}>Coluna identificadora (opcional, recomendada)</span>
                <select className={inputClass} value={chave} onChange={(e) => setChave(e.target.value)}>
                  <option value="">— nenhuma: usar o próprio contato —</option>
                  {colunas.cabecalho.filter(Boolean).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className={ajudaClass}>
                  Um ID ou o carimbo de data/hora do formulário. É ela que garante que cada linha seja reconhecida mesmo depois de reordenar, inserir ou apagar linhas.
                  Sem ela, o AVANTE reconhece a linha pelo próprio contato (telefone, e-mail e nome): linhas iguais contam como uma só, e uma linha editada (ex.: nome
                  corrigido) é vista como nova — mas o contato continua o mesmo cliente e, se ele já tem negociação aberta no funil de destino, ela é reaproveitada, sem
                  duplicar. O AVANTE nunca escreve na planilha.
                </span>
              </label>
            </div>
            {!telefoneOuEmail && <p className="text-sm text-red-700 dark:text-red-300">Escolha a coluna de Telefone ou de E-mail.</p>}
            {!chave && (
              <Aviso tom="alerta">
                Sem coluna identificadora, a garantia contra duplicidade depende do contato: use uma coluna de ID ou de data/hora se a planilha tiver.
              </Aviso>
            )}
            {mapa.meta_lead_id && (
              <p className={ajudaClass}>
                Use o ID do lead só se a planilha for alimentada pelos formulários nativos da Meta (Lead Ads). Ele permite devolver as etapas do funil para a Meta
                (Conversões do CRM); valores que não forem um ID válido são ignorados.
              </p>
            )}
            {colunas.amostra.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-premium-borda">
                <table className="w-full text-left text-xs">
                  <thead className="bg-premium-bg text-premium-mudo">
                    <tr>
                      {colunas.cabecalho.map((h, i) => (
                        <th key={i} className="px-2 py-1.5 font-medium whitespace-nowrap">
                          {h || `(coluna ${i + 1})`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {colunas.amostra.map((l, i) => (
                      <tr key={i} className="border-t border-premium-borda-suave">
                        {colunas.cabecalho.map((_, j) => (
                          <td key={j} className="px-2 py-1.5 whitespace-nowrap">
                            {l[j] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Secao>
      )}

      {colunas && (
        <Secao titulo="4. Destino dos leads" descricao="Só aparecem os funis e etapas desta empresa. Você pode mudar depois; os leads que já entraram não são movidos.">
          <div className="space-y-4 pb-5">
            <label className="block text-sm">
              <span className={labelClass}>Nome da conexão</span>
              <input className={inputClass} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Formulário do site" />
            </label>
            <SeletorDestino opcoes={opcoes} responsaveis={responsaveis} inicial={destino} onChange={setDestino} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={importar} onChange={(e) => setImportar(e.target.checked)} />
              <span>
                Importar também as linhas que já estão na planilha
                <span className={`block ${ajudaClass}`}>Desmarcado: só as linhas novas, a partir de agora. Contatos que já são clientes não são duplicados.</span>
              </span>
            </label>
            <button type="button" className={botaoPrimarioClass} disabled={pendente || !pronto} onClick={conectar}>
              {pendente ? 'Conectando…' : 'Conectar e sincronizar'}
            </button>
          </div>
        </Secao>
      )}
    </div>
  )
}
