import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { exigirPapelNaPagina } from "@/lib/auth";
import { ShellMorador } from "@/components/shell-morador";

/**
 * Área do morador: morador (e admin, para conferir). O apartamento vem SEMPRE
 * da sessão, nunca da URL. Morador sem apartamento (dado corrompido) → 404.
 * ATENÇÃO: layouts não re-renderizam a cada navegação entre páginas irmãs —
 * cada page e cada action do morador repete a guarda.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await exigirPapelNaPagina("morador", "admin");

  let apartamentoNumero: string | null = null;
  let aguardando = 0;
  if (sessao.papel === "morador") {
    if (!sessao.apartamentoId) notFound();
    const apto = await prisma.apartamento.findUnique({
      where: { id: sessao.apartamentoId },
      select: { numero: true },
    });
    if (!apto) notFound();
    apartamentoNumero = apto.numero;
    aguardando = await prisma.encomenda.count({
      where: { apartamentoId: sessao.apartamentoId, status: "aguardando" },
    });
  }

  return (
    <ShellMorador apartamentoNumero={apartamentoNumero} aguardando={aguardando}>
      {children}
    </ShellMorador>
  );
}
