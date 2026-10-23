import { prisma } from "@/lib/db";
import { exigirPapelNaPagina } from "@/lib/auth";
import { ShellPortaria } from "@/components/shell-portaria";

/**
 * 00:00 de hoje em Brasília, como instante UTC. O Brasil não tem horário de
 * verão desde 2019 (UTC-3 fixo); se voltar, trocar por uma lib de fuso.
 */
function inicioDoDiaEmBrasilia(agora = new Date()): Date {
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora); // AAAA-MM-DD
  return new Date(`${dia}T00:00:00-03:00`);
}

/**
 * Área da portaria: portaria e admin (admin também opera o balcão). Qualquer
 * outro papel → 404. ATENÇÃO: layouts não re-renderizam a cada navegação entre
 * páginas irmãs — cada page e cada action da portaria repete a guarda.
 */
export default async function PortariaLayout({ children }: { children: React.ReactNode }) {
  const sessao = await exigirPapelNaPagina("portaria", "admin");

  const [aberto, porteiros, aguardando, entreguesHoje] = await Promise.all([
    prisma.turno.findFirst({
      where: { fim: null },
      orderBy: { inicio: "desc" },
      select: { inicio: true, porteiro: { select: { id: true, nome: true } } },
    }),
    prisma.porteiro.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    prisma.encomenda.count({ where: { status: "aguardando" } }),
    prisma.encomenda.count({
      where: { status: "entregue", entregueEm: { gte: inicioDoDiaEmBrasilia() } },
    }),
  ]);

  return (
    <ShellPortaria
      turno={
        aberto
          ? {
              porteiroId: aberto.porteiro.id,
              porteiroNome: aberto.porteiro.nome,
              inicioISO: aberto.inicio.toISOString(),
            }
          : null
      }
      porteiros={porteiros}
      contadores={{ aguardando, entreguesHoje }}
      ehAdmin={sessao.papel === "admin"}
    >
      {children}
    </ShellPortaria>
  );
}
