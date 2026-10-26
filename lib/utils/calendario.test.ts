import { describe, expect, it } from 'vitest'

import {
  ALTURA_HORA_PX,
  geometriaEvento,
  VISAO_PADRAO,
  VISOES,
  agruparPorDia,
  ehHoje,
  hrefAgenda,
  janelaDaVisao,
  minutosNoDia,
  minutosParaHora,
  navegar,
  novoInicioAoArrastar,
  organizarSobrepostos,
  segundaDaSemana,
  tituloPeriodo,
  visaoPadraoInicial,
  visaoValida,
  type IntervaloComId,
} from '@/lib/utils/calendario'
import { instanteSaoPaulo } from '@/lib/utils/formatacao'

function iso(dia: string, hora: string) {
  return instanteSaoPaulo(dia, hora).toISOString()
}

describe('visaoValida', () => {
  it('aceita só as quatro visões conhecidas (sem quinzena, removida na N3.1)', () => {
    expect(visaoValida('dia')).toBe(true)
    expect(visaoValida('semana')).toBe(true)
    expect(visaoValida('mes')).toBe(true)
    expect(visaoValida('lista')).toBe(true)
    expect(visaoValida('quinzena')).toBe(false)
    expect(visaoValida('ano')).toBe(false)
    expect(visaoValida(undefined)).toBe(false)
  })

  it('VISOES não lista mais quinzena', () => {
    expect(VISOES).toEqual(['dia', 'semana', 'mes', 'lista'])
  })
})

describe('visaoPadraoInicial', () => {
  it('celular (iPhone/Android com "Mobile") cai em Dia', () => {
    expect(visaoPadraoInicial('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('dia')
    expect(visaoPadraoInicial('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('dia')
  })

  it('desktop e tablets ambíguos caem no padrão (Semana)', () => {
    expect(visaoPadraoInicial('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe('semana')
    expect(visaoPadraoInicial('')).toBe('semana')
    // Android sem "Mobile" no UA é tablet — trata como desktop.
    expect(visaoPadraoInicial('Mozilla/5.0 (Linux; Android 14; SM-X200) Safari/537.36')).toBe('semana')
  })
})

describe('segundaDaSemana', () => {
  it('recua até a segunda-feira da mesma semana ISO', () => {
    // 2026-09-23 é uma quarta-feira.
    expect(segundaDaSemana('2026-09-23')).toBe('2026-09-21')
    // domingo cai na semana anterior (termina nela, não começa).
    expect(segundaDaSemana('2026-09-27')).toBe('2026-09-21')
    // já é segunda: fica nela mesma.
    expect(segundaDaSemana('2026-09-21')).toBe('2026-09-21')
  })
})

describe('janelaDaVisao', () => {
  it('dia: janela de um único dia', () => {
    const j = janelaDaVisao('dia', '2026-09-23')
    expect(j).toEqual({ inicio: '2026-09-23', fim: '2026-09-23', dias: ['2026-09-23'] })
  })

  it('semana: segunda a domingo, 7 dias', () => {
    const j = janelaDaVisao('semana', '2026-09-23')
    expect(j.inicio).toBe('2026-09-21')
    expect(j.fim).toBe('2026-09-27')
    expect(j.dias).toHaveLength(7)
    expect(j.dias[0]).toBe('2026-09-21')
    expect(j.dias.at(-1)).toBe('2026-09-27')
  })

  it('mes: grade de 42 dias alinhada à segunda, cobrindo o mês inteiro', () => {
    const j = janelaDaVisao('mes', '2026-09-23')
    expect(j.dias).toHaveLength(42)
    // 2026-09-01 é terça; a grade começa na segunda anterior (31/08).
    expect(j.inicio).toBe('2026-08-31')
    // O mês inteiro (01 a 30/09) precisa estar contido na grade.
    expect(j.dias).toContain('2026-09-01')
    expect(j.dias).toContain('2026-09-30')
  })

  it('lista: janela aberta de DIAS_LISTA dias a partir da referência', () => {
    const j = janelaDaVisao('lista', '2026-09-23')
    expect(j.inicio).toBe('2026-09-23')
    expect(j.fim).toBe('2026-10-22')
    expect(j.dias).toEqual([])
  })
})

describe('navegar', () => {
  it('dia anda 1 dia, semana 7', () => {
    expect(navegar('dia', '2026-09-23', 1)).toBe('2026-09-24')
    expect(navegar('dia', '2026-09-23', -1)).toBe('2026-09-22')
    expect(navegar('semana', '2026-09-23', 1)).toBe('2026-09-30')
    expect(navegar('semana', '2026-09-23', -1)).toBe('2026-09-16')
  })

  it('mes preserva o dia do mês quando possível', () => {
    expect(navegar('mes', '2026-09-23', 1)).toBe('2026-10-23')
    expect(navegar('mes', '2026-01-31', 1)).toBe('2026-02-28')
  })
})

describe('tituloPeriodo', () => {
  it('semana no mesmo mês some o mês repetido no início', () => {
    const j = janelaDaVisao('semana', '2026-09-23')
    expect(tituloPeriodo('semana', '2026-09-23', j)).toBe('21 – 27 de setembro')
  })

  it('mes usa o mês da data de referência, não da grade (que pode começar no mês anterior)', () => {
    const j = janelaDaVisao('mes', '2026-09-23')
    expect(tituloPeriodo('mes', '2026-09-23', j)).toBe('setembro de 2026')
  })
})

describe('hrefAgenda', () => {
  const padrao = { visao: VISAO_PADRAO, hoje: '2026-09-28' }

  it('omite visão e dia quando batem com o padrão', () => {
    expect(hrefAgenda({ visao: 'semana', dia: '2026-09-28' }, padrao)).toBe('/agenda')
  })

  it('inclui só o que diverge do padrão', () => {
    expect(hrefAgenda({ visao: 'mes', dia: '2026-09-28' }, padrao)).toBe('/agenda?visao=mes')
    expect(hrefAgenda({ visao: 'semana', dia: '2026-09-23' }, padrao)).toBe('/agenda?dia=2026-09-23')
  })

  it('inclui usuario e evento quando presentes', () => {
    expect(hrefAgenda({ visao: 'semana', dia: '2026-09-28', usuario: 'u1', evento: 'e1' }, padrao)).toBe(
      '/agenda?usuario=u1&evento=e1',
    )
  })
})

describe('minutosNoDia', () => {
  it('meia-noite é 0 e 23:59 é 1439', () => {
    expect(minutosNoDia(iso('2026-09-23', '00:00'), '2026-09-23')).toBe(0)
    expect(minutosNoDia(iso('2026-09-23', '23:59'), '2026-09-23')).toBe(1439)
  })

  it('evento que termina na meia-noite seguinte vira 1440 (fim da grade)', () => {
    expect(minutosNoDia(iso('2026-09-24', '00:00'), '2026-09-23')).toBe(1440)
  })
})

describe('organizarSobrepostos', () => {
  it('eventos sem sobreposição ficam todos na coluna 0 de 1', () => {
    const eventos: IntervaloComId[] = [
      { id: 'a', inicio: iso('2026-09-23', '09:00'), fim: iso('2026-09-23', '10:00') },
      { id: 'b', inicio: iso('2026-09-23', '10:00'), fim: iso('2026-09-23', '11:00') },
    ]
    const leiaute = organizarSobrepostos(eventos)
    expect(leiaute.every((l) => l.coluna === 0 && l.colunas === 1)).toBe(true)
  })

  it('dois eventos sobrepostos dividem em 2 colunas', () => {
    const eventos: IntervaloComId[] = [
      { id: 'a', inicio: iso('2026-09-23', '09:00'), fim: iso('2026-09-23', '10:00') },
      { id: 'b', inicio: iso('2026-09-23', '09:30'), fim: iso('2026-09-23', '10:30') },
    ]
    const leiaute = organizarSobrepostos(eventos)
    const porId = new Map(leiaute.map((l) => [l.id, l]))
    expect(porId.get('a')!.colunas).toBe(2)
    expect(porId.get('b')!.colunas).toBe(2)
    expect(porId.get('a')!.coluna).not.toBe(porId.get('b')!.coluna)
  })

  it('terceiro evento que só sobrepõe o primeiro reaproveita a coluna livre do segundo', () => {
    const eventos: IntervaloComId[] = [
      { id: 'a', inicio: iso('2026-09-23', '09:00'), fim: iso('2026-09-23', '11:00') },
      { id: 'b', inicio: iso('2026-09-23', '09:00'), fim: iso('2026-09-23', '10:00') },
      { id: 'c', inicio: iso('2026-09-23', '10:00'), fim: iso('2026-09-23', '11:00') },
    ]
    const leiaute = organizarSobrepostos(eventos)
    const porId = new Map(leiaute.map((l) => [l.id, l]))
    // a ocupa uma coluna do início ao fim; b e c, que não se sobrepõem entre si,
    // dividem a outra coluna do cluster (2 colunas ao todo, não 3).
    expect(porId.get('a')!.colunas).toBe(2)
    expect(porId.get('b')!.coluna).toBe(porId.get('c')!.coluna)
    expect(porId.get('a')!.coluna).not.toBe(porId.get('b')!.coluna)
  })

  it('clusters independentes (sem sobreposição entre si) não se contaminam', () => {
    const eventos: IntervaloComId[] = [
      { id: 'a', inicio: iso('2026-09-23', '09:00'), fim: iso('2026-09-23', '10:00') },
      { id: 'b', inicio: iso('2026-09-23', '09:00'), fim: iso('2026-09-23', '10:00') },
      { id: 'c', inicio: iso('2026-09-23', '14:00'), fim: iso('2026-09-23', '15:00') },
    ]
    const leiaute = organizarSobrepostos(eventos)
    const porId = new Map(leiaute.map((l) => [l.id, l]))
    expect(porId.get('c')!.colunas).toBe(1)
    expect(porId.get('a')!.colunas).toBe(2)
  })
})

describe('agruparPorDia', () => {
  it('agrupa pelo dia local (São Paulo) do início', () => {
    const eventos = [
      { id: 'a', inicio: iso('2026-09-23', '09:00') },
      { id: 'b', inicio: iso('2026-09-23', '18:00') },
      { id: 'c', inicio: iso('2026-09-24', '08:00') },
    ]
    const mapa = agruparPorDia(eventos)
    expect(mapa.get('2026-09-23')).toHaveLength(2)
    expect(mapa.get('2026-09-24')).toHaveLength(1)
  })
})

describe('ehHoje', () => {
  it('compara com a data atual de São Paulo', () => {
    expect(ehHoje('1999-01-01')).toBe(false)
  })
})

describe('novoInicioAoArrastar', () => {
  const ALTURA_HORA_PX = 48 // 1 hora = 48px na grade

  it('encaixa em 15 minutos: 09:07 vira 09:00, 09:08 vira 09:15', () => {
    // 9:00 = 540 min. +7min de arraste (7/60*48=5.6px) ainda arredonda pra 540.
    expect(novoInicioAoArrastar(540, 60, (7 / 60) * ALTURA_HORA_PX, ALTURA_HORA_PX)).toBe(540)
    // +8min (8/60*48=6.4px) já passa da metade de 15min e sobe pro próximo quarto.
    expect(novoInicioAoArrastar(540, 60, (8 / 60) * ALTURA_HORA_PX, ALTURA_HORA_PX)).toBe(555)
  })

  it('sem deslocamento, mantém o horário original (já é múltiplo de 15)', () => {
    expect(novoInicioAoArrastar(540, 30, 0, ALTURA_HORA_PX)).toBe(540)
  })

  it('preserva a duração: ela não entra no cálculo do novo início, só limita o teto', () => {
    // Arrastar 2h pra frente (2*48=96px) desloca o início igual, não importa a duração,
    // desde que o resultado caiba no dia.
    expect(novoInicioAoArrastar(540, 15, 2 * ALTURA_HORA_PX, ALTURA_HORA_PX)).toBe(660)
    expect(novoInicioAoArrastar(540, 120, 2 * ALTURA_HORA_PX, ALTURA_HORA_PX)).toBe(660)
  })

  it('limite do dia: nunca cai antes da meia-noite', () => {
    expect(novoInicioAoArrastar(30, 60, -10 * ALTURA_HORA_PX, ALTURA_HORA_PX)).toBe(0)
  })

  it('limite do dia: nunca deixa o fim passar da meia-noite seguinte', () => {
    // Evento de 60min tentando ir pra 23:30 (1410min) — teto é 1440-60=1380 (23:00).
    expect(novoInicioAoArrastar(1000, 60, 20 * ALTURA_HORA_PX, ALTURA_HORA_PX)).toBe(1380)
  })

  it('evento de duração maior tem teto mais cedo', () => {
    // Evento de 3h (180min): teto é 1440-180=1260 (21:00), mesmo tentando ir mais longe.
    expect(novoInicioAoArrastar(1000, 180, 20 * ALTURA_HORA_PX, ALTURA_HORA_PX)).toBe(1260)
  })
})

describe('minutosParaHora', () => {
  it('formata HH:mm com zero à esquerda', () => {
    expect(minutosParaHora(0)).toBe('00:00')
    expect(minutosParaHora(540)).toBe('09:00')
    expect(minutosParaHora(65)).toBe('01:05')
  })

  it('nunca chega a 24:00 — satura em 23:59', () => {
    expect(minutosParaHora(1440)).toBe('23:59')
    expect(minutosParaHora(2000)).toBe('23:59')
  })

  it('nunca fica negativo', () => {
    expect(minutosParaHora(-30)).toBe('00:00')
  })
})

describe('geometriaEvento', () => {
  it('altura proporcional: 15 = 25%, 30 = 50%, 45 = 75%, 60 = 100% de uma hora', () => {
    const H = 60
    expect(geometriaEvento(600, 15, H).alturaPx).toBe(H * 0.25)
    expect(geometriaEvento(600, 30, H).alturaPx).toBe(H * 0.5)
    expect(geometriaEvento(600, 45, H).alturaPx).toBe(H * 0.75)
    expect(geometriaEvento(600, 60, H).alturaPx).toBe(H)
    expect(geometriaEvento(600, 90, H).alturaPx).toBe(H * 1.5)
  })

  it('topo exato pelo minuto de início, com qualquer altura de hora', () => {
    expect(geometriaEvento(0, 30, 60).topoPx).toBe(0)
    expect(geometriaEvento(615, 30, 60).topoPx).toBe(615)
    expect(geometriaEvento(615, 30, 48).topoPx).toBe(492)
    expect(geometriaEvento(615, 15, 48).alturaPx).toBe(12)
  })

  it('densidade decide só o texto: linha (até 20 min), compacto (até 50), completo', () => {
    expect(geometriaEvento(0, 15).densidade).toBe('linha')
    expect(geometriaEvento(0, 30).densidade).toBe('compacto')
    expect(geometriaEvento(0, 45).densidade).toBe('compacto')
    expect(geometriaEvento(0, 60).densidade).toBe('completo')
  })

  it('padrão: 1 px por minuto', () => {
    expect(ALTURA_HORA_PX).toBe(60)
    expect(geometriaEvento(540, 45).alturaPx).toBe(45)
  })
})
