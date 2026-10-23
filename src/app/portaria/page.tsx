import { exigirPapelNaPagina } from "@/lib/auth";

// Placeholder da base: a lista "Aguardando" é construída na próxima onda.
export default async function PortariaPage() {
  await exigirPapelNaPagina("portaria", "admin");
  return <h1 className="text-2xl">Aguardando</h1>;
}
