-- CreateTable
CREATE TABLE "Apartamento" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "numero" TEXT NOT NULL,
    "torre" TEXT NOT NULL,
    "andar" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Morador" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "apartamentoId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "Morador_apartamentoId_fkey" FOREIGN KEY ("apartamentoId") REFERENCES "Apartamento" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "login" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "senhaSalt" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "apartamentoId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "precisaTrocarSenha" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Usuario_apartamentoId_fkey" FOREIGN KEY ("apartamentoId") REFERENCES "Apartamento" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Porteiro" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Turno" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "porteiroId" INTEGER NOT NULL,
    "inicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim" DATETIME,
    CONSTRAINT "Turno_porteiroId_fkey" FOREIGN KEY ("porteiroId") REFERENCES "Porteiro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Encomenda" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codigo" TEXT NOT NULL,
    "apartamentoId" INTEGER NOT NULL,
    "destinatarioMoradorId" INTEGER,
    "destinatarioNome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "transportadora" TEXT,
    "observacao" TEXT,
    "local" TEXT,
    "status" TEXT NOT NULL DEFAULT 'aguardando',
    "recebidaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recebidaPorPorteiroId" INTEGER NOT NULL,
    "entregueEm" DATETIME,
    "entreguePorPorteiroId" INTEGER,
    "retiradaPorMoradorId" INTEGER,
    "retiradaTerceiroNome" TEXT,
    "retiradaTerceiroDoc" TEXT,
    "canceladaEm" DATETIME,
    "canceladaMotivo" TEXT,
    "avisoWhatsAppEm" DATETIME,
    CONSTRAINT "Encomenda_apartamentoId_fkey" FOREIGN KEY ("apartamentoId") REFERENCES "Apartamento" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encomenda_destinatarioMoradorId_fkey" FOREIGN KEY ("destinatarioMoradorId") REFERENCES "Morador" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encomenda_recebidaPorPorteiroId_fkey" FOREIGN KEY ("recebidaPorPorteiroId") REFERENCES "Porteiro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encomenda_entreguePorPorteiroId_fkey" FOREIGN KEY ("entreguePorPorteiroId") REFERENCES "Porteiro" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encomenda_retiradaPorMoradorId_fkey" FOREIGN KEY ("retiradaPorMoradorId") REFERENCES "Morador" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FotoEncomenda" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "encomendaId" INTEGER NOT NULL,
    "arquivo" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 1,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apagadaEm" DATETIME,
    CONSTRAINT "FotoEncomenda_encomendaId_fkey" FOREIGN KEY ("encomendaId") REFERENCES "Encomenda" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushInscricao" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushInscricao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LogEvento" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioId" INTEGER,
    "usuarioNome" TEXT NOT NULL,
    "papel" TEXT,
    "tipo" TEXT NOT NULL,
    "rota" TEXT NOT NULL,
    "detalhe" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogEvento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Apartamento_numero_key" ON "Apartamento"("numero");

-- CreateIndex
CREATE INDEX "Morador_apartamentoId_idx" ON "Morador"("apartamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_login_key" ON "Usuario"("login");

-- CreateIndex
CREATE INDEX "Turno_fim_idx" ON "Turno"("fim");

-- CreateIndex
CREATE UNIQUE INDEX "Encomenda_codigo_key" ON "Encomenda"("codigo");

-- CreateIndex
CREATE INDEX "Encomenda_status_recebidaEm_idx" ON "Encomenda"("status", "recebidaEm");

-- CreateIndex
CREATE INDEX "Encomenda_apartamentoId_status_idx" ON "Encomenda"("apartamentoId", "status");

-- CreateIndex
CREATE INDEX "FotoEncomenda_encomendaId_idx" ON "FotoEncomenda"("encomendaId");

-- CreateIndex
CREATE UNIQUE INDEX "PushInscricao_endpoint_key" ON "PushInscricao"("endpoint");

-- CreateIndex
CREATE INDEX "LogEvento_criadoEm_idx" ON "LogEvento"("criadoEm");

-- CreateIndex
CREATE INDEX "LogEvento_tipo_idx" ON "LogEvento"("tipo");
