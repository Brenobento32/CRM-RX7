import type { Metadata } from 'next'
import Link from 'next/link'

import { DADOS_LEGAIS } from '@/lib/legal/dados-legais'

import { AvisoRascunho, CabecalhoLegal, Dado, Lista, Secao } from '../_components/texto-legal'

export const metadata: Metadata = {
  title: 'Termos de Uso',
  description: 'Condições de uso do AVANTE CRM, da Rio X7 Agência Digital.',
}

const link = 'text-premium-acento underline'

/**
 * Termos de Uso do AVANTE. Redação prudente, sem prazos, valores ou níveis de
 * serviço que não existam; os pontos para revisão jurídica estão em
 * `docs/PAGINAS-PUBLICAS-REVISAO-JURIDICA.md`.
 */
export default function TermosPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <AvisoRascunho />
      <CabecalhoLegal titulo="Termos de Uso" resumo="Condições para usar o AVANTE CRM. Valem para as empresas clientes e para cada usuário que elas cadastram." />

      <Secao titulo="1. O serviço">
        <p>
          O AVANTE CRM é um sistema de gestão comercial oferecido pela <Dado campo="razaoSocial" rotulo="razão social" />, nome comercial{' '}
          {DADOS_LEGAIS.marca}, CNPJ <Dado campo="cnpj" rotulo="CNPJ" />, às suas empresas clientes: funil de vendas, clientes e negociações, agenda, metas,
          captação de leads e integrações com Google e Meta.
        </p>
        <p>
          Os recursos, o plano e o preço de cada empresa são os do contrato com a Rio X7. Se houver contrato comercial assinado, ele prevalece sobre estes
          Termos naquilo em que for diferente; no restante, estes Termos se aplicam.
        </p>
      </Secao>

      <Secao titulo="2. Contas e acesso">
        <Lista
          itens={[
            'Não há cadastro aberto: o acesso é criado pela Rio X7 ou pelo Administrador da empresa.',
            'O login é pessoal. Não compartilhe a senha; avise o Administrador se suspeitar de uso indevido.',
            'O Administrador da empresa define quem acessa e o que cada cargo pode ver e fazer, e responde por essas escolhas.',
            'O suporte da Rio X7 só abre o sistema de uma empresa por uma janela temporária e registrada.',
          ]}
        />
      </Secao>

      <Secao titulo="3. Responsabilidades da empresa cliente">
        <p>Como controladora dos dados dos seus clientes e leads, a empresa cliente é responsável por:</p>
        <Lista
          itens={[
            'Ter base legal (LGPD) para os dados que coloca no AVANTE, informar seus clientes e leads sobre esse uso e atender os pedidos deles, com o apoio da Rio X7 quando necessário.',
            'Usar o WhatsApp de acordo com os termos e políticas do WhatsApp Business e da Meta, falando só com quem a procurou ou autorizou o contato.',
            'Usar as integrações do Google de acordo com os termos do Google e só com planilhas e contas a que tem direito.',
            'Pagar diretamente à Meta, ao Google ou a outros terceiros os valores que eles cobrarem pelos serviços deles.',
            'Guardar com segurança as senhas e o PIN do WhatsApp, e retirar o acesso de quem deixar a empresa.',
            'Manter corretos os dados cadastrados e as configurações de funil, permissões e integrações, e responder pelo conteúdo das mensagens e dos registros que seus usuários criam.',
          ]}
        />
      </Secao>

      <Secao titulo="4. Integrações e custos de terceiros">
        <Lista
          itens={[
            'Google, Meta e Respondi são serviços de terceiros, com termos próprios. A empresa conecta e desconecta as próprias contas.',
            'Mensagens de WhatsApp podem ser cobradas pela Meta, diretamente da empresa. O AVANTE limita o envio às respostas dentro da janela de atendimento de 24 horas, bloqueia envios que podem ser cobrados e não cadastra formas de pagamento. Mesmo assim, as regras e os preços são definidos pela Meta e podem mudar, por isso o AVANTE não garante custo zero.',
            'Mudanças ou falhas nesses serviços podem afetar as integrações sem que a Rio X7 tenha controle sobre elas.',
          ]}
        />
      </Secao>

      <Secao titulo="5. Uso proibido">
        <Lista
          itens={[
            'Enviar spam, mensagens em massa não solicitadas ou conteúdo ilegal.',
            'Tentar acessar dados de outra empresa, contornar permissões ou testar a segurança sem autorização por escrito.',
            'Copiar, revender ou fazer engenharia reversa do sistema.',
          ]}
        />
      </Secao>

      <Secao titulo="6. Disponibilidade e suporte">
        <p>
          A Rio X7 trabalha para manter o AVANTE disponível e seguro, mas não garante funcionamento ininterrupto: pode haver pausas para manutenção ou falhas
          de fornecedores. O suporte é prestado pelos canais e nas condições do contrato. Assuntos de dados pessoais vão para{' '}
          <Dado campo="emailPrivacidade" rotulo="e-mail de privacidade" />.
        </p>
      </Secao>

      <Secao titulo="7. Dados e privacidade">
        <p>
          O tratamento de dados pessoais segue a{' '}
          <Link href="/privacidade" className={link}>
            Política de Privacidade
          </Link>
          . Os dados de cada empresa pertencem a ela. Ao fim do contrato, a empresa pode pedir uma cópia dos seus dados e a eliminação deles, como descrito
          na Política de Privacidade.
        </p>
      </Secao>

      <Secao titulo="8. Alterações dos Termos">
        <p>
          Estes Termos podem ser atualizados. Mudanças relevantes serão informadas às empresas clientes com antecedência razoável, pelo AVANTE ou por e-mail,
          salvo quando a lei ou a segurança do sistema exigirem mudança imediata. A versão em vigor fica sempre nesta página, com a data da última
          atualização. Mudanças no plano, no preço ou nas condições comerciais seguem o contrato.
        </p>
      </Secao>

      <Secao titulo="9. Suspensão e encerramento">
        <Lista
          itens={[
            'A Rio X7 pode suspender o acesso de um usuário ou de uma empresa, inclusive de imediato, em caso de uso proibido, risco à segurança do sistema ou de terceiros, ou ordem de autoridade.',
            'A suspensão ou o encerramento por outros motivos, como o fim do contrato, seguem as regras e os avisos previstos no contrato.',
            'Com o encerramento, o acesso ao AVANTE termina, e os dados seguem o item 7 e a Política de Privacidade.',
          ]}
        />
      </Secao>

      <Secao titulo="10. Responsabilidade">
        <p>
          Na medida permitida pela lei, a Rio X7 não responde por danos indiretos ou lucros cessantes, por falhas ou mudanças de serviços de terceiros
          (como Google, Meta e provedores de internet), pelo conteúdo que a empresa cliente e seus usuários inserem ou enviam, nem por uso em desacordo com
          estes Termos. Nada nestes Termos afasta direitos que a lei não permite limitar.
        </p>
      </Secao>

      <Secao titulo="11. Lei e foro">
        <p>
          Aplicam-se as leis do Brasil. Fica eleito o foro de <Dado campo="foro" rotulo="foro" />.
        </p>
      </Secao>
    </article>
  )
}
