import { describe, expect, it } from 'vitest'

import { montarLeads, respostasDaLinha } from '../../supabase/functions/_shared/google-sheets'
import { extrairEventosCoexistencia, pedirSincronizacaoApp } from '../../supabase/functions/_shared/whatsapp-cloud'

describe('Planilhas — perguntas e respostas dinâmicas', () => {
  const cab = ['Carimbo de data/hora', 'Nome completo', 'WhatsApp', 'E-mail', 'Qual o orçamento?', 'Observação', 'Observação', '', 'Cidade']
  const m = { nome: 'Nome completo', telefone: 'WhatsApp', email: 'E-mail' }

  it('guarda todas as colunas que não viraram campo do cliente, na ordem, sem as vazias', () => {
    const linha = ['28/10/2026 10:00', 'Lia', '11977770001', 'lia@x.com', 'R$ 5 mil', 'Manhã', 'Tem sócio', 'extra sem título', '  ']
    expect(respostasDaLinha(cab, linha, m)).toEqual([
      { pergunta: 'Carimbo de data/hora', resposta: '28/10/2026 10:00' },
      { pergunta: 'Qual o orçamento?', resposta: 'R$ 5 mil' },
      { pergunta: 'Observação', resposta: 'Manhã' },
      { pergunta: 'Observação', resposta: 'Tem sócio' },
      { pergunta: 'Coluna 8', resposta: 'extra sem título' },
    ])
  })

  it('coluna nova na planilha entra sem configurar nada; linha mais curta que o cabeçalho não quebra', () => {
    expect(respostasDaLinha([...cab, 'Pergunta nova'], ['', 'Lia', '11977770001', '', '', '', '', '', '', 'sim'], m)).toEqual([
      { pergunta: 'Pergunta nova', resposta: 'sim' },
    ])
    expect(respostasDaLinha(cab, ['x'], m)).toEqual([{ pergunta: 'Carimbo de data/hora', resposta: 'x' }])
  })

  it('montarLeads leva as respostas junto do lead (chave estável preservada)', async () => {
    const { leads } = await montarLeads(cab, [{ numero: 2, valores: ['t1', 'Lia', '11977770001', '', 'R$ 5 mil'] }], m, 'Carimbo de data/hora')
    expect(leads[0].chave).toBe('id:t1')
    expect(leads[0].respostas).toEqual([
      { pergunta: 'Carimbo de data/hora', resposta: 't1' },
      { pergunta: 'Qual o orçamento?', resposta: 'R$ 5 mil' },
    ])
  })
})

const webhook = (field: string, value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '630000000000091', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '551143000091', phone_number_id: '530000000000091' }, ...value } }] }],
})

describe('WhatsApp coexistência — webhooks', () => {
  it('eco do app (smb_message_echoes) vira mensagem ENVIADA para o cliente do campo "to"', () => {
    const r = extrairEventosCoexistencia(
      webhook('smb_message_echoes', { message_echoes: [{ from: '551143000091', to: '5511955880001', id: 'wamid.E1', timestamp: '1761652800', type: 'text', text: { body: 'Olá' } }] }),
    )
    expect(r.ecos).toEqual([
      { phoneNumberId: '530000000000091', itens: [{ id: 'wamid.E1', telefone: '5511955880001', da_empresa: true, tipo: 'text', texto: 'Olá', em: '2025-10-28T12:00:00.000Z', status: null }] },
    ])
  })

  it('histórico: quem mandou vem da comparação com o número da empresa; mídia sem conteúdo fica marcada', () => {
    const r = extrairEventosCoexistencia(
      webhook('history', {
        history: [
          {
            metadata: { phase: 1, chunk_order: 2, progress: 55 },
            threads: [
              {
                id: '5511955880002',
                messages: [
                  { from: '5511955880002', id: 'wamid.H1', timestamp: '1750000000', type: 'text', text: { body: 'Quero orçamento' }, history_context: { status: 'READ' } },
                  { from: '551143000091', to: '5511955880002', id: 'wamid.H2', timestamp: '1750000100', type: 'text', text: { body: 'Claro' }, history_context: { status: 'DELIVERED' } },
                  { from: '5511955880002', id: 'wamid.H3', timestamp: '1750000200', type: 'media_placeholder' },
                ],
              },
            ],
          },
        ],
      }),
    )
    expect(r.historico).toHaveLength(1)
    const h = r.historico[0]
    expect(h).toMatchObject({ fase: 1, progresso: 55, recusado: false })
    expect(h.itens.map((i) => [i.id, i.da_empresa, i.tipo, i.status])).toEqual([
      ['wamid.H1', false, 'text', 'READ'],
      ['wamid.H2', true, 'text', 'DELIVERED'],
      ['wamid.H3', false, 'media_placeholder', null],
    ])
  })

  it('empresa que recusou compartilhar o histórico (2593109): registra a recusa, sem mensagens', () => {
    const r = extrairEventosCoexistencia(webhook('history', { history: [{ errors: [{ code: 2593109, title: 'History sync is turned off' }] }] }))
    expect(r.historico).toEqual([{ phoneNumberId: '530000000000091', fase: null, progresso: null, recusado: true, itens: [] }])
  })

  it('contatos do app: adiciona e remove só contatos válidos', () => {
    const r = extrairEventosCoexistencia(
      webhook('smb_app_state_sync', {
        state_sync: [
          { type: 'contact', contact: { full_name: 'Ana App', first_name: 'Ana', phone_number: '5511955880003' }, action: 'add' },
          { type: 'contact', contact: { phone_number: '5511955880004' }, action: 'remove' },
          { type: 'contact', contact: { phone_number: 'xx' }, action: 'add' },
        ],
      }),
    )
    expect(r.contatos[0].itens).toEqual([
      { telefone: '5511955880003', nome: 'Ana App', acao: 'add' },
      { telefone: '5511955880004', nome: null, acao: 'remove' },
    ])
  })

  it('ignora outros objetos e campos (mensagens normais continuam no extrator de sempre)', () => {
    expect(extrairEventosCoexistencia({ object: 'page', entry: [] })).toEqual({ ecos: [], historico: [], contatos: [] })
    expect(extrairEventosCoexistencia(webhook('messages', { messages: [] }))).toEqual({ ecos: [], historico: [], contatos: [] })
  })

  it('pedido de sincronização: POST smb_app_data com o sync_type, devolve o request_id', async () => {
    const chamadas: { url: string; corpo: unknown }[] = []
    const buscar = async (url: string, init?: RequestInit) => {
      chamadas.push({ url, corpo: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ messaging_product: 'whatsapp', request_id: 'req-123' }), { status: 200 })
    }
    expect(await pedirSincronizacaoApp(buscar, { graphUrl: 'https://graph.exemplo/v23.0' }, 'tok', '530000000000091', 'history')).toBe('req-123')
    expect(chamadas).toEqual([{ url: 'https://graph.exemplo/v23.0/530000000000091/smb_app_data', corpo: { messaging_product: 'whatsapp', sync_type: 'history' } }])
  })
})
