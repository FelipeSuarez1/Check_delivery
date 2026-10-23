/**
 * GET /admin/exportar/csv?de=AAAA-MM-DD&ate=AAAA-MM-DD&torre=A|B&status=aguardando|entregue|cancelada
 * (23/10/2026). Só administrador: qualquer outro papel (e sessão vencida) recebe
 * 404 — o middleware já barra o resto de /admin, e esta guarda repete a conferência
 * contra o banco. Período por data de RECEBIMENTO, pontas inclusivas (America/Sao_Paulo).
 * Filtro malformado = 400 (nunca vira "sem filtro" em silêncio). Toda exportação
 * entra no livro (tipo "exportacao"): é dado pessoal saindo do sistema.
 */
import type { NextRequest } from "next/server";
import { exigirAdmin } from "@/lib/auth";
import {
  descreverFiltro,
  lerFiltroExportacao,
  listarParaExportacao,
  montarCsvDeExportacao,
  nomeArquivoCsv,
  registrarExportacao,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

const CABECALHOS_TEXTO = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(req: NextRequest): Promise<Response> {
  const sessao = await exigirAdmin();
  if (!sessao) return new Response("Não encontrado", { status: 404, headers: CABECALHOS_TEXTO });

  const lido = lerFiltroExportacao(req.nextUrl.searchParams);
  if (!lido.ok) return new Response(lido.erro, { status: 400, headers: CABECALHOS_TEXTO });
  const { filtro } = lido;

  const linhas = await listarParaExportacao(filtro);
  const csv = montarCsvDeExportacao(linhas);
  await registrarExportacao(sessao, `Exportou ${linhas.length} encomenda(s) em CSV — ${descreverFiltro(filtro)}`);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeArquivoCsv(filtro)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
