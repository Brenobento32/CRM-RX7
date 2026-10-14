/**
 * Checagem de ambiente local do Scorpion CRM — não instala nada além de
 * dependências do npm quando faltam, não grava segredo nenhum e nunca toca
 * em produção/banco/deploy.
 *
 * O que faz:
 *   1. confere a versão do Node (README pede 20.9+);
 *   2. roda `npm install` se `node_modules` não existir ainda;
 *   3. confere se `.env.local` existe — se não existir, copia de
 *      `.env.example` (nunca sobrescreve um `.env.local` já existente);
 *   4. lista, pelo NOME, quais variáveis obrigatórias ainda estão faltando
 *      ou vazias em `.env.local` — nunca imprime nenhum valor;
 *   5. detecta (só detecta — nunca executa) se a CLI da Vercel está
 *      instalada e autenticada, e explica o comando pra recuperar as
 *      variáveis de lá;
 *   6. detecta se a CLI do Supabase está instalada e se este projeto já
 *      está vinculado (`supabase/.temp/project-ref`), sem nunca rodar
 *      `db push`, `link` ou qualquer comando de escrita.
 *
 * O que NUNCA faz: deploy, migration, `db push`, alteração de produção,
 * alteração do Supabase, leitura ou impressão de valor de variável de
 * ambiente/segredo, cópia da sessão do WhatsApp (`auth_info_baileys*`).
 *
 * Uso:
 *   node scripts/setup.mts
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('../', import.meta.url))

function titulo(texto: string): void {
  console.log(`\n== ${texto} ==`)
}

function rodar(comando: string): { ok: boolean; saida: string } {
  const resultado = spawnSync(comando, { encoding: 'utf8', shell: true })
  return { ok: resultado.status === 0, saida: (resultado.stdout || '').trim() }
}

// ---------------------------------------------------------------------------
// 1. Node
// ---------------------------------------------------------------------------
titulo('Node.js')
const versaoNode = process.versions.node
const major = Number(versaoNode.split('.')[0])
if (major < 20) {
  console.error(`Node ${versaoNode} detectado. O projeto precisa de Node 20.9+ (ver README.md).`)
  process.exit(1)
}
console.log(`OK — Node ${versaoNode}`)

// ---------------------------------------------------------------------------
// 2. Dependências
// ---------------------------------------------------------------------------
titulo('Dependências (npm install)')
const nodeModules = raiz + 'node_modules'
if (existsSync(nodeModules)) {
  console.log('OK — node_modules já existe, nada a instalar.')
} else {
  console.log('node_modules não existe — rodando "npm install"...')
  const instalacao = spawnSync('npm install', { cwd: raiz, stdio: 'inherit', shell: true })
  if (instalacao.status !== 0) {
    console.error('Falha ao instalar dependências.')
    process.exit(1)
  }
  console.log('OK — dependências instaladas.')
}

// ---------------------------------------------------------------------------
// 3/4. .env.local — nunca sobrescreve, nunca imprime valor
// ---------------------------------------------------------------------------
titulo('.env.local')
const envLocalPath = raiz + '.env.local'
const envExamplePath = raiz + '.env.example'

if (!existsSync(envLocalPath)) {
  copyFileSync(envExamplePath, envLocalPath)
  console.log('.env.local não existia — criado a partir de .env.example.')
  console.log('Preencha os valores reais antes de rodar "npm run dev" (ver docs/SCORPION-SETUP.md).')
} else {
  console.log('OK — .env.local já existe (não foi tocado).')
}

const OBRIGATORIAS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']
const linhasEnv = readFileSync(envLocalPath, 'utf8').split('\n')
const presentes = new Set(
  linhasEnv.flatMap((l) => {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    return m && m[2].trim().length > 0 ? [m[1]] : []
  }),
)

const faltando = OBRIGATORIAS.filter((nome) => !presentes.has(nome))
if (faltando.length === 0) {
  console.log('OK — todas as variáveis obrigatórias têm algum valor preenchido em .env.local.')
} else {
  console.log('Faltam valores para (ver .env.example para a finalidade de cada uma):')
  for (const nome of faltando) console.log(`  - ${nome}`)
}
console.log(
  'NEXT_PUBLIC_SITE_URL é opcional (cai em http://localhost:3000 se ausente; em produção use a URL pública, ex.: https://scorpion-crm.vercel.app).',
)

// ---------------------------------------------------------------------------
// 5. Vercel — só detecta e explica; nunca executa pull nem deploy.
// ---------------------------------------------------------------------------
titulo('Vercel CLI')
const vercelVersao = rodar('vercel --version')
if (!vercelVersao.ok) {
  console.log('Vercel CLI não encontrada. Instale com "npm i -g vercel" se quiser recuperar as')
  console.log('variáveis de lá em vez de preenchê-las manualmente.')
} else {
  console.log(`OK — Vercel CLI instalada (${vercelVersao.saida || 'versão não identificada'}).`)
  const quemSou = rodar('vercel whoami')
  if (quemSou.ok) {
    console.log(`Autenticado na Vercel (${quemSou.saida}).`)
    console.log('Para recuperar as variáveis do ambiente de produção, rode (não é automático):')
    console.log('  vercel link')
    console.log('  vercel env pull .env.local')
    console.log('Isso SOBRESCREVE .env.local — faça backup antes se já tiver valores locais.')
  } else {
    console.log('Não autenticado. Rode "vercel login" antes de "vercel env pull".')
  }
}

// ---------------------------------------------------------------------------
// 6. Supabase — só detecta e explica; nunca linka, nunca faz push.
// ---------------------------------------------------------------------------
titulo('Supabase CLI')
const supabaseVersao = rodar('npx --no-install supabase --version')
if (!supabaseVersao.ok) {
  console.log('Supabase CLI não encontrada via npx. Será baixada automaticamente na primeira')
  console.log('vez que você rodar um comando com "npx supabase ...".')
} else {
  console.log(`OK — Supabase CLI disponível (${supabaseVersao.saida || 'versão não identificada'}).`)
}

const projectRefPath = raiz + 'supabase/.temp/project-ref'
if (existsSync(projectRefPath)) {
  console.log('Projeto já vinculado localmente (supabase/.temp/project-ref existe).')
} else {
  console.log('Projeto ainda não vinculado nesta máquina. Ver docs/SCORPION-SETUP.md para o')
  console.log('project ref e o comando "supabase link" (não é executado automaticamente aqui).')
}

titulo('Resumo')
console.log('Este script só verificou o ambiente e, no máximo, instalou dependências do npm')
console.log('ou criou um .env.local vazio a partir do template. Nada foi enviado para o')
console.log('Supabase, a Vercel, o Git ou qualquer serviço externo.')
console.log('Próximos passos manuais (ver docs/SCORPION-SETUP.md): preencher .env.local,')
console.log('"npm run db:types", "npm run test", "npm run dev".')
