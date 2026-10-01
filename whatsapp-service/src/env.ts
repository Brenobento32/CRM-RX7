import 'dotenv/config'

function obrigatoria(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Defina ${nome} no .env do whatsapp-service (veja .env.example).`)
  return valor
}

export const env = {
  supabaseUrl: obrigatoria('SUPABASE_URL'),
  supabaseServiceRoleKey: obrigatoria('SUPABASE_SERVICE_ROLE_KEY'),
}
