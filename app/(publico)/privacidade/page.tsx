import type { Metadata } from 'next'
import Link from 'next/link'

import { DADOS_LEGAIS, SITE_AVANTE } from '@/lib/legal/dados-legais'

import { AvisoRascunho, CabecalhoLegal, Dado, Lista, Secao } from '../_components/texto-legal'

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: 'Como o AVANTE CRM, da Rio X7 Agência Digital, trata dados pessoais, inclusive os recebidos do Google e da Meta (WhatsApp).',
}

const destaque = 'text-premium-texto'
const link = 'text-premium-acento underline'

function Email() {
  const email = DADOS_LEGAIS.emailPrivacidade
  if (!email) return <Dado campo="emailPrivacidade" rotulo="e-mail de privacidade" />
  return (
    <a href={`mailto:${email}`} className={link}>
      {email}
    </a>
  )
}

/**
 * Política de Privacidade do AVANTE. Descreve só o que o sistema faz hoje
 * (conferido no código e na operação em 28/10/2026). Onde ainda não há regra
 * operacional definida (prazos de retenção e de descarte), o texto diz isso
 * sem prometer rotina automática; os pontos para revisão jurídica estão em
 * `docs/PAGINAS-PUBLICAS-REVISAO-JURIDICA.md`.
 */
export default function PrivacidadePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <AvisoRascunho />
      <CabecalhoLegal
        titulo="Política de Privacidade"
        resumo="Como o AVANTE CRM trata dados pessoais de usuários, de clientes e leads das empresas que usam o sistema, e os dados recebidos do Google e da Meta."
      />

      <Secao titulo="1. Quem somos">
        <p>
          O AVANTE CRM (<a href={SITE_AVANTE} className={link}>{SITE_AVANTE.replace('https://', '')}</a>) é um sistema de gestão comercial oferecido pela{' '}
          <Dado campo="razaoSocial" rotulo="razão social" />, nome comercial {DADOS_LEGAIS.marca}, CNPJ <Dado campo="cnpj" rotulo="CNPJ" />, localizada em{' '}
          <Dado campo="localidade" rotulo="cidade" />, às suas empresas clientes. O acesso é criado pela Rio X7 ou pelo Administrador de cada empresa; não há
          cadastro aberto ao público.
        </p>
        <p>
          Pedidos e dúvidas sobre dados pessoais são atendidos pelo <Dado campo="atendimento" rotulo="setor de atendimento" />, pelo e-mail <Email />.
        </p>
      </Secao>

      <Secao titulo="2. Papéis no tratamento de dados (LGPD)">
        <Lista
          itens={[
            <>
              <strong className={destaque}>Dados de clientes e leads de cada empresa:</strong> a empresa cliente decide quais dados coloca no AVANTE (cadastros,
              negociações, conversas de WhatsApp, leads de formulários, planilhas e anúncios) e para quê. Nesses tratamentos, ela é a <em>controladora</em> e a
              Rio X7 é a <em>operadora</em>: trata os dados em nome da empresa cliente, conforme as instruções dela, para prestar o serviço.
            </>,
            <>
              <strong className={destaque}>Dados próprios da Rio X7:</strong> a Rio X7 é a <em>controladora</em> dos dados de cadastro dos usuários e das
              empresas clientes, da administração das contas, dos registros de segurança e de auditoria do sistema, do suporte e, conforme aplicável, da
              contratação e do faturamento.
            </>,
          ]}
        />
        <p>O contrato com cada empresa cliente pode detalhar essas responsabilidades.</p>
      </Secao>

      <Secao titulo="3. Dados que o AVANTE trata">
        <Lista
          itens={[
            <>
              <strong className={destaque}>Usuários do sistema:</strong> nome, e-mail, cargo, empresa a que pertence, dados de sessão (autenticação) e
              registro das ações administrativas (auditoria).
            </>,
            <>
              <strong className={destaque}>Empresas clientes:</strong> dados de cadastro da empresa, plano contratado e contatos dos responsáveis.
            </>,
            <>
              <strong className={destaque}>Clientes e leads das empresas:</strong> nome, telefone, e-mail e outros dados que a empresa cadastrar;
              negociações, etapas do funil, valores, propostas, atividades e compromissos de agenda; origem do lead (formulário, planilha, anúncio ou WhatsApp).
            </>,
            <>
              <strong className={destaque}>Conversas de WhatsApp</strong> (quando a empresa conecta o número): mensagens recebidas e respondidas, nome do
              perfil e telefone do contato, arquivos de mídia, situação de entrega e, quando a Meta informa, o identificador do anúncio de clique para o
              WhatsApp que originou a conversa.
            </>,
            <>
              <strong className={destaque}>Integrações:</strong> e-mail da conta Google conectada, identificadores da conta e do número do WhatsApp Business e
              as credenciais de acesso (guardadas cifradas, ver item 8).
            </>,
          ]}
        />
      </Secao>

      <Secao titulo="4. Para que usamos os dados e com qual base legal">
        <Lista
          itens={[
            <>
              <strong className={destaque}>Prestar o serviço à empresa cliente</strong> (funil, clientes, agenda, metas, captação de leads e atendimento por
              WhatsApp). Para os dados de clientes e leads, a base legal é definida pela empresa cliente, como controladora.
            </>,
            <>
              <strong className={destaque}>Criar e administrar as contas, controlar o acesso e dar suporte:</strong> execução do contrato com a empresa
              cliente (LGPD, art. 7º, V).
            </>,
            <>
              <strong className={destaque}>Segurança, prevenção de abuso e auditoria:</strong> legítimo interesse da Rio X7 e das empresas clientes em
              manter o sistema seguro (art. 7º, IX).
            </>,
            <>
              <strong className={destaque}>Obrigações legais e defesa de direitos:</strong> cumprimento de obrigação legal ou regulatória e exercício regular
              de direitos (art. 7º, II e VI).
            </>,
          ]}
        />
        <p>O AVANTE não vende dados pessoais e não usa os dados das empresas clientes para publicidade própria.</p>
      </Secao>

      <Secao titulo="5. Dados recebidos do Google">
        <p>
          Quando o Administrador de uma empresa conecta uma conta Google ao AVANTE para usar o <strong className={destaque}>Google Sheets</strong> (permissões{' '}
          <code>openid</code>, <code>email</code> e <code>drive.file</code>):
        </p>
        <Lista
          itens={[
            'O AVANTE lê somente as planilhas que o próprio usuário escolhe no seletor do Google, para transformar as linhas em leads no funil escolhido. Não cria, altera nem apaga planilhas, e não acessa outros arquivos do Google Drive.',
            'Para perceber linhas novas, o AVANTE pede ao Google avisos de alteração somente das planilhas escolhidas.',
            'O e-mail da conta é usado só para identificar a conexão no painel da empresa.',
          ]}
        />
        <p>
          O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs do Google seguem a{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className={link} rel="noopener noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado. Os dados do Google não são vendidos, não são usados para publicidade e não são usados para treinar
          modelos de inteligência artificial.
        </p>
        <p>
          Para desligar: o Administrador desconecta a conta no AVANTE (o acesso é revogado no Google e a credencial é apagada do cofre), ou o próprio
          usuário remove o AVANTE em{' '}
          <a href="https://myaccount.google.com/permissions" className={link} rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </Secao>

      <Secao titulo="6. Dados recebidos da Meta (WhatsApp e anúncios)">
        <Lista
          itens={[
            'O número de WhatsApp Business é conectado pela própria empresa, na janela oficial da Meta (WhatsApp Cloud API). Cada número pertence a uma única empresa no AVANTE.',
            'Mensagens recebidas são guardadas para o atendimento da empresa dona do número. Respostas só saem dentro da janela de atendimento de 24 horas aberta pelo cliente; o AVANTE não faz envio em massa nem mensagens de marketing.',
            'O PIN de verificação em duas etapas digitado para registrar o número é repassado à Meta e não é guardado pelo AVANTE.',
            'Conversões de anúncios (quando a empresa ativar): o AVANTE envia à Meta eventos do funil, como lead qualificado ou venda, com o identificador do lead fornecido pela própria Meta, sem nome, telefone ou e-mail do contato.',
          ]}
        />
        <p>
          A Meta trata esses dados também segundo as próprias regras, como os{' '}
          <a href="https://www.whatsapp.com/legal/business-policy" className={link} rel="noopener noreferrer">
            termos e políticas do WhatsApp Business
          </a>
          .
        </p>
      </Secao>

      <Secao titulo="7. Fornecedores e transferência internacional">
        <p>O AVANTE usa estes fornecedores para funcionar; cada um trata dados só para prestar o seu serviço:</p>
        <Lista
          itens={[
            'Supabase: banco de dados, autenticação (inclusive o envio dos e-mails de recuperação de senha), armazenamento de arquivos e funções do servidor. O banco de dados, a autenticação e os arquivos ficam na região de São Paulo (Brasil).',
            'Hostinger: hospedagem do site do AVANTE e do e-mail de atendimento.',
            'Google: quando a empresa conecta o Google Sheets.',
            'Meta: quando a empresa conecta o WhatsApp Business ou as conversões de anúncios.',
            'Respondi e Google Apps Script: quando a empresa recebe leads de formulários Respondi.',
          ]}
        />
        <p>
          Parte do tratamento pode ocorrer fora do Brasil, em especial nos serviços do Google e da Meta e nas funções do servidor da Supabase, que usam
          infraestrutura internacional. Nesses casos, os dados seguem também os termos e as políticas de privacidade desses fornecedores.
        </p>
      </Secao>

      <Secao titulo="8. Segurança">
        <Lista
          itens={[
            'Isolamento por empresa no próprio banco de dados (regras de acesso por linha): uma empresa não vê dados de outra.',
            'Permissões por cargo dentro de cada empresa.',
            'Credenciais do Google e da Meta guardadas cifradas em cofre no servidor; nunca aparecem na tela nem nos registros.',
            'Conexões criptografadas (HTTPS).',
            'Registro de auditoria das ações administrativas. O suporte da Rio X7 só abre o sistema de uma empresa por uma janela temporária e registrada.',
          ]}
        />
        <p>Nenhuma medida elimina todos os riscos. Em caso de incidente relevante, as empresas afetadas e a ANPD serão comunicadas conforme a LGPD.</p>
      </Secao>

      <Secao titulo="9. Cookies">
        <p>O AVANTE usa só cookies necessários ao funcionamento:</p>
        <Lista
          itens={[
            'sessão de login (autenticação);',
            'empresa em uso, para abrir o sistema na empresa certa;',
            'preferências de exibição: tema claro ou escuro, menu recolhido e último funil aberto.',
          ]}
        />
        <p>
          Não há cookies de publicidade nem de análise. As janelas do Google (seletor de planilhas e login) e da Meta (conexão do WhatsApp) são dessas
          empresas e seguem as políticas delas.
        </p>
      </Secao>

      <Secao titulo="10. Por quanto tempo guardamos">
        <Lista
          itens={[
            'Os dados das empresas clientes ficam no AVANTE enquanto o contrato estiver ativo.',
            'Ao desconectar uma integração, a credencial correspondente é apagada do cofre na hora; o histórico já importado (leads e conversas) continua na empresa.',
            'A opção "Excluir" dentro do sistema tira o registro das telas, mas o guarda para consulta e restauração. A eliminação definitiva é feita mediante pedido, e não de forma automática (item 12).',
            'Ao fim do contrato, o acesso é encerrado. A devolução ou a eliminação dos dados segue o contrato e as instruções da empresa cliente, que pode pedir uma cópia e a eliminação pelo e-mail de atendimento.',
            'Registros de acesso, de segurança e de auditoria são mantidos pelo tempo necessário à segurança do sistema, ao cumprimento de obrigações legais e à defesa de direitos.',
          ]}
        />
      </Secao>

      <Secao titulo="11. Seus direitos">
        <p>
          A LGPD (art. 18) garante, entre outros: confirmação do tratamento, acesso, correção, anonimização, bloqueio ou eliminação de dados
          desnecessários ou tratados em desacordo com a lei, portabilidade, eliminação dos dados tratados com consentimento, informação sobre
          compartilhamentos e revogação do consentimento.
        </p>
        <Lista
          itens={[
            <>
              Para exercer seus direitos, escreva para <Email />. Respondemos em <Dado campo="prazoAtendimento" rotulo="prazo" />.
            </>,
            'Para proteger os dados, podemos pedir informações que confirmem que o pedido vem do próprio titular ou de quem o representa.',
            'Se você é cliente ou lead de uma empresa que usa o AVANTE, essa empresa é a responsável pelos seus dados: você pode fazer o pedido a ela ou a nós, e encaminharemos o pedido a ela.',
            'Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).',
          ]}
        />
      </Secao>

      <Secao id="exclusao-de-dados" titulo="12. Como pedir a exclusão de dados">
        <p>
          Vale para os dados tratados pelo AVANTE, inclusive os recebidos do Google e da Meta (WhatsApp e login da Meta para empresas). São três coisas
          diferentes:
        </p>

        <h3 className="pt-2 font-semibold text-premium-texto">12.1 Revogar o acesso e apagar as credenciais</h3>
        <p>Interrompe a integração. Não apaga os dados que já estão no CRM.</p>
        <Lista
          itens={[
            'Google: o Administrador da empresa desconecta a conta em Configurações → Integrações. O AVANTE encerra os avisos de alteração das planilhas, revoga o acesso no Google e apaga o token do cofre na hora.',
            'WhatsApp: o Administrador desconecta o número no mesmo lugar. A credencial da Meta é apagada do cofre na hora; o número deixa de criar leads e de enviar mensagens.',
            <>
              Também é possível remover o acesso direto no Google (
              <a href="https://myaccount.google.com/permissions" className={link} rel="noopener noreferrer">
                myaccount.google.com/permissions
              </a>
              ) ou na Meta (Configurações do negócio → Integrações comerciais).
            </>,
            'Leads, conversas e demais registros já recebidos continuam na empresa até um pedido de exclusão (item 12.2).',
          ]}
        />

        <h3 className="pt-2 font-semibold text-premium-texto">12.2 Excluir os dados pessoais guardados no CRM</h3>
        <Lista
          itens={[
            'A opção "Excluir" de clientes e leads dentro do AVANTE tira o registro das telas, mas o guarda para consulta e restauração. Não é uma eliminação definitiva.',
            <>
              Para a eliminação definitiva, envie um pedido para <Email /> com o assunto &quot;Exclusão de dados AVANTE&quot;, informando a empresa e o e-mail
              ou telefone ligado aos dados.
            </>,
            'Dados de clientes e leads pertencem à empresa que os cadastrou (controladora): o pedido é atendido com ela. Se você é cliente ou lead de uma empresa, pode pedir a ela ou a nós, e encaminharemos.',
            'Antes de excluir, conferimos se o pedido vem do próprio titular ou do Administrador da empresa.',
            <>
              Respondemos em <Dado campo="prazoAtendimento" rotulo="prazo" />, informando o que foi eliminado e o que precisou ser preservado, com o motivo
              (item 12.3).
            </>,
          ]}
        />

        <h3 className="pt-2 font-semibold text-premium-texto">12.3 O que pode ser preservado</h3>
        <p>
          Mesmo depois de um pedido de exclusão, alguns registros podem ser mantidos quando a lei ou o contrato exigirem, pelo tempo necessário e só para
          essa finalidade (LGPD, art. 16):
        </p>
        <Lista
          itens={[
            'Registros de acesso, de segurança e de auditoria, para cumprir obrigações legais e proteger o sistema.',
            'Dados necessários para cumprir o contrato com a empresa cliente ou para o exercício de direitos em processos judiciais, administrativos ou arbitrais.',
            'Cópias de segurança do banco de dados, feitas antes de manutenções do sistema: podem conter dados já eliminados até serem descartadas. Ficam com acesso restrito e não são usadas para outra finalidade.',
          ]}
        />
      </Secao>

      <Secao titulo="13. Alterações desta política">
        <p>
          Esta política pode ser atualizada. Mudanças relevantes serão informadas às empresas clientes com antecedência razoável, pelo AVANTE ou por
          e-mail, salvo quando a lei ou a segurança do sistema exigirem mudança imediata. A versão em vigor fica sempre nesta página, com a data da última
          atualização. Veja também os{' '}
          <Link href="/termos" className={link}>
            Termos de Uso
          </Link>
          .
        </p>
      </Secao>
    </article>
  )
}
