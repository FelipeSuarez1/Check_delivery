import { exigirPapelNaPagina } from "@/lib/auth";

// Placeholder da base: o painel do administrador é construído na próxima onda.
export default async function AdminPage() {
  await exigirPapelNaPagina("admin");
  return <h1 className="text-2xl">Painel</h1>;
}
