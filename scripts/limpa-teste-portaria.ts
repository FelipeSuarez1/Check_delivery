/**
 * Apaga o que scripts/teste-portaria.ts criou (observacao com "[TESTE-PORTARIA]"): encomendas,
 * fotos (registro + arquivo em uploads/encomendas) e os LogEvento de rota da portaria dessas contas.
 * Dry-run por padrao; --aplicar grava. Nao toca em dados de outras pessoas.
 *   npx tsx scripts/limpa-teste-portaria.ts [--aplicar]
 */
import { unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const aplicar = process.argv.includes("--aplicar");

async function main() {
  const encs = await prisma.encomenda.findMany({
    where: { observacao: { contains: "[TESTE-PORTARIA]" } },
    include: { fotos: true },
  });
  console.log(`${encs.length} encomenda(s) de teste: ${encs.map((e) => e.codigo).join(", ") || "-"}`);
  const fotos = encs.flatMap((e) => e.fotos);
  console.log(`${fotos.length} foto(s)`);
  if (!aplicar) {
    console.log("dry-run: use --aplicar para apagar");
    return;
  }
  for (const f of fotos) {
    await unlink(path.join(process.cwd(), "uploads", "encomendas", f.arquivo)).catch(() => {});
  }
  await prisma.fotoEncomenda.deleteMany({ where: { encomendaId: { in: encs.map((e) => e.id) } } });
  await prisma.encomenda.deleteMany({ where: { id: { in: encs.map((e) => e.id) } } });
  console.log("apagado");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
