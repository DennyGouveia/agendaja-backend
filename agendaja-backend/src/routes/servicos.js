const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { autenticar, autorizar } = require('../middleware/auth');
const { souAdminDaEmpresa } = require('./empresas');

const prisma = new PrismaClient();

const servicoSchema = z.object({
  empresaId: z.string().uuid(),
  nome: z.string().min(2),
  duracaoMin: z.number().int().positive(),
  preco: z.number().nonnegative(),
});

// Criação — só o admin da empresa dona do serviço
router.post('/', autenticar, autorizar('EMPRESA_ADMIN'), async (req, res) => {
  const parse = servicoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  const autorizado = await souAdminDaEmpresa(req.usuario.id, parse.data.empresaId);
  if (!autorizado) {
    return res.status(403).json({ erro: 'Você só pode criar serviços para empresas das quais é administrador' });
  }

  const servico = await prisma.servico.create({ data: parse.data });
  res.status(201).json(servico);
});

// Listagem pública — cliente vendo o que a empresa oferece
router.get('/', async (req, res) => {
  const { empresaId } = req.query;
  if (!empresaId) return res.status(400).json({ erro: 'empresaId é obrigatório' });
  const servicos = await prisma.servico.findMany({ where: { empresaId } });
  res.json(servicos);
});

const atualizarServicoSchema = z.object({
  nome: z.string().min(2).optional(),
  duracaoMin: z.number().int().positive().optional(),
  preco: z.number().nonnegative().optional(),
});

router.put('/:id', autenticar, autorizar('EMPRESA_ADMIN'), async (req, res) => {
  const servico = await prisma.servico.findUnique({ where: { id: req.params.id } });
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });

  const autorizado = await souAdminDaEmpresa(req.usuario.id, servico.empresaId);
  if (!autorizado) {
    return res.status(403).json({ erro: 'Você só pode editar serviços da própria empresa' });
  }

  const parse = atualizarServicoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  const atualizado = await prisma.servico.update({ where: { id: req.params.id }, data: parse.data });
  res.json(atualizado);
});

router.delete('/:id', autenticar, autorizar('EMPRESA_ADMIN'), async (req, res) => {
  const servico = await prisma.servico.findUnique({ where: { id: req.params.id } });
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });

  const autorizado = await souAdminDaEmpresa(req.usuario.id, servico.empresaId);
  if (!autorizado) {
    return res.status(403).json({ erro: 'Você só pode remover serviços da própria empresa' });
  }

  await prisma.servico.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

module.exports = router;
