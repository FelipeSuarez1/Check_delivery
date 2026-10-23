import { exigirPapelNaPagina } from "@/lib/auth";
import { ShellAdmin } from "@/components/shell-admin";

/**
 * Área do administrador: SÓ admin (qualquer outro papel → 404).
 * ATENÇÃO: layouts não re-renderizam a cada navegação entre páginas irmãs —
 * cada page e cada action de /admin repete a guarda (exigirAdmin).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sessao = await exigirPapelNaPagina("admin");
  return <ShellAdmin nome={sessao.nome}>{children}</ShellAdmin>;
}
