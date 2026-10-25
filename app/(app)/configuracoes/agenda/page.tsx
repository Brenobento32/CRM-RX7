import { redirect } from 'next/navigation'

/**
 * A integração com o Google Calendar foi desligada: a agenda agora é nativa
 * do CRM. A conexão, os tokens e o histórico continuam guardados no banco
 * (`agenda_google_conexao`), só não há mais tela para usá-los.
 */
export default function AgendaGooglePage(): never {
  redirect('/agenda')
}
