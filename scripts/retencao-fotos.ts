/**
 * Retencao LGPD das fotos: remove do disco as fotos de encomendas entregues ou
 * canceladas ha mais de 90 dias (o registro da encomenda e da foto fica,
 * com apagadaEm preenchido). Roda diariamente na tarefa agendada do servidor.
 *   npx tsx scripts/retencao-fotos.ts            -> dry-run (so lista)
 *   npx tsx scripts/retencao-fotos.ts --aplicar  -> apaga
 *   opcional: --dias=120
 */
import { apagarFotosAntigas } from "../src/lib/fotos";
import { prisma } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const arg = args.find((a) => a.startsWith("--dias="));
  const dias = arg ? Number(arg.slice("--dias=".length)) : 90;
  if (!Number.isInteger(dias) || dias < 1) throw new Error("--dias deve ser um inteiro maior ou igual a 1");

  const r = await apagarFotosAntigas(dias, aplicar);
  console.log(`Retencao: fotos de encomendas entregues/canceladas antes de ${r.limite.toISOString()} (${r.dias} dias)`);
  console.log(`Modo: ${r.aplicado ? "APLICAR" : "dry-run (use --aplicar para apagar)"}`);
  console.log(`Fotos que se enquadram: ${r.itens.length}`);
  for (const i of r.itens.slice(0, 50)) {
    console.log(`  foto ${i.fotoId} | ${i.codigo} | ${i.status} desde ${i.desde.toISOString().slice(0, 10)} | ${i.arquivo}`);
  }
  if (r.itens.length > 50) console.log(`  ... e mais ${r.itens.length - 50}`);
  if (r.aplicado) {
    console.log(`Arquivos apagados: ${r.apagadas} | ja ausentes no disco: ${r.jaAusentes} | falhas: ${r.falhas.length}`);
    for (const f of r.falhas) console.log(`  FALHA foto ${f.fotoId}: ${f.erro}`);
    if (r.falhas.length > 0) process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("ERRO:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
