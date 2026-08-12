const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { autenticar, autorizar } = require('../middleware/auth');
const prisma = new PrismaClient();

// Cria um agendamento verificando conflito de horário
// Apenas o próprio cliente pode criar sua reserva
router.post('/', autenticar, autorizar('CLIENTE'), async (req, res) => {
  const { profissionalId, servicoId, inicio } = req.body;

  // O cliente é identificado pelo token, nunca confiar em clienteId vindo do body
  const cliente = await prisma.cliente.findUnique({ where: { usuarioId: req.usuario.id } });
  if (!cliente) return res.status(404).json({ erro: 'Cadastro de cliente não encontrado' });
  const clienteId = cliente.id;

  const servico = await prisma.servico.findUnique({ where: { id: servicoId } });
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });

  const inicioDate = new Date(inicio);
  const fimDate = new Date(inicioDate.getTime() + servico.duracaoMin * 60000);

  // Verifica conflito com agendamentos existentes do profissional
  const conflito = await prisma.agendamento.findFirst({
    where: {
      profissionalId,
      status: { in: ['PENDENTE', 'CONFIRMADO'] },
      OR: [
        { inicio: { lt: fimDate }, fim: { gt: inicioDate } },
      ],
    },
  });

  if (conflito) {
    return res.status(409).json({ erro: 'Horário indisponível para este profissional' });
  }

  const agendamento = await prisma.agendamento.create({
    data: {
      clienteId,
      profissionalId,
      servicoId,
      inicio: inicioDate,
      fim: fimDate,
      status: 'PENDENTE',
    },
  });

  res.status(201).json(agendamento);
});

router.get('/', autenticar, async (req, res) => {
  const { profissionalId, clienteId } = req.query;
  const agendamentos = await prisma.agendamento.findMany({
    where: {
      ...(profissionalId && { profissionalId }),
      ...(clienteId && { clienteId }),
    },
    include: { servico: true },
    orderBy: { inicio: 'asc' },
  });
  res.json(agendamentos);
});

module.exports = router;
