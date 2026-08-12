const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { autenticar, autorizar } = require('../middleware/auth');

const prisma = new PrismaClient();

// ---------------------------------------------------------------
// AVALIAÇÃO DO CLIENTE (feita pelo profissional após o atendimento)
// Só checkboxes objetivos + nota. Sem comentário aberto.
// Visibilidade: PRIVADA — só o profissional que tiver um agendamento
// (passado ou pendente) com aquele cliente pode ver o histórico dele.
// ---------------------------------------------------------------

const avaliarClienteSchema = z.object({
  compareceu: z.boolean(),
  atrasoMais15: z.boolean(),
  cancelouTarde: z.boolean(),
  nota: z.number().int().min(1).max(5),
});

router.post('/cliente/:agendamentoId', autenticar, autorizar('PROFISSIONAL'), async (req, res) => {
  const parse = avaliarClienteSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  const profissional = await prisma.profissional.findUnique({ where: { usuarioId: req.usuario.id } });
  const agendamento = await prisma.agendamento.findUnique({ where: { id: req.params.agendamentoId } });

  if (!agendamento) return res.status(404).json({ erro: 'Agendamento não encontrado' });
  // Só o profissional que atendeu pode avaliar — garante o vínculo que também define visibilidade
  if (agendamento.profissionalId !== profissional.id) {
    return res.status(403).json({ erro: 'Você só pode avaliar clientes de agendamentos que atendeu' });
  }

  const avaliacao = await prisma.avaliacaoCliente.create({
    data: { agendamentoId: agendamento.id, clienteId: agendamento.clienteId, ...parse.data },
  });

  // TODO: disparar job assíncrono de recálculo do Índice de Confiabilidade do cliente
  res.status(201).json(avaliacao);
});

// Histórico do cliente — PRIVADO.
// Só retorna dados se o profissional autenticado já teve (ou tem) algum
// agendamento com esse cliente. Nunca é uma consulta pública.
router.get('/cliente/:clienteId', autenticar, autorizar('PROFISSIONAL'), async (req, res) => {
  const profissional = await prisma.profissional.findUnique({ where: { usuarioId: req.usuario.id } });

  const vinculo = await prisma.agendamento.findFirst({
    where: { profissionalId: profissional.id, clienteId: req.params.clienteId },
  });
  if (!vinculo) {
    return res.status(403).json({ erro: 'Você só pode ver o histórico de clientes que já solicitaram agendamento com você' });
  }

  const avaliacoes = await prisma.avaliacaoCliente.findMany({
    where: { clienteId: req.params.clienteId },
    select: { compareceu: true, atrasoMais15: true, cancelouTarde: true, nota: true, criadoEm: true },
    orderBy: { criadoEm: 'desc' },
  });
  const indice = await prisma.indiceConfiabilidade.findUnique({ where: { usuarioId: req.params.clienteId } });

  res.json({ historico: avaliacoes, indiceConfiabilidade: indice ?? null });
});

// ---------------------------------------------------------------
// AVALIAÇÃO DO PROFISSIONAL (feita pelo cliente após o atendimento)
// Visibilidade: PÚBLICA — a nota do profissional/comércio é
// visível para qualquer pessoa buscando na plataforma.
// ---------------------------------------------------------------

const avaliarProfissionalSchema = z.object({
  pontualidade: z.number().int().min(1).max(5),
  qualidade: z.number().int().min(1).max(5),
  atendimento: z.number().int().min(1).max(5),
  limpeza: z.number().int().min(1).max(5),
});

router.post('/profissional/:agendamentoId', autenticar, autorizar('CLIENTE'), async (req, res) => {
  const parse = avaliarProfissionalSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  const cliente = await prisma.cliente.findUnique({ where: { usuarioId: req.usuario.id } });
  const agendamento = await prisma.agendamento.findUnique({ where: { id: req.params.agendamentoId } });

  if (!agendamento) return res.status(404).json({ erro: 'Agendamento não encontrado' });
  if (agendamento.clienteId !== cliente.id) {
    return res.status(403).json({ erro: 'Você só pode avaliar atendimentos que você reservou' });
  }

  const avaliacao = await prisma.avaliacaoProfissional.create({
    data: { agendamentoId: agendamento.id, profissionalId: agendamento.profissionalId, ...parse.data },
  });

  // TODO: disparar job assíncrono de recálculo da nota pública do profissional
  res.status(201).json(avaliacao);
});

// Nota pública do profissional — sem autenticação, qualquer visitante vê
router.get('/profissional/:profissionalId/resumo', async (req, res) => {
  const avaliacoes = await prisma.avaliacaoProfissional.findMany({
    where: { profissionalId: req.params.profissionalId },
    select: { pontualidade: true, qualidade: true, atendimento: true, limpeza: true },
  });

  if (avaliacoes.length === 0) {
    return res.json({ totalAvaliacoes: 0, medias: null });
  }

  const somar = (campo) => avaliacoes.reduce((acc, a) => acc + a[campo], 0) / avaliacoes.length;
  res.json({
    totalAvaliacoes: avaliacoes.length,
    medias: {
      pontualidade: somar('pontualidade'),
      qualidade: somar('qualidade'),
      atendimento: somar('atendimento'),
      limpeza: somar('limpeza'),
    },
  });
});

module.exports = router;
