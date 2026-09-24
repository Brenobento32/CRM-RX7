/**
 * Gera `lib/types/database.ts` a partir do schema do Supabase — sem nunca
 * deixar o arquivo vazio ou pela metade.
 *
 * O jeito antigo (`supabase gen types … > lib/types/database.ts`) esvazia o
 * arquivo antes de a CLI terminar. Com o `npm run dev` ligado, o Turbopack
 * compilava essa versão vazia ("Export Constants doesn't exist") e o
 * navegador ficava com ela em cache. E, se a CLI falhasse, o arquivo ficava
 * vazio de vez.
 *
 * Aqui a saída é lida inteira, conferida, gravada num temporário ao lado e
 * trocada com `rename` (atômico no mesmo disco, inclusive no Windows). Quem
 * observa o arquivo vê a versão antiga ou a nova completa. Se nada mudou, o
 * arquivo nem é tocado (sem recompilação à toa).
 *
 * Uso:
 *   node scripts/gerar-tipos.mts            # projeto vinculado (--linked)
 *   node scripts/gerar-tipos.mts --local    # Supabase local
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const destino = fileURLToPath(new URL('../lib/types/database.ts', import.meta.url))
const temporario = `${destino}.tmp`
const origem = process.argv.includes('--local') ? '--local' : '--linked'

// Comando fixo, sem entrada do usuário. Vai pelo shell porque o npx é um .cmd
// no Windows; como string única (e não lista de args), sem o aviso DEP0190.
const cli = spawnSync(`npx supabase gen types typescript ${origem}`, {
  encoding: 'utf8',
  shell: true,
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
})

if (cli.error || cli.status !== 0) {
  console.error(`\nFalha ao gerar os tipos (${origem}). ${destino} não foi alterado.`)
  process.exit(cli.status || 1)
}

const tipos = cli.stdout
if (!tipos.includes('export type Database') || !tipos.includes('export const Constants')) {
  console.error(`\nSaída inesperada da CLI (sem Database/Constants). ${destino} não foi alterado.`)
  process.exit(1)
}

if (existsSync(destino) && readFileSync(destino, 'utf8') === tipos) {
  console.log('Tipos já atualizados: nada mudou.')
  process.exit(0)
}

try {
  writeFileSync(temporario, tipos)
  renameSync(temporario, destino)
} catch (erro) {
  rmSync(temporario, { force: true })
  throw erro
}

console.log(`Tipos gerados (${origem}): lib/types/database.ts`)
