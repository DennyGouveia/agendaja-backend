const { MercadoPagoConfig, PreApproval } = require('mercadopago');

if (!process.env.MP_ACCESS_TOKEN) {
  console.warn('[AgendaJá] MP_ACCESS_TOKEN não configurado — pagamentos vão falhar até isso ser definido no .env');
}

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// PreApproval = assinatura recorrente do Mercado Pago (ideal pra cobrança mensal de plano)
const preApproval = new PreApproval(client);

module.exports = { preApproval };
