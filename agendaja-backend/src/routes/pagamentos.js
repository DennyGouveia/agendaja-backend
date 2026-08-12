const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { preApproval } = require('../utils/mercadopago');

const prisma = new PrismaClient();
const MAX_TENTATIVAS_FALHAS = 3; // depois disso, cancela a assinatura automaticamente

// Valida a assinatura HMAC que o Mercado Pago envia no header x-signature.
// Sem isso, qualquer um poderia chamar esse endpoint e "ativar" uma empresa de graça.
function assinaturaValida(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Mercado Pago] MP_WEBHOOK_SECRET não configurado — pulando validação (NÃO faça isso em produção)');
    return true;
  }

  const signatureHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;

  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hash === parts.v1;
}

// O Mercado Pago chama esse endpoint sempre que o status de uma assinatura
// (preapproval) ou pagamento muda. A gente reage só ao que importa: aprovação.
router.post('/webhook', async (req, res) => {
  // Responde 200 rápido — o MP reenvia se não receber 2xx, e não queremos
  // reprocessar em loop se algo demorar do nosso lado.
  res.sendStatus(200);

  if (!assinaturaValida(req)) {
    console.warn('[Mercado Pago] Webhook com assinatura inválida — ignorado');
    return;
  }

  const { type, data } = req.body;
  if (type === 'preapproval' || type === 'subscription_preapproval') {
    await tratarMudancaDePreapproval(data.id);
  } else if (type === 'subscription_authorized_payment') {
    await tratarTentativaDeCobranca(data.id);
  }
});

// Preapproval mudou de status diretamente (ex: cliente cancelou pelo próprio Mercado Pago)
async function tratarMudancaDePreapproval(preapprovalId) {
  try {
    const mpAssinatura = await preApproval.get({ id: preapprovalId });

    const assinatura = await prisma.assinatura.findUnique({
      where: { mpPreapprovalId: preapprovalId },
    });
    if (!assinatura) {
      console.warn(`[Mercado Pago] Webhook recebido pra preapproval desconhecida: ${preapprovalId}`);
      return;
    }

    if (mpAssinatura.status === 'authorized' && assinatura.status !== 'ATIVA') {
      const agora = new Date();
      const proximaCobranca = new Date(agora);
      proximaCobranca.setDate(proximaCobranca.getDate() + 30);

      await prisma.assinatura.update({
        where: { id: assinatura.id },
        data: { status: 'ATIVA', iniciadaEm: agora, proximaCobranca, tentativasFalhas: 0 },
      });
      console.log(`[Mercado Pago] Assinatura ${assinatura.id} ativada`);
    } else if (['cancelled', 'paused'].includes(mpAssinatura.status)) {
      await prisma.assinatura.update({
        where: { id: assinatura.id },
        data: { status: mpAssinatura.status === 'cancelled' ? 'CANCELADA' : 'ATRASADA' },
      });
      console.log(`[Mercado Pago] Assinatura ${assinatura.id} -> ${mpAssinatura.status}`);
    }
  } catch (err) {
    console.error('[Mercado Pago] Erro ao processar preapproval:', err.message);
  }
}

// Cada cobrança mensal recorrente gera esse evento — é aqui que pegamos
// cartão recusado, saldo insuficiente, etc.
async function tratarTentativaDeCobranca(authorizedPaymentId) {
  try {
    const resp = await fetch(`https://api.mercadopago.com/authorized_payments/${authorizedPaymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    if (!resp.ok) {
      console.error(`[Mercado Pago] Falha ao buscar authorized_payment ${authorizedPaymentId}: ${resp.status}`);
      return;
    }
    const pagamento = await resp.json();

    const assinatura = await prisma.assinatura.findUnique({
      where: { mpPreapprovalId: pagamento.preapproval_id },
    });
    if (!assinatura) {
      console.warn(`[Mercado Pago] Cobrança recebida pra preapproval desconhecida: ${pagamento.preapproval_id}`);
      return;
    }

    if (pagamento.status === 'approved') {
      const proximaCobranca = new Date();
      proximaCobranca.setDate(proximaCobranca.getDate() + 30);

      await prisma.assinatura.update({
        where: { id: assinatura.id },
        data: { status: 'ATIVA', proximaCobranca, tentativasFalhas: 0, ultimaFalhaEm: null },
      });
      console.log(`[Mercado Pago] Cobrança aprovada — assinatura ${assinatura.id} em dia`);

    } else if (['rejected', 'cancelled'].includes(pagamento.status)) {
      const novasTentativas = assinatura.tentativasFalhas + 1;
      const cancelar = novasTentativas >= MAX_TENTATIVAS_FALHAS;

      await prisma.assinatura.update({
        where: { id: assinatura.id },
        data: {
          status: cancelar ? 'CANCELADA' : 'ATRASADA',
          tentativasFalhas: novasTentativas,
          ultimaFalhaEm: new Date(),
        },
      });

      if (cancelar) {
        // Cancela a assinatura recorrente no próprio Mercado Pago também,
        // pra parar de tentar cobrar um cartão que já falhou 3 vezes
        await preApproval.update({ id: pagamento.preapproval_id, body: { status: 'cancelled' } }).catch(err =>
          console.error('[Mercado Pago] Falha ao cancelar preapproval após esgotar tentativas:', err.message)
        );
        console.log(`[Mercado Pago] Assinatura ${assinatura.id} CANCELADA após ${novasTentativas} falhas de cobrança`);
      } else {
        console.log(`[Mercado Pago] Cobrança recusada (tentativa ${novasTentativas}/${MAX_TENTATIVAS_FALHAS}) — assinatura ${assinatura.id} ATRASADA`);
      }
    }
  } catch (err) {
    console.error('[Mercado Pago] Erro ao processar cobrança recorrente:', err.message);
  }
}

module.exports = router;
