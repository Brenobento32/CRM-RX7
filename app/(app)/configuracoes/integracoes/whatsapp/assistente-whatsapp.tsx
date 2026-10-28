'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'

import { Aviso } from '@/components/ui/aviso'
import { botaoPrimarioClass, botaoSecundarioClass, inputClass, labelClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import { concluirWhatsappAction, configWhatsappAction, type SituacaoConexao } from '@/lib/actions/integracoes-oficiais'
import { cadastrarWhatsappNaMeta, type ResultadoCadastroMeta } from '@/lib/integracoes/janelas-provedores'

import { CampoPin, OrientacaoPin, RegistrarNumero } from '../_components/registrar-numero'
import { SeletorDestino, type Destino, type OpcoesDestino } from '../_components/seletor-destino'

const WHATSAPP_MANAGER = 'https://business.facebook.com/wa/manage/home/'

type Fim = { tipo: 'conexao'; conexao: SituacaoConexao } | Exclude<ResultadoCadastroMeta, { tipo: 'concluido' }>

/**
 * Destino primeiro (funil, etapa, responsável), depois o PIN e o cadastro
 * oficial da Meta (Embedded Signup v4). O PIN é pedido ANTES de abrir a janela
 * porque o código da Meta vale só ~30 s: assim tudo é concluído numa ida ao
 * servidor. O navegador só recebe o código de uso único e os IDs públicos; a
 * troca pelo token, o registro do número e a gravação no cofre são no servidor.
 */
export function AssistenteWhatsapp({ opcoes, responsaveis }: { opcoes: OpcoesDestino; responsaveis: { id: string; nome: string }[] }) {
  const [destino, setDestino] = useState<Destino>({
    funilId: opcoes.funis[0]?.id ?? '',
    etapaId: opcoes.funis[0]?.etapas.find((e) => e.inicial)?.id ?? opcoes.funis[0]?.etapas[0]?.id ?? '',
    responsavelId: '',
  })
  const [nome, setNome] = useState('WhatsApp comercial')
  const [ciente, setCiente] = useState(false)
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [fim, setFim] = useState<Fim | null>(null)
  const [pendente, iniciar] = useTransition()
  // Configuração pública do app da Meta carregada ANTES do clique: a janela da
  // Meta precisa abrir no próprio clique, senão o navegador a bloqueia como pop-up.
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof configWhatsappAction>> | null>(null)
  useEffect(() => {
    configWhatsappAction().then(setCfg, () => setCfg({ ok: false, codigo: 'indisponivel', mensagem: 'O serviço de integrações não respondeu.' }))
  }, [])

  const pinOk = pin === '' || pin.length === 6
  const pronto = Boolean(destino.funilId && destino.etapaId && destino.responsavelId && ciente && cfg && pinOk)

  const conectar = () =>
    iniciar(async () => {
      setErro(null)
      try {
        if (!cfg) return
        if (!cfg.ok) return setErro(cfg.mensagem)
        if (!cfg.disponivel) return setErro('O app oficial da Meta ainda não foi configurado na plataforma. Fale com o suporte da Rio X7.')
        const r = await cadastrarWhatsappNaMeta(cfg)
        if (r.tipo !== 'concluido') return setFim(r)
        const c = await concluirWhatsappAction({
          ...r.cadastro,
          // Coexistência (número do app WhatsApp Business) não usa PIN.
          pin: r.cadastro.modo === 'cloud_api' && pin ? pin : undefined,
          nome,
          funil: destino.funilId,
          etapa: destino.etapaId,
          responsavel: destino.responsavelId,
        })
        setPin('')
        if (!c.ok) return setErro(c.mensagem)
        setFim({ tipo: 'conexao', conexao: c })
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível abrir o cadastro da Meta.')
      }
    })

  if (fim) return <Resultado fim={fim} aoRecomecar={() => setFim(null)} aoConectar={(c) => setFim({ tipo: 'conexao', conexao: c })} />

  return (
    <div className="space-y-5">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <Secao titulo="1. Destino dos leads" descricao="Contato novo que escrever para o número entra aqui. Quem já é cliente desta empresa tem a conversa vinculada, sem criar nem mover negociação.">
        <div className="space-y-4 pb-5">
          <label className="block text-sm">
            <span className={labelClass}>Nome da conexão</span>
            <input className={inputClass} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
          </label>
          <SeletorDestino opcoes={opcoes} responsaveis={responsaveis} inicial={destino} onChange={setDestino} />
        </div>
      </Secao>

      <Secao titulo="2. Custos e política de envio">
        <div className="space-y-3 pb-5 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-premium-secundario">
            <li>O número começa em <strong>Somente envios gratuitos</strong>: a equipe só responde por texto dentro de 24 h da última mensagem do cliente.</li>
            <li>
              O AVANTE usa até <strong>950 respostas estimadas por número por mês</strong> (a Meta concede 1.000 mensagens de atendimento gratuitas; a margem cobre diferenças de
              contagem). Ao atingir, as respostas param até o mês seguinte.
            </li>
            <li>Mensagens fora da janela (que exigiriam modelo pago), modelos, marketing, automações e disparos em massa ficam bloqueados no servidor.</li>
            <li>Se a Meta indicar cobrança em alguma mensagem, o número é bloqueado automaticamente até o Administrador revisar.</li>
            <li>
              A Meta pode pedir uma <strong>forma de pagamento</strong> na conta do WhatsApp Business (no WhatsApp Manager). O AVANTE não cadastra nem altera formas de
              pagamento: isso é feito pela empresa, direto na Meta.
            </li>
            <li>Os preços e regras são da Meta e podem mudar: o AVANTE reduz o risco, mas não garante custo zero.</li>
          </ul>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
            <span>Entendi a política de envio e de custos.</span>
          </label>
        </div>
      </Secao>

      <Secao titulo="3. Verificação do número" descricao="A Meta exige registrar o número novo com um PIN de 6 números (verificação em duas etapas).">
        <div className="space-y-3 pb-5">
          <OrientacaoPin />
          <CampoPin valor={pin} onChange={setPin} />
          <p className="text-xs text-premium-mudo">
            Vai conectar o número que já usa no app WhatsApp Business? Ele não precisa de PIN: a própria janela da Meta pede a confirmação pelo celular. Sem PIN, um número
            novo fica como &quot;Falta registrar&quot; e você termina o registro depois, no painel.
          </p>
          {!pinOk && <p className="text-xs text-red-700 dark:text-red-300">O PIN tem 6 números.</p>}
        </div>
      </Secao>

      <Secao titulo="4. Cadastro na Meta" descricao="Abre a janela oficial da Meta: entre com a conta do Facebook da empresa, escolha (ou crie) a conta do WhatsApp Business e o número.">
        <div className="pb-5">
          <button type="button" className={botaoPrimarioClass} disabled={pendente || !pronto} onClick={conectar}>
            {pendente ? 'Aguardando a Meta…' : 'Conectar WhatsApp'}
          </button>
        </div>
      </Secao>
    </div>
  )
}

function Etapas({ registrado, coexistencia }: { registrado: boolean; coexistencia: boolean }) {
  const itens = [
    { texto: 'Empresa autorizada na Meta', ok: true },
    { texto: 'Número escolhido e confirmado', ok: true },
    { texto: coexistencia ? 'Número do app WhatsApp Business (sem registro)' : 'Número registrado na Cloud API (PIN)', ok: registrado },
    { texto: 'Funil, etapa e responsável definidos', ok: true },
  ]
  return (
    <ul className="space-y-1 text-sm">
      {itens.map((i) => (
        <li key={i.texto} className={i.ok ? 'text-premium-texto' : 'text-amber-700 dark:text-amber-300'}>
          {i.ok ? '✓' : '•'} {i.texto}
          {!i.ok && ' — falta'}
        </li>
      ))}
    </ul>
  )
}

function Resultado({ fim, aoRecomecar, aoConectar }: { fim: Fim; aoRecomecar: () => void; aoConectar: (c: SituacaoConexao) => void }) {
  const tentarDeNovo = (
    <button type="button" className={botaoSecundarioClass} onClick={aoRecomecar}>
      Tentar de novo
    </button>
  )
  if (fim.tipo !== 'conexao') {
    const texto = {
      sem_numero: 'A Meta concluiu sem um número escolhido. Nada foi conectado: abra a janela de novo e escolha (ou adicione) o número.',
      cancelado: 'O cadastro foi cancelado na janela da Meta. Nada foi conectado.',
      nao_suportado: 'A Meta concluiu um tipo de conexão que o AVANTE não usa. Escolha um número novo ou o número do app WhatsApp Business.',
      erro: fim.tipo === 'erro' ? fim.mensagem : '',
    }[fim.tipo]
    return (
      <Secao titulo="Conexão não concluída">
        <div className="space-y-3 pb-5 text-sm">
          <Aviso tom={fim.tipo === 'erro' ? 'erro' : 'alerta'}>{texto}</Aviso>
          <div className="flex flex-wrap gap-2">{tentarDeNovo}</div>
        </div>
      </Secao>
    )
  }

  const c = fim.conexao
  const coexistencia = c.modo === 'coexistencia'
  const rotulo = `${c.numeroExibicao ?? 'Número'}${c.nomeVerificado ? ` (${c.nomeVerificado})` : ''}`
  if (c.situacao === 'pendente_registro') {
    return (
      <Secao titulo="Falta uma etapa">
        <div className="space-y-3 pb-5 text-sm">
          <Aviso tom="alerta">
            {rotulo} foi autorizado, mas a Meta ainda não confirmou o registro. {c.pendencia ?? ''}
          </Aviso>
          <Etapas registrado={false} coexistencia={false} />
          <RegistrarNumero numeroId={c.numero} aoConectar={() => aoConectar({ ...c, situacao: 'conectado', pendencia: undefined })} />
          <Link href="/configuracoes/integracoes#whatsapp-oficial" className={botaoSecundarioClass}>
            Terminar depois
          </Link>
        </div>
      </Secao>
    )
  }
  return (
    <Secao titulo="Número conectado">
      <div className="space-y-3 pb-5 text-sm">
        <Aviso tom="sucesso">{rotulo} pronto para uso em &quot;Somente envios gratuitos&quot;.</Aviso>
        <Etapas registrado coexistencia={coexistencia} />
        {coexistencia && <p className="text-premium-secundario">O número continua funcionando no app WhatsApp Business do celular; as conversas novas também aparecem no AVANTE.</p>}
        <p className="text-premium-secundario">Quem escrever para este número vira lead no destino escolhido. As conversas aparecem em Conversas, para quem atende o cliente.</p>
        <Aviso tom="info">
          Se a Meta pedir uma forma de pagamento para a conta do WhatsApp Business, cadastre-a no{' '}
          <a href={WHATSAPP_MANAGER} target="_blank" rel="noopener noreferrer" className="underline">
            WhatsApp Manager
          </a>
          . O AVANTE não cadastra pagamentos e continua bloqueando envios que podem ser cobrados.
        </Aviso>
        <div className="flex flex-wrap gap-2">
          <Link href="/configuracoes/integracoes#whatsapp-oficial" className={botaoPrimarioClass}>
            Ver em Integrações
          </Link>
        </div>
      </div>
    </Secao>
  )
}
