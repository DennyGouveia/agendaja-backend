const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { gerarToken } = require('../utils/jwt');
const { preApproval } = require('../utils/mercadopago');

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;
const DIAS_CARENCIA = 3; // dias que a conta continua funcionando após uma cobrança falhar, antes de bloquear

const PRECOS_PLANO = { BASICO: 39.90, PROFISSIONAL: 79.90, PREMIUM: 149.90 };

const registroSchema = z.object({
  tipo: z.enum(['EMPRESA_ADMIN', 'PROFISSIONAL', 'CLIENTE']),
  nome: z.string().min(2),
  email: z.string().email(),
  telefone: z.string().optional(),
  senha: z.string().min(8),
  // Necessário apenas quando tipo === 'EMPRESA_ADMIN' (cadastro autoatendimento)
  empresa: z.object({
    nome: z.string().min(2),
    setor: z.string().min(2),
    descricao: z.string().optional(),
    endereco: z.string().optional(),
    plano: z.enum(['BASICO', 'PROFISSIONAL', 'PREMIUM']),
  }).optional(),
  // Necessário apenas quando tipo === 'PROFISSIONAL'
  empresaId: z.string().uuid().optional(),
});

// Cadastro — autoatendimento para empresas, clientes e profissionais
router.post('/registro', async (req, res) => {
  const parse = registroSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }
  const dados = parse.data;

  const existente = await prisma.usuario.findUnique({ where: { email: dados.email } });
  if (existente) {
    return res.status(409).json({ erro: 'Já existe uma conta com este e-mail' });
  }

  if (dados.tipo === 'EMPRESA_ADMIN' && !dados.empresa) {
    return res.status(400).json({ erro: 'Dados da empresa são obrigatórios para este tipo de cadastro' });
  }
  if (dados.tipo === 'PROFISSIONAL' && !dados.empresaId) {
    return res.status(400).json({ erro: 'empresaId é obrigatório para cadastro de profissional' });
  }

  const senhaHash = await bcrypt.hash(dados.senha, SALT_ROUNDS);

  const usuario = await prisma.usuario.create({
    data: {
      tipo: dados.tipo,
      nome: dados.nome,
      email: dados.email,
      telefone: dados.telefone,
      senhaHash,
    },
  });

  // Cria os registros complementares conforme o tipo
  if (dados.tipo === 'EMPRESA_ADMIN') {
    const empresa = await prisma.empresa.create({
      data: {
        nome: dados.empresa.nome,
        setor: dados.empresa.setor,
        descricao: dados.empresa.descricao,
        endereco: dados.empresa.endereco,
        admins: { connect: { id: usuario.id } },
      },
    });

    const valorMensal = PRECOS_PLANO[dados.empresa.plano];

    const assinatura = await prisma.assinatura.create({
      data: {
        empresaId: empresa.id,
        plano: dados.empresa.plano,
        valorMensal,
        status: 'PENDENTE',
      },
    });

    // Cria a assinatura recorrente no Mercado Pago e devolve o link de checkout.
    // O cliente paga nesse link; o webhook (/pagamentos/webhook) ativa a assinatura quando aprovado.
    let initPoint;
    try {
      const mpAssinatura = await preApproval.create({
        body: {
          reason: `AgendaJá — Plano ${dados.empresa.plano} (${empresa.nome})`,
          external_reference: assinatura.id,
          payer_email: dados.email,
          back_url: process.env.MP_BACK_URL || 'https://agendaja.com/cadastro/sucesso',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: valorMensal,
            currency_id: 'BRL',
          },
          status: 'pending',
        },
      });
      await prisma.assinatura.update({
        where: { id: assinatura.id },
        data: { mpPreapprovalId: mpAssinatura.id },
      });
      initPoint = mpAssinatura.init_point;
    } catch (err) {
      console.error('[Mercado Pago] Falha ao criar assinatura:', err.message);
      // Não derruba o cadastro — o admin pode tentar pagar depois via rota de retry (a implementar)
    }

    // Login só é liberado depois que o pagamento for confirmado pelo webhook —
    // por isso NÃO devolvemos token aqui.
    return res.status(201).json({
      mensagem: 'Cadastro criado. Complete o pagamento pra liberar seu login.',
      assinaturaId: assinatura.id,
      plano: assinatura.plano,
      valorMensal: assinatura.valorMensal,
      linkPagamento: initPoint ?? null,
    });
  } else if (dados.tipo === 'PROFISSIONAL') {
    const empresa = await prisma.empresa.findUnique({ where: { id: dados.empresaId } });
    if (!empresa) {
      return res.status(404).json({ erro: 'Empresa não encontrada' });
    }
    await prisma.profissional.create({
      data: { usuarioId: usuario.id, empresaId: dados.empresaId },
    });
  } else if (dados.tipo === 'CLIENTE') {
    await prisma.cliente.create({ data: { usuarioId: usuario.id } });
  }

  const token = gerarToken(usuario);
  res.status(201).json({ token, usuario: { id: usuario.id, tipo: usuario.tipo, nome: usuario.nome } });
});

// Fallback SÓ PRA DESENVOLVIMENTO LOCAL — simula a confirmação sem precisar
// expor um webhook publicamente (ex: via ngrok) enquanto testa localmente.
// Em produção, a ativação de verdade acontece em POST /pagamentos/webhook.
router.post('/registro/confirmar-pagamento/:assinaturaId', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ erro: 'Rota de desenvolvimento desativada em produção' });
  }

  const assinatura = await prisma.assinatura.findUnique({
    where: { id: req.params.assinaturaId },
    include: { empresa: { include: { admins: true } } },
  });
  if (!assinatura) return res.status(404).json({ erro: 'Assinatura não encontrada' });
  if (assinatura.status === 'ATIVA') {
    return res.status(409).json({ erro: 'Pagamento já confirmado anteriormente' });
  }

  const agora = new Date();
  const proximaCobranca = new Date(agora);
  proximaCobranca.setDate(proximaCobranca.getDate() + 30);

  await prisma.assinatura.update({
    where: { id: assinatura.id },
    data: { status: 'ATIVA', iniciadaEm: agora, proximaCobranca },
  });

  const admin = assinatura.empresa.admins[0];
  const token = gerarToken(admin);
  res.json({ token, usuario: { id: admin.id, tipo: admin.tipo, nome: admin.nome } });
});

router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  const senhaCorreta = await bcrypt.compare(senha, usuario.senhaHash);
  if (!senhaCorreta) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  let avisoAssinatura = null;

  if (usuario.tipo === 'EMPRESA_ADMIN') {
    const empresa = await prisma.empresa.findFirst({
      where: { admins: { some: { id: usuario.id } } },
      include: { assinatura: true },
    });
    const status = empresa?.assinatura?.status;
    const ultimaFalhaEm = empresa?.assinatura?.ultimaFalhaEm;

    if (status === 'ATRASADA' && ultimaFalhaEm) {
      const fimDaCarencia = new Date(ultimaFalhaEm);
      fimDaCarencia.setDate(fimDaCarencia.getDate() + DIAS_CARENCIA);

      if (new Date() < fimDaCarencia) {
        // Ainda dentro do período de carência — deixa entrar, mas avisa
        const diasRestantes = Math.ceil((fimDaCarencia - new Date()) / (1000 * 60 * 60 * 24));
        avisoAssinatura = {
          tipo: 'ATRASADA',
          mensagem: `Sua última cobrança falhou. Atualize a forma de pagamento em até ${diasRestantes} dia(s) pra não perder o acesso.`,
        };
      } else {
        return res.status(402).json({
          erro: 'Sua conta foi bloqueada após o prazo de carência sem regularizar o pagamento. Atualize a forma de pagamento pra reativar.',
        });
      }
    } else if (status !== 'ATIVA') {
      const mensagens = {
        PENDENTE: 'Complete o pagamento pra liberar seu acesso',
        CANCELADA: 'Sua assinatura foi cancelada após várias tentativas de cobrança sem sucesso. Fale com o suporte pra reativar',
      };
      return res.status(402).json({ erro: mensagens[status] || 'Login bloqueado — verifique sua assinatura' });
    }
  }

  const token = gerarToken(usuario);
  res.json({
    token,
    usuario: { id: usuario.id, tipo: usuario.tipo, nome: usuario.nome },
    ...(avisoAssinatura && { avisoAssinatura }),
  });
});

module.exports = router;
