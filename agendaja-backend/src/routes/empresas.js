const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { autenticar, autorizar } = require('../middleware/auth');

const prisma = new PrismaClient();

// Busca pública — clientes navegando na plataforma, sem login
router.get('/', async (req, res) => {
  const { setor, busca } = req.query;
  const empresas = await prisma.empresa.findMany({
    where: {
      ...(setor && { setor }),
      ...(busca && { nome: { contains: busca, mode: 'insensitive' } }),
    },
    select: { id: true, nome: true, setor: true, descricao: true, endereco: true },
  });
  res.json(empresas);
});

router.get('/:id', async (req, res) => {
  const empresa = await prisma.empresa.findUnique({
    where: { id: req.params.id },
    include: {
      servicos: true,
      profissionais: { select: { id: true, usuario: { select: { nome: true } } } },
    },
  });
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada' });
  res.json(empresa);
});

// Verifica se o usuário autenticado é admin desta empresa específica.
// Isolamento multi-tenant: um EMPRESA_ADMIN só edita a própria empresa.
async function souAdminDaEmpresa(usuarioId, empresaId) {
  const vinculo = await prisma.empresa.findFirst({
    where: { id: empresaId, admins: { some: { id: usuarioId } } },
  });
  return !!vinculo;
}

const atualizarEmpresaSchema = z.object({
  nome: z.string().min(2).optional(),
  setor: z.string().min(2).optional(),
  descricao: z.string().optional(),
  endereco: z.string().optional(),
});

router.put('/:id', autenticar, autorizar('EMPRESA_ADMIN'), async (req, res) => {
  const autorizado = await souAdminDaEmpresa(req.usuario.id, req.params.id);
  if (!autorizado) {
    return res.status(403).json({ erro: 'Você só pode editar empresas das quais é administrador' });
  }

  const parse = atualizarEmpresaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  const empresa = await prisma.empresa.update({ where: { id: req.params.id }, data: parse.data });
  res.json(empresa);
});

module.exports = router;
module.exports.souAdminDaEmpresa = souAdminDaEmpresa;
