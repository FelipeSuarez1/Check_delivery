import { exigirPapelNaPagina } from "@/lib/auth";

// Placeholder da base: "Na portaria" do morador é construído na próxima onda.
export default async function AppMoradorPage() {
  await exigirPapelNaPagina("morador", "admin");
  return <h1 className="text-xl">Na portaria</h1>;
}
