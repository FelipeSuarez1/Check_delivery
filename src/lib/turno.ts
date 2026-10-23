/**
 * Turno da portaria (22/10/2026): um turno aberto por vez; o porteiro do turno
 * aberto é gravado em cada registro/entrega (login individual = fase 4).
 * Regra pura sobre o Prisma — as guardas de papel ficam em `actions/turno.ts`.
 */
import { prisma } from "@/lib/db";
import { ErroDominio } from "@/lib/erro-dominio";

export type TurnoAberto = {
  id: number;
  porteiroId: number;
  porteiroNome: string;
  /** ISO UTC */
  inicioISO: string;
};

type LinhaTurno = { id: number; porteiroId: number; inicio: Date; porteiro: { nome: string } };

function paraTurno(t: LinhaTurno): TurnoAberto {
  return { id: t.id, porteiroId: t.porteiroId, porteiroNome: t.porteiro.nome, inicioISO: t.inicio.toISOString() };
}

/** Turno aberto mais recente (se houver mais de um por falha antiga, vale o último). */
export async function buscarTurnoAberto(): Promise<TurnoAberto | null> {
  const t = await prisma.turno.findFirst({
    where: { fim: null },
    orderBy: [{ inicio: "desc" }, { id: "desc" }],
    include: { porteiro: { select: { nome: true } } },
  });
  return t ? paraTurno(t) : null;
}

/**
 * Abre o turno de `porteiroId`, encerrando qualquer outro aberto.
 * Se o turno aberto JÁ é desse porteiro, nada muda (`reaproveitado`): reabrir
 * não pode zerar o início, que define o que a portaria ainda pode cancelar.
 */
export async function abrirTurno(
  porteiroId: number
): Promise<{ turno: TurnoAberto; anterior: TurnoAberto | null; reaproveitado: boolean }> {
  const porteiro = await prisma.porteiro.findUnique({ where: { id: porteiroId } });
  if (!porteiro || !porteiro.ativo) throw new ErroDominio("Porteiro não encontrado ou inativo");

  return prisma.$transaction(async (tx) => {
    const abertos = await tx.turno.findMany({
      where: { fim: null },
      orderBy: [{ inicio: "desc" }, { id: "desc" }],
      include: { porteiro: { select: { nome: true } } },
    });
    if (abertos.length === 1 && abertos[0].porteiroId === porteiroId) {
      return { turno: paraTurno(abertos[0]), anterior: null, reaproveitado: true };
    }
    const agora = new Date();
    if (abertos.length > 0) {
      await tx.turno.updateMany({ where: { fim: null }, data: { fim: agora } });
    }
    const novo = await tx.turno.create({
      data: { porteiroId, inicio: agora },
      include: { porteiro: { select: { nome: true } } },
    });
    return {
      turno: paraTurno(novo),
      anterior: abertos.length > 0 ? paraTurno(abertos[0]) : null,
      reaproveitado: false,
    };
  });
}

/** Encerra o(s) turno(s) aberto(s). Devolve o que estava aberto, ou null se não havia. */
export async function fecharTurno(): Promise<TurnoAberto | null> {
  return prisma.$transaction(async (tx) => {
    const aberto = await tx.turno.findFirst({
      where: { fim: null },
      orderBy: [{ inicio: "desc" }, { id: "desc" }],
      include: { porteiro: { select: { nome: true } } },
    });
    if (!aberto) return null;
    await tx.turno.updateMany({ where: { fim: null }, data: { fim: new Date() } });
    return paraTurno(aberto);
  });
}
