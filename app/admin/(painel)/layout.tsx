import { exigirSuperAdmin } from '@/lib/dal/super-admin'

import { PainelAdmin } from '../_components/painel-admin'

/**
 * Rotas internas do painel (`/admin/planos`, `/admin/auditoria`,
 * `/admin/empresas/...`). Sem sessão: volta ao login administrativo em
 * `/admin` (o proxy já faz isso guardando o destino; aqui é a garantia).
 * Sem o privilégio global: 404. O banco confere de novo em cada RPC `admin_*`.
 */
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await exigirSuperAdmin()
  return <PainelAdmin>{children}</PainelAdmin>
}
