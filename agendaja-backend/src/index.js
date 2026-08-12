require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// Rotas principais (a estruturar por módulo)
app.use('/auth', require('./routes/auth'));
app.use('/empresas', require('./routes/empresas'));
app.use('/servicos', require('./routes/servicos'));
app.use('/profissionais', require('./routes/profissionais'));
app.use('/agendamentos', require('./routes/agendamentos'));
app.use('/avaliacoes', require('./routes/avaliacoes'));
app.use('/pagamentos', require('./routes/pagamentos'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AgendaJá API rodando na porta ${PORT}`));

module.exports = { app, prisma };
