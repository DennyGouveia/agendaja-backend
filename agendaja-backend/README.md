# AgendaJá — Backend

API central multi-tenant do AgendaJá (agenda de atendimento para diversos setores comerciais).

## Stack
- Node.js + Express
- PostgreSQL + Prisma ORM
- JWT para autenticação

## Estrutura
```
prisma/schema.prisma   → modelo de dados completo
src/index.js           → entrada da API
src/routes/            → rotas por módulo (auth, empresas, servicos, agendamentos, avaliacoes)
```

## Pré-requisitos
- **Node.js 18 ou mais recente** (o script de teste usa `fetch` nativo, que só existe a partir do Node 18)
- **PostgreSQL** rodando localmente (ou um banco na nuvem — Railway e Supabase têm plano grátis, se não quiser instalar Postgres na sua máquina)

## Setup local
1. `npm install`
2. Copie `.env.example` pra `.env` e preencha `DATABASE_URL` e o `JWT_SECRET`
3. `npm run prisma:migrate` — cria as tabelas a partir do schema
4. `npm run dev` — inicia o servidor (deixe esse terminal aberto)

## Testando o fluxo completo automaticamente
Com o servidor rodando (passo 4 acima), abra **outro terminal** na mesma pasta e rode:
```
npm run test:fluxo
```
Isso executa o fluxo inteiro sozinho — cadastro de empresa, bloqueio de login antes do pagamento, confirmação de pagamento, criação de serviço, cadastro de profissional, definição de expediente, cadastro de cliente, checagem de disponibilidade, criação de agendamento, checagem de conflito de horário, e avaliação nos dois sentidos — imprimindo ✅ ou ❌ pra cada etapa. Se algo falhar, ele mostra o erro retornado pela API.

**Nota:** por padrão o Mercado Pago não é chamado de verdade nesse teste — se `MP_ACCESS_TOKEN` não estiver configurado, o cadastro de empresa continua funcionando (o erro do Mercado Pago é só logado, não derruba o cadastro), e o teste usa a rota de confirmação manual (`/auth/registro/confirmar-pagamento`) em vez do webhook.

## Configurando o Mercado Pago (pagamento dos planos)
1. Crie uma conta em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers/panel/app) e crie uma aplicação
2. Copie o **Access Token de teste** (`TEST-...`) pra `MP_ACCESS_TOKEN` no `.env` — dá pra desenvolver tudo com ele antes de ir pra produção
3. Pra testar o webhook localmente, exponha o servidor com [ngrok](https://ngrok.com) (`ngrok http 3000`) e cadastre a URL pública + `/pagamentos/webhook` no painel do Mercado Pago em **Webhooks** → **Configurar notificações**, marcando o evento `preapproval`
4. Copie a **assinatura secreta** gerada nessa configuração pra `MP_WEBHOOK_SECRET` no `.env` — sem isso o webhook aceita qualquer requisição (inseguro, só é tolerado assim em dev)
5. Use os [cartões de teste do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/test/cards) pra simular a aprovação do pagamento

## Já implementado
- Modelo de dados completo (empresas, profissionais, clientes, serviços, agendamentos, avaliações, índice de confiabilidade)
- **Autenticação completa** (`/auth/registro`, `/auth/login`) com bcrypt + JWT, cobrindo cadastro autoatendimento dos 3 tipos de usuário (empresa admin cria a empresa junto; profissional se vincula a uma empresa existente; cliente se cadastra livremente)
- Middleware `autenticar` (exige token válido) e `autorizar(...tipos)` (restringe rota por tipo de usuário)
- Rota de criação de agendamento — exige login de cliente, identifica o cliente pelo token (nunca pelo body) e checa conflito de horário do profissional
- Rota de listagem de agendamentos protegida por login
- **Avaliações com regras de visibilidade diferentes:**
  - Avaliação do **cliente** (feita pelo profissional): só checkbox + nota, sem comentário aberto. Histórico do cliente é **privado** — só visível para um profissional que já teve algum agendamento com aquele cliente (`GET /avaliacoes/cliente/:clienteId` valida esse vínculo antes de retornar qualquer dado)
  - Avaliação do **profissional/comércio** (feita pelo cliente): **pública**, qualquer visitante pode consultar a nota resumida sem login (`GET /avaliacoes/profissional/:id/resumo`)
- **CRUD de `empresas`**: busca pública (por setor/nome) e edição restrita ao admin da própria empresa (`souAdminDaEmpresa`, reaproveitado por outras rotas — isolamento multi-tenant)
- **CRUD de `servicos`**: listagem pública por empresa; criação/edição/remoção só pelo admin da empresa dona do serviço
- **Planos e assinatura** (`Assinatura` no schema, integração real com o **Mercado Pago**):
  - Cadastro de empresa exige escolher um `plano` (BASICO R$ 39,90 / PROFISSIONAL R$ 79,90 / PREMIUM R$ 149,90) — preço fica congelado na assinatura no momento da escolha
  - `/auth/registro` cria a `Assinatura` como `PENDENTE`, cria uma **assinatura recorrente (PreApproval) no Mercado Pago** e devolve `linkPagamento` — o admin paga nesse link, o token **não** é liberado nessa resposta
  - `POST /pagamentos/webhook` — endpoint que o Mercado Pago chama em dois casos: quando o status da **assinatura** muda (`preapproval`), e a cada **tentativa de cobrança mensal** (`subscription_authorized_payment`). Valida a assinatura HMAC do header `x-signature` antes de processar
  - **Cobrança aprovada** → assinatura fica/volta `ATIVA`, zera o contador de falhas
  - **Cobrança recusada** (cartão vencido, saldo insuficiente) → assinatura vira `ATRASADA` e soma uma tentativa; depois de **3 falhas seguidas**, cancela automaticamente (`CANCELADA`) e também cancela a assinatura recorrente no Mercado Pago, pra parar de tentar cobrar um cartão que não funciona
  - `POST /auth/registro/confirmar-pagamento/:assinaturaId` — atalho **só pra desenvolvimento local** (desativado se `NODE_ENV=production`), útil quando não dá pra testar o webhook publicamente
  - `/auth/login` dá **3 dias de carência** depois de uma cobrança falhar: durante esse prazo o login continua funcionando normalmente, só que a resposta inclui um campo `avisoAssinatura` (mensagem + prazo restante) pro app mostrar um aviso. Depois dos 3 dias sem regularizar, bloqueia (402). Pendente (nunca pagou) ou cancelada (esgotou as 3 tentativas de cobrança) bloqueiam sempre, sem carência
  - Limitação conhecida: a carência só é checada no momento do `/login` — um token emitido durante a carência continua válido por até 7 dias mesmo se o prazo vencer nesse meio tempo. Pra um bloqueio em tempo real, seria preciso um middleware verificando a assinatura em toda rota autenticada de EMPRESA_ADMIN
- **Disponibilidade de horários** (`profissionais.js`):
  - `POST /profissionais/:id/horarios` — o próprio profissional define seu expediente semanal (bulk replace por dia da semana)
  - `GET /profissionais/:id/horarios-livres?data=&servicoId=` — público, cruza expediente + bloqueios + agendamentos existentes e devolve os horários realmente livres pra aquele serviço naquele dia (é o endpoint que alimenta a grade de horários do app cliente)
  - `DELETE /profissionais/:id` — admin da empresa desliga um profissional
  - `POST/GET /profissionais/:id/bloqueios` e `DELETE /profissionais/bloqueios/:bloqueioId` — profissional gerencia as próprias folgas/exceções

## Próximos passos
- Job assíncrono de recálculo do Índice de Confiabilidade (marcado como TODO nas rotas de avaliação)
- Notificar o admin (e-mail/WhatsApp) quando a assinatura ficar `ATRASADA`, em vez de ele só descobrir ao tentar logar
- Tela de "atualizar forma de pagamento" pro admin resolver uma assinatura atrasada sem precisar cadastrar tudo de novo
- Testes automatizados (o projeto ainda não tem suíte de testes)
- Deploy: escolher provedor (Railway/Render pra começar) e trocar `MP_ACCESS_TOKEN` de teste pelo de produção
