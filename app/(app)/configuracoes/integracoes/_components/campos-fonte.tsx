import { inputClass } from '@/components/ui/estilos'
import type { OpcoesFonte } from '@/lib/dal/fontes-leads'
import type { TipoFonte } from '@/lib/integracoes/catalogo'

/** Campos comuns e específicos de uma fonte (usados em criar e editar). Sem segredos. */
export function CamposFonte({
  tipo,
  opcoes,
  responsaveis,
  valores,
}: {
  tipo: TipoFonte
  opcoes: OpcoesFonte
  responsaveis: { id: string; nome: string }[]
  valores?: { nome?: string; destino?: string; responsavelId?: string; configuracao?: Record<string, unknown> }
}) {
  const cfg = valores?.configuracao ?? {}
  const campos = (cfg.campos ?? {}) as Record<string, string>
  return (
    <>
      <Campo rotulo="Nome da fonte">
        <input name="nome" required minLength={2} maxLength={80} defaultValue={valores?.nome} className={inputClass} placeholder="Ex.: Site, Campanha de março" />
      </Campo>
      <Campo rotulo="Funil e etapa de entrada">
        <select name="destino" required defaultValue={valores?.destino ?? ''} className={inputClass}>
          <option value="" disabled>Escolha…</option>
          {opcoes.funis.map((f) => (
            <optgroup key={f.id} label={f.nome}>
              {f.etapas.map((e) => (
                <option key={e.id} value={`${f.id}|${e.id}`}>
                  {e.nome}
                  {e.inicial ? ' (inicial)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Responsável pelos leads novos">
        <select name="responsavel_id" required defaultValue={valores?.responsavelId ?? ''} className={inputClass}>
          <option value="" disabled>Escolha…</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
      </Campo>

      {tipo === 'meta_lead_ads' && (
        <>
          <Campo rotulo="ID da página do Facebook">
            <input name="page_id" required inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={String(cfg.page_id ?? '')} className={inputClass} />
          </Campo>
          <Campo rotulo="ID do formulário (opcional: só este formulário)">
            <input name="form_id" inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={String(cfg.form_id ?? '')} className={inputClass} />
          </Campo>
        </>
      )}
      {tipo === 'whatsapp_cloud' && (
        <Campo rotulo="Phone Number ID (WhatsApp Cloud API)">
          <input name="phone_number_id" required inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={String(cfg.phone_number_id ?? '')} className={inputClass} />
        </Campo>
      )}
      {tipo === 'respondi' && (
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">Título exato das perguntas (opcional; vazio = reconhecimento automático)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['nome', 'telefone', 'email', 'empresa'] as const).map((c) => (
              <input key={c} name={`campo_${c}`} maxLength={300} defaultValue={campos[c] ?? ''} placeholder={`Pergunta de ${c}`} className={inputClass} />
            ))}
          </div>
        </fieldset>
      )}
    </>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{rotulo}</span>
      {children}
    </label>
  )
}
