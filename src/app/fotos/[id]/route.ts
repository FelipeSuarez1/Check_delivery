/**
 * GET /fotos/[id] - serve a foto da encomenda (22/10/2026).
 * A foto fica em uploads/encomendas (fora de /public); esta é a ÚNICA porta.
 * Reconfere sessão a cada requisição: morador só vê foto do PRÓPRIO apartamento
 * (apartamentoId da sessão, relido do banco); portaria/admin veem qualquer uma.
 * Nunca 403: tudo que não pode (sem sessão, outro apto, foto apagada pela
 * retenção, id inválido, arquivo ausente) responde 404 igual, sem pista.
 */
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { lerSessaoVerificada } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { caminhoFoto, tipoMimeFoto } from "@/lib/fotos";
import { papelOperaPortaria } from "@/lib/papeis";

function naoEncontrado(): Response {
  return new Response("Não encontrado", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: idTexto } = await ctx.params;
  const id = /^\d{1,9}$/.test(idTexto) ? Number(idTexto) : NaN;
  if (!Number.isInteger(id) || id <= 0) return naoEncontrado();

  const sessao = await lerSessaoVerificada();
  if (!sessao) return naoEncontrado();

  const foto = await prisma.fotoEncomenda.findUnique({
    where: { id },
    select: { arquivo: true, apagadaEm: true, encomenda: { select: { apartamentoId: true } } },
  });
  if (!foto || foto.apagadaEm) return naoEncontrado();

  const permitido =
    papelOperaPortaria(sessao.papel) ||
    (sessao.papel === "morador" &&
      sessao.apartamentoId != null &&
      sessao.apartamentoId === foto.encomenda.apartamentoId);
  if (!permitido) return naoEncontrado();

  const tipo = tipoMimeFoto(foto.arquivo);
  if (!tipo) return naoEncontrado();

  let bytes: Buffer;
  try {
    bytes = await readFile(caminhoFoto(foto)); // basename + formato gerado: sem traversal
  } catch {
    return naoEncontrado();
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store", // tablet da portaria é compartilhado: foto não fica no cache após logout
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
