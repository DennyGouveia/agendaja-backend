const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { autenticar, autorizar } = require('../middleware/auth');
const { souAdminDaEmpresa } = require('./empresas');

const prisma = new PrismaClient();

function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function paraHHMM(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// ---------------------------------------------------------------
// Definir expediente semanal do profissional (bulk replace por dia)
// Só o próprio profissional pode editar sua agenda de trabalho
// ---------------------------------------------------------------
const horariosSchema = z.object({
  horarios: z.array(z.object({
    diaSemana: z.number().int().min(0).max(6),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    horaFim: z.string().regex(/^\d{2}:\d{2}$/),
  })),
});

router.post('/:id/horarios', autenticar, autorizar('PROFISSIONAL'), async (req, res) => {
  const profissional = await prisma.profissional.findUnique({ where: { usuarioId: req.usuario.id } });
  if (!profissional || profissional.id !== req.params.id) {
    return res.status(403).json({ erro: 'Você só pode definir o próprio expediente' });
  }

  const parse = horariosSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  await prisma.horarioTrabalho.deleteMany({ where: { profissionalId: profissional.id } });
  await prisma.horarioTrabalho.createMany({
    data: parse.data.horarios.map(h => ({ ...h, profissionalId: profissional.id })),
  });

  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------
// Horários livres — cruza expediente + bloqueios + agendamentos já feitos
// Público: o cliente precisa ver isso sem estar logado ainda
// ---------------------------------------------------------------
router.get('/:id/horarios-livres', async (req, res) => {
  const { data, servicoId, intervaloMin } = req.query;
  if (!data || !servicoId) {
    return res.status(400).json({ erro: 'Parâmetros "data" (YYYY-MM-DD) e "servicoId" são obrigatórios' });
  }

  const servico = await prisma.servico.findUnique({ where: { id: servicoId } });
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });

  const dataBase = new Date(`${data}T00:00:00`);
  const diaSemana = dataBase.getDay();
  const duracao = servico.duracaoMin;
  const passo = Number(intervaloMin) || 30; // granularidade dos slots candidatos

  const expedientes = await prisma.horarioTrabalho.findMany({
    where: { profissionalId: req.params.id, diaSemana },
  });
  if (expedientes.length === 0) {
    return res.json({ data, horariosLivres: [] }); // profissional não trabalha nesse dia
  }

  const inicioDia = new Date(`${data}T00:00:00`);
  const fimDia = new Date(`${data}T23:59:59`);

  const [agendamentos, bloqueios] = await Promise.all([
    prisma.agendamento.findMany({
      where: {
        profissionalId: req.params.id,
        status: { in: ['PENDENTE', 'CONFIRMADO'] },
        inicio: { gte: inicioDia, lte: fimDia },
      },
    }),
    prisma.bloqueio.findMany({
      where: {
        profissionalId: req.params.id,
        inicio: { lte: fimDia },
        fim: { gte: inicioDia },
      },
    }),
  ]);

  // Intervalos ocupados, em minutos desde 00:00 do dia
  const ocupados = [
    ...agendamentos.map(a => ({
      inicio: (a.inicio.getHours() * 60) + a.inicio.getMinutes(),
      fim: (a.fim.getHours() * 60) + a.fim.getMinutes(),
    })),
    ...bloqueios.map(b => ({
      inicio: Math.max(0, (b.inicio.getHours() * 60) + b.inicio.getMinutes()),
      fim: Math.min(24 * 60, (b.fim.getHours() * 60) + b.fim.getMinutes()),
    })),
  ];

  const livres = [];
  for (const exp of expedientes) {
    const inicioExp = paraMinutos(exp.horaInicio);
    const fimExp = paraMinutos(exp.horaFim);

    for (let candidato = inicioExp; candidato + duracao <= fimExp; candidato += passo) {
      const candidatoFim = candidato + duracao;
      const temConflito = ocupados.some(o => candidato < o.fim && candidatoFim > o.inicio);
      if (!temConflito) livres.push(paraHHMM(candidato));
    }
  }

  res.json({ data, servicoId, duracaoMin: duracao, horariosLivres: livres });
});

// ---------------------------------------------------------------
// Remover profissional da empresa
// Cadastro de profissional já é autoatendimento (via /auth/registro,
// escolhendo a empresaId) — aqui cobrimos o caminho inverso: o admin
// da empresa pode desligar um profissional que está vinculado a ela.
// ---------------------------------------------------------------
router.delete('/:id', autenticar, autorizar('EMPRESA_ADMIN'), async (req, res) => {
  const profissional = await prisma.profissional.findUnique({ where: { id: req.params.id } });
  if (!profissional) return res.status(404).json({ erro: 'Profissional não encontrado' });

  const autorizado = await souAdminDaEmpresa(req.usuario.id, profissional.empresaId);
  if (!autorizado) {
    return res.status(403).json({ erro: 'Você só pode remover profissionais da própria empresa' });
  }

  await prisma.profissional.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ---------------------------------------------------------------
// Bloqueios (folgas, exceções pontuais na agenda)
// Só o próprio profissional gerencia seus bloqueios
// ---------------------------------------------------------------
const bloqueioSchema = z.object({
  inicio: z.string().datetime(),
  fim: z.string().datetime(),
  motivo: z.string().optional(),
});

router.post('/:id/bloqueios', autenticar, autorizar('PROFISSIONAL'), async (req, res) => {
  const profissional = await prisma.profissional.findUnique({ where: { usuarioId: req.usuario.id } });
  if (!profissional || profissional.id !== req.params.id) {
    return res.status(403).json({ erro: 'Você só pode gerenciar os próprios bloqueios' });
  }

  const parse = bloqueioSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  const bloqueio = await prisma.bloqueio.create({
    data: { profissionalId: profissional.id, inicio: new Date(parse.data.inicio), fim: new Date(parse.data.fim), motivo: parse.data.motivo },
  });
  res.status(201).json(bloqueio);
});

router.get('/:id/bloqueios', async (req, res) => {
  const bloqueios = await prisma.bloqueio.findMany({
    where: { profissionalId: req.params.id },
    orderBy: { inicio: 'asc' },
  });
  res.json(bloqueios);
});

router.delete('/bloqueios/:bloqueioId', autenticar, autorizar('PROFISSIONAL'), async (req, res) => {
  const bloqueio = await prisma.bloqueio.findUnique({ where: { id: req.params.bloqueioId } });
  if (!bloqueio) return res.status(404).json({ erro: 'Bloqueio não encontrado' });

  const profissional = await prisma.profissional.findUnique({ where: { usuarioId: req.usuario.id } });
  if (!profissional || bloqueio.profissionalId !== profissional.id) {
    return res.status(403).json({ erro: 'Você só pode remover os próprios bloqueios' });
  }

  await prisma.bloqueio.delete({ where: { id: req.params.bloqueioId } });
  res.status(204).send();
});

module.exports = router;
