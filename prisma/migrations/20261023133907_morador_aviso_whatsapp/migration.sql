-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Morador" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "apartamentoId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "avisoWhatsApp" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "Morador_apartamentoId_fkey" FOREIGN KEY ("apartamentoId") REFERENCES "Apartamento" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Morador" ("apartamentoId", "ativo", "atualizadoEm", "criadoEm", "id", "nome", "telefone") SELECT "apartamentoId", "ativo", "atualizadoEm", "criadoEm", "id", "nome", "telefone" FROM "Morador";
DROP TABLE "Morador";
ALTER TABLE "new_Morador" RENAME TO "Morador";
CREATE INDEX "Morador_apartamentoId_idx" ON "Morador"("apartamentoId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
