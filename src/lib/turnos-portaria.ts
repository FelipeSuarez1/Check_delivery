/**
 * Turnos recentes para /portaria/turno (23/10/2026): porteiro, início, fim e
 * quantas encomendas ele recebeu e entregou DENTRO do turno. Turnos não se
 * sobrepõem (abrir um fecha o outro), então o intervalo de tempo + o porteiro
 * identificam o turno de cada registro. Sem sessão: a guarda é da page.
 */
import { prisma } from "@/lib/db";

export type LinhaTurno = {
  id: number;
  porteiroId: number;
  porteiroNome: string;
  /** ISO UTC */
  inicio: string;
  /** ISO UTC; null = turno em andamento */
  fim: string | null;
  recebidas: number;
  entregues: number;
};

export async function listarTurnosRecentes(limite = 20): Promise<LinhaTurno[]> {
  const turnos = await prisma.turno.findMany({
    orderBy: [{ inicio: "desc" }, { id: "desc" }],
    take: limite,
    include: { porteiro: { select: { nome: true } } },
  });
  if (turnos.length === 0) return [];

  const desde = turnos[turnos.length - 1].inicio;
  const [recebidas, entregues] = await Promise.all([
    prisma.encomenda.findMany({
      where: { recebidaEm: { gte: desde } },
      select: { recebidaEm: true, recebidaPorPorteiroId: true },
    }),
    prisma.encomenda.findMany({
      where: { entregueEm: { gte: desde } },
      select: { entregueEm: true, entreguePorPorteiroId: true },
    }),
  ]);

  const agora = new Date();
  return turnos.map((t) => {
    const fim = t.fim ?? agora;
    const dentro = (d: Date) => d >= t.inicio && d <= fim;
    return {
      id: t.id,
      porteiroId: t.porteiroId,
      porteiroNome: t.porteiro.nome,
      inicio: t.inicio.toISOString(),
      fim: t.fim ? t.fim.toISOString() : null,
      recebidas: recebidas.filter((e) => e.recebidaPorPorteiroId === t.porteiroId && dentro(e.recebidaEm)).length,
      entregues: entregues.filter(
        (e) => e.entreguePorPorteiroId === t.porteiroId && e.entregueEm !== null && dentro(e.entregueEm)
      ).length,
    };
  });
}
