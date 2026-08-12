-- CreateEnum
CREATE TYPE "TipoUsuario" AS ENUM ('EMPRESA_ADMIN', 'PROFISSIONAL', 'CLIENTE');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('PENDENTE', 'CONFIRMADO', 'CANCELADO', 'CONCLUIDO', 'NAO_COMPARECEU');

-- CreateEnum
CREATE TYPE "Plano" AS ENUM ('BASICO', 'PROFISSIONAL', 'PREMIUM');

-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('PENDENTE', 'ATIVA', 'ATRASADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "tipo" "TipoUsuario" NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "senhaHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "setor" TEXT NOT NULL,
    "descricao" TEXT,
    "endereco" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assinatura" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "plano" "Plano" NOT NULL,
    "valorMensal" DECIMAL(65,30) NOT NULL,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'PENDENTE',
    "mpPreapprovalId" TEXT,
    "iniciadaEm" TIMESTAMP(3),
    "proximaCobranca" TIMESTAMP(3),
    "tentativasFalhas" INTEGER NOT NULL DEFAULT 0,
    "ultimaFalhaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profissional" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "Profissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servico" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "duracaoMin" INTEGER NOT NULL,
    "preco" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "Servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorarioTrabalho" (
    "id" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,

    CONSTRAINT "HorarioTrabalho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bloqueio" (
    "id" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,

    CONSTRAINT "Bloqueio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agendamento" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvaliacaoCliente" (
    "id" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "compareceu" BOOLEAN NOT NULL,
    "atrasoMais15" BOOLEAN NOT NULL,
    "cancelouTarde" BOOLEAN NOT NULL,
    "nota" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvaliacaoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvaliacaoProfissional" (
    "id" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "pontualidade" INTEGER NOT NULL,
    "qualidade" INTEGER NOT NULL,
    "atendimento" INTEGER NOT NULL,
    "limpeza" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvaliacaoProfissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndiceConfiabilidade" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "pontuacao" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndiceConfiabilidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EmpresaAdmins" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Assinatura_empresaId_key" ON "Assinatura"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Assinatura_mpPreapprovalId_key" ON "Assinatura"("mpPreapprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "Profissional_usuarioId_key" ON "Profissional"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_usuarioId_key" ON "Cliente"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "AvaliacaoCliente_agendamentoId_key" ON "AvaliacaoCliente"("agendamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "AvaliacaoProfissional_agendamentoId_key" ON "AvaliacaoProfissional"("agendamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "IndiceConfiabilidade_usuarioId_key" ON "IndiceConfiabilidade"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "_EmpresaAdmins_AB_unique" ON "_EmpresaAdmins"("A", "B");

-- CreateIndex
CREATE INDEX "_EmpresaAdmins_B_index" ON "_EmpresaAdmins"("B");

-- AddForeignKey
ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profissional" ADD CONSTRAINT "Profissional_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profissional" ADD CONSTRAINT "Profissional_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorarioTrabalho" ADD CONSTRAINT "HorarioTrabalho_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bloqueio" ADD CONSTRAINT "Bloqueio_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "Servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvaliacaoCliente" ADD CONSTRAINT "AvaliacaoCliente_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "Agendamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvaliacaoCliente" ADD CONSTRAINT "AvaliacaoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvaliacaoProfissional" ADD CONSTRAINT "AvaliacaoProfissional_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "Agendamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvaliacaoProfissional" ADD CONSTRAINT "AvaliacaoProfissional_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EmpresaAdmins" ADD CONSTRAINT "_EmpresaAdmins_A_fkey" FOREIGN KEY ("A") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EmpresaAdmins" ADD CONSTRAINT "_EmpresaAdmins_B_fkey" FOREIGN KEY ("B") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
