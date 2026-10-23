/**
 * Cria (ou reativa) porteiros pelo nome - idempotente.
 *   npx tsx scripts/cria-porteiros.ts                  -> Jose e Marcos (exemplos)
 *   npx tsx scripts/cria-porteiros.ts "Nome 1" "Nome 2"
 *   npx tsx scripts/cria-porteiros.ts ... --dry-run    -> so mostra o que faria
 * Comparacao por nome ignora acento e caixa ("jose" acha "José"). A saida do
 * console e ASCII (console do Windows e cp1252); o banco recebe o nome com acento.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (s: string) => semAcento(s).toLowerCase();
const limpar = (s: string) => s.trim().replace(/\s+/g, " ");

async function main() {
  const args = process.argv.slice(2);
  const simular = args.includes("--dry-run");
  const nomes = args.filter((a) => !a.startsWith("--")).map(limpar).filter(Boolean);
  const lista = nomes.length > 0 ? nomes : ["José", "Marcos"];

  const existentes = await prisma.porteiro.findMany();
  for (const nome of lista) {
    if (nome.length > 80) {
      console.log(`IGNORADO (nome longo demais): ${semAcento(nome).slice(0, 30)}...`);
      continue;
    }
    const achado = existentes.find((p) => chave(p.nome) === chave(nome));
    if (!achado) {
      if (!simular) await prisma.porteiro.create({ data: { nome } });
      console.log(`${simular ? "CRIARIA" : "CRIADO"}: ${semAcento(nome)}`);
    } else if (!achado.ativo) {
      if (!simular) await prisma.porteiro.update({ where: { id: achado.id }, data: { ativo: true } });
      console.log(`${simular ? "REATIVARIA" : "REATIVADO"}: ${semAcento(achado.nome)} (id ${achado.id})`);
    } else {
      console.log(`JA EXISTE: ${semAcento(achado.nome)} (id ${achado.id})`);
    }
  }
  const total = await prisma.porteiro.count({ where: { ativo: true } });
  console.log(`Porteiros ativos: ${total}${simular ? " (simulacao: nada gravado)" : ""}`);
}

main()
  .catch((e) => {
    console.error("ERRO:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
