# WhatsApp oficial (Cloud API) — preparação da homologação real

Estado em 28/10/2026 (os ajustes do item 2 estão prontos só na cópia local):
- Código publicado em produção (função `integracoes` v3 e site `7254470`), mas **desligado**: a
  chave `whatsapp_oficial` está falsa, nenhuma empresa está liberada e não há nenhum `META_*`
  configurado.
- Nunca falou com a Meta real.
- O serviço antigo Baileys/QR Code continua desligado e **não é usado**.

Conferido na documentação oficial da Meta em 28/10/2026: [Tech Provider](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers),
[Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup),
[versões do Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup/versions),
[onboarding como Tech Provider](https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider),
[preços](https://developers.facebook.com/docs/whatsapp/pricing).

## 1. O que já existe (testado só contra a Meta simulada)

| Parte | Situação |
|---|---|
| Conexão **individual por empresa** (Embedded Signup: código → token da empresa → confere o número → assina o webhook da conta) | código pronto; só simulado |
| Token da Meta no **Vault**, nunca na tela | pronto (testado no banco) |
| **Funil, etapa e responsável** por número; quem escreve vira lead (regra de destino única: reaproveita negociação aberta, não duplica cliente) | pronto (testes SQL) |
| Webhook com assinatura `X-Hub-Signature-256`; empresa descoberta pelo `phone_number_id` no banco, nunca pelo corpo | pronto; só simulado |
| Caixa **Conversas** no CRM: receber e responder **só dentro da janela de 24 h** | pronto; só simulado |
| **Custo**: franquia de 1.000 mensagens de serviço por número/mês, reserva antes de enviar, conferência com a Meta, alertas 80/90/100 %, bloqueio preventivo, templates/marketing/automação desligados, limite diário | pronto (testes SQL e e2e) |
| Isolamento multiempresa (chave + lista de liberação por empresa, RLS); menu "Conversas" some com o WhatsApp desligado | pronto e publicado (desligado) |

## 2. Ajustes para a homologação real — IMPLEMENTADOS LOCALMENTE (28/10/2026)

Nada disto está publicado: sem commit, sem migration em produção, sem deploy.

1. **Registro do número na Cloud API** (`POST /<PHONE_NUMBER_ID>/register`, `messaging_product:
   "whatsapp"` + PIN de 6 dígitos).
   - Migration `20261103090000_whatsapp_registro_numero.sql`: situação nova `pendente_registro`.
     Número novo nasce pendente e **não recebe lead, não envia, não pode ser "retomado"** e fica fora
     da conferência da franquia. Só vira `conectado` quando a Meta confirma o registro.
   - O PIN é pedido **antes** de abrir a janela da Meta (o código dela vale ~30 s), vai da tela direto
     para a Meta pelo servidor e **não é gravado** em nenhum lugar (nem banco, nem Vault, nem log).
   - Falha (PIN incorreto, número ainda não verificado, muitas tentativas…) vira texto nosso; o número
     fica "Falta registrar o número" no painel, com o campo do PIN para tentar de novo.
   - **Limite de pedidos de registro** (Meta: 10 por número numa janela móvel de 72 h, contando os
     que falham; no excesso devolve **133016** e bloqueia o número por 72 h). Cada pedido é contado
     no banco **antes** de chamar a Meta, e o AVANTE para em **5 por hora e 8 em 72 h** (margem de 2).
     Recebido 133016, nenhuma tentativa nova por 72 h; o painel mostra o horário de liberação.
   - A tela orienta a guardar o PIN num gerenciador de senhas ou cofre da empresa (ele será pedido
     se o número for registrado de novo) e a não enviá-lo por WhatsApp, e-mail ou planilha.
2. **Embedded Signup v4**: `extras: {}` (produtos na configuração do Login do Facebook para
   Empresas). A versão da Graph API do SDK da janela vem do servidor (`META_GRAPH_VERSION`, fonte
   única). Continua **v23.0** (suportada pela Meta até 08/10/2027); subir para v26 é um passo
   separado, depois de validar os endpoints usados.
3. **Fim do fluxo** tratado na tela, cada um com mensagem própria:
   - `FINISH` → número novo, registra com PIN;
   - `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` → coexistência (número do app WhatsApp Business):
     conectado sem registro, marcado como coexistência;
   - `FINISH_ONLY_WABA` → concluído sem número: nada conectado;
   - `CANCEL` (com a etapa) e erro relatado pela Meta → nada conectado;
   - fluxos que o AVANTE não usa (migração OBO, só acesso à API) → recusados.
   - Retorno repetido (clique duplo, callback de novo em até 10 min) devolve o estado atual, sem
     trocar o código de novo; número pendente é só registrado.
4. **Orientação de pagamento**: antes de conectar (política de custos) e na tela de sucesso, com
   link para o WhatsApp Manager. O AVANTE **não cadastra** forma de pagamento.

Testes locais: SQL `whatsapp_registro_test.sql` (50), `integracoes_sheets_whatsapp_test.sql` (75) e
`franquia_destino_capi_test.sql` (86); unitários do WhatsApp e do serviço (74); e2e HTTP 142/142
(32 de registro); tela 43/43 (13 do WhatsApp); Deno real (smoke + `deno check`); typecheck, lint e build.

## 3. O que você configura na Meta (Rio X7)

1. **Portfólio empresarial** da Rio X7 no Meta Business Suite e **verificação da empresa** (razão
   social, CNPJ, endereço, telefone, e-mail, site; documentos se a Meta pedir). Sem a verificação
   não há App Review.
2. **App da Meta** com o caso de uso **WhatsApp**, ligado ao portfólio:
   - ícone, categoria e **URL da política de privacidade** (a mesma página pública que o Google
     também exige, em `avante.riox7comunicacao.com.br`);
   - em Login do Facebook para Empresas, domínio permitido do SDK JavaScript:
     `https://avante.riox7comunicacao.com.br`.
3. **Configuração do Login do Facebook para Empresas** para o Embedded Signup. Ao escolher os
   produtos, ela já fica em v4, e gera o **ID de configuração** (`META_CONFIG_ID`). Escolher o
   produto WhatsApp Cloud API; a opção de número do app WhatsApp Business (coexistência) só se for
   homologar esse caso também.
4. **Webhook do app**:
   - URL `https://ybgzlxgeoiggmfdxarqx.supabase.co/functions/v1/integracoes/whatsapp/webhook`;
   - token de verificação aleatório (`META_VERIFY_TOKEN`);
   - campo **messages** assinado.
5. **App Review / Tech Provider**: acesso avançado a `whatsapp_business_messaging` e
   `whatsapp_business_management`, mais a verificação de acesso. A Meta pede 2 vídeos: uma mensagem
   enviada pelo app chegando no WhatsApp e a criação de um modelo (pode ser gravação do WhatsApp
   Manager). Antes da verificação completa, o limite é de **10 empresas novas a cada 7 dias**
   (passa a 200 depois).
6. **Secrets no Supabase** (você digita; nada no chat): `META_APP_ID`, `META_APP_SECRET`,
   `META_CONFIG_ID`, `META_VERIFY_TOKEN` e, opcionalmente, `META_GRAPH_VERSION`.

**Número para testar:**
- Precisa ser um número **real**, que receba SMS ou ligação e não esteja em uso no WhatsApp; um
  chip novo resolve.
- Os números de teste criados no painel do desenvolvedor **não** podem ser conectados pelo Embedded
  Signup. Eles servem só para o vídeo de envio do App Review.
- Coexistência (número que já está no app WhatsApp Business) está tratada no código, mas depende
  da opção na configuração do login e das regras da Meta. Homologar primeiro com número novo.

## 4. Regras de cobrança da Meta (vigentes em 28/10/2026)

- Cobrança **por mensagem entregue**, por categoria e país. Mensagem recebida do cliente não é cobrada.
- **Janela de atendimento de 24 h**: abre quando o cliente escreve. Dentro dela, só mensagem livre
  (de serviço); fora dela, só modelo (template), que é sempre pago e está desligado no AVANTE.
- **Franquia gratuita**: 1.000 mensagens de serviço entregues por número de empresa por mês.
  Reinicia à meia-noite no fuso da conta e não acumula. Desde **01/10/2026**, a partir da
  1.001ª é cobrado, e o webhook passa de `free_customer_service` para `regular`.
- Templates **utility** dentro da janela voltaram a ser cobrados em 01/10/2026.
- Quem chega por anúncio Click-to-WhatsApp tem respostas grátis por até 7 dias. Fica para a fase de
  anúncios.
- No Brasil, a cobrança em **BRL** está disponível desde 16/07/2026, e a migração para BRL é exigida
  até 30/06/2027.

O AVANTE segue "somente gratuitos": reserva antes de enviar, bloqueia perto do limite (com
margem), bloqueia se não conseguir confirmar o consumo do mês e nunca envia modelos. Isso controla
**o que sai pelo AVANTE**. Outros sistemas ligados ao mesmo número podem gerar cobrança por conta
própria.

## 5. Roteiro de homologação (Empresa Teste A, cada passo com autorização)

1. **Preparação Meta** (você, item 3): verificação da empresa, app, configuração do login, webhook
   e App Review.
2. **Publicar os ajustes do item 2** (já testados localmente): commit, dry-run e aplicação da
   migration `20261103090000`, deploy da função `integracoes` e do site — cada um com autorização.
3. **Secrets `META_*`**, digitados por você. Depois, conferir o webhook:
   - o GET de verificação da Meta tem de devolver o desafio;
   - aviso sem assinatura tem de dar 401.
4. **Liberar `whatsapp_oficial` só para a Teste A**, pela lista de liberação. A chave global
   continua desligada.
5. Na Teste A (janela de Super Admin autorizada): escolher funil, etapa e responsável (nunca o
   Super Admin) → PIN de 6 números → **Conectar WhatsApp** → Embedded Signup → tela "Número
   conectado" com as quatro etapas marcadas. Conferir no banco: `conectado`, `registrado_em`
   preenchido, webhook assinado.
6. A empresa de teste **adiciona a forma de pagamento** no WhatsApp Manager.
7. Do seu celular, mandar "Olá" para o número. Conferir:
   - o lead criado no funil e destino certos, sem duplicar;
   - a conversa em **Conversas**;
   - o contador da franquia.
8. Responder pelo CRM dentro de 24 h. Conferir:
   - a entrega, com os status enviado, entregue e lido;
   - o tipo de preço `free_customer_service`;
   - o contador.
9. Conferir os bloqueios:
   - resposta fora da janela recusada sem chamar a Meta;
   - nenhum modelo nem envio em massa;
   - outra empresa não vê a conversa.
10. Para desligar a qualquer momento: tirar a Teste A da lista de liberação. Sem a chave, o
    webhook é ignorado e nada sai.

**Não fazer na homologação:** conectar número de cliente real, enviar mensagem para quem não
escreveu antes, ativar cobranças, liberar outras empresas.
