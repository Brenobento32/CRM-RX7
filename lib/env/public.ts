/**
 * Variáveis de ambiente públicas (expostas ao browser).
 *
 * As referências a `process.env.NEXT_PUBLIC_*` precisam ser literais para que o
 * Next.js consiga substituí-las em tempo de build. Não troque por acesso
 * dinâmico (`process.env[nome]`) — o valor viraria `undefined` no bundle.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis do Supabase ausentes. Copie .env.example para .env.local e ' +
      'preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.',
  )
}

export const publicEnv = {
  supabaseUrl,
  supabaseAnonKey,
} as const
