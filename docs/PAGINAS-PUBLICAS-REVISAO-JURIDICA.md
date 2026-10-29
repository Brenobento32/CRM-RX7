# Páginas públicas — dados confirmados e pontos para revisão jurídica

Versão dos textos: 28/10/2026 (`/privacidade`, `/termos`, `/apresentacao`).
Os dados da empresa ficam em `lib/legal/dados-legais.ts`; se algum voltar a
`null`, a página mostra o trecho destacado e o aviso "Rascunho para revisão".

## Confirmado

| Item | Fonte |
|---|---|
| Razão social MH GESTAO & SUPORTE LTDA, CNPJ 61.164.464/0001-28, ativa, Petrópolis – RJ (sem endereço completo, por decisão do proprietário). "Rio X7 Agência Digital" é a marca usada (o nome fantasia cadastral é outro e não é publicado) | base pública do CNPJ (BrasilAPI e CNPJ.ws, atualizada em 10/10/2026); comprovante oficial da Receita a anexar pelo proprietário |
| Atendimento: Setor de Privacidade e Proteção de Dados, suporte@riox7comunicacao.com.br, resposta em até 15 dias, observados os prazos legais | proprietário |
| Foro: Petrópolis – RJ, ressalvadas as regras legais | proprietário |
| Banco de dados, autenticação e arquivos na Supabase, região São Paulo (`sa-east-1`) | conexão do projeto `ybgzlxgeoiggmfdxarqx` |
| E-mails de recuperação de senha enviados pela autenticação da Supabase (`resetPasswordForEmail`); não há SMTP próprio configurado no repositório | `lib/dal/auth.ts`, `supabase/config.toml`, `docs/RUNBOOK-SAAS-HOSTINGER.md` |
| E-mail do domínio na Hostinger (MX `mx1/mx2.hostinger.com`) | DNS público |
| Cookies: só sessão, empresa em uso, tema, menu e último funil; nenhum script de análise ou publicidade; fontes servidas pelo próprio site | código (`proxy.ts`, `app/layout.tsx`, `components/layout/*`, `seletor-funil.tsx`) |
| Google Agenda desligado para os clientes (sem tela; recurso oculto nos planos) — não é anunciado | `app/(app)/configuracoes/agenda/page.tsx`, `RECURSOS_OCULTOS` |
| Nenhum provedor de pagamento integrado (há só o registro manual de eventos) | `pagamento_eventos`, painel admin |
| "Excluir" de clientes e negociações é lógico (`excluido_em`); não existe eliminação definitiva pelo app | `lib/dal/**` |
| Não há rotina automática de descarte nem de expurgo (nenhum `cron`; só limpeza de estados OAuth expirados) | `supabase/migrations/**` |
| Cópias de segurança: manuais (`pg_dump` por `C:\Tools\crm-rx7\backup.ps1`) antes de manutenções, guardadas em `C:\Backups\crm-rx7`; o plano Free do Supabase não tem backup automático | `docs/ISOLAMENTO-ESCOPO.md`, `docs/RUNBOOK-M1.md` |

## Para revisão jurídica (não impedem a publicação técnica)

1. **Encarregado (LGPD, art. 41).** Nenhum encarregado foi nomeado e o texto
   não afirma que haja. Decidir entre nomear (e publicar nome e contato) ou
   enquadrar a empresa como agente de pequeno porte (Resolução CD/ANPD
   nº 2/2022), que dispensa a indicação mas exige canal de atendimento — o
   canal já está publicado. Avaliar se o volume de dados de leads tratado
   afasta esse enquadramento.
2. **Bases legais** do item 4 da Política (execução de contrato, legítimo
   interesse, obrigação legal, exercício de direitos).
3. **Transferência internacional (art. 33).** O texto só informa que Google,
   Meta e funções da Supabase podem tratar dados fora do Brasil; avaliar o
   mecanismo aplicável (ex.: cláusulas-padrão da Resolução CD/ANPD nº 19/2024)
   e a região do servidor da Hostinger.
4. **Registros de acesso (Marco Civil, art. 15: mínimo de 6 meses).** O texto
   diz "pelo tempo necessário", sem prazo. Conferir se a retenção de registros
   de acesso da Supabase no plano atual atende a esse mínimo.
5. **Retenção após o contrato e descarte.** Sem política definida: o texto diz
   que segue o contrato e que a eliminação é por pedido, não automática.
6. **Cópias de segurança.** Definir prazo de descarte, local de guarda (hoje
   numa estação de trabalho) e criptografia. O texto só diz que podem conter
   dados eliminados até o descarte.
7. **Termos:** prevalência do contrato comercial, cláusula de
   responsabilidade, suspensão imediata, "antecedência razoável" para
   mudanças, e a cláusula de operador (art. 39) no contrato com os clientes.

## Conferência operacional antes de publicar

- Enviar um e-mail de teste, de fora, para suporte@riox7comunicacao.com.br e
  confirmar o recebimento (é o canal de exclusão informado ao Google e à Meta).
