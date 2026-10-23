/**
 * Livro auditável: toda escrita grava um LogEvento (quem, quando, o quê).
 * Nunca lança — um log que falha não pode derrubar a operação da portaria.
 */
import { prisma } from "@/lib/db";
import type { SessaoPayload } from "@/lib/sessao-token";

export type TipoEvento =
  | "login"
  | "logout"
  | "encomenda"
  | "retirada"
  | "cancelamento"
  | "turno"
  | "usuario"
  | "cadastro"
  | "erro"
  | "feedback";

export async function registrarEvento(
  sessao: Pick<SessaoPayload, "id" | "nome" | "papel"> | null,
  tipo: TipoEvento,
  rota: string,
  detalhe?: string
): Promise<void> {
  try {
    await prisma.logEvento.create({
      data: {
        usuarioId: sessao?.id ?? null,
        usuarioNome: sessao?.nome ?? "sistema",
        papel: sessao?.papel ?? null,
        tipo,
        rota,
        detalhe: detalhe ? detalhe.slice(0, 2000) : null,
      },
    });
  } catch (e) {
    console.error("registrarEvento falhou:", e);
  }
}
