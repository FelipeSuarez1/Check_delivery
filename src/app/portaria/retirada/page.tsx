/**
 * /portaria/retirada - confirmar a retirada (23/10/2026). O porteiro digita o
 * código (ou lê o QR do celular do morador), confere a encomenda, escolhe QUEM
 * está retirando e confirma. `?codigo=K7M3` já abre a encomenda (vem do detalhe).
 * Sem o código: busca pelo apartamento lista as pendentes dele.
 */
import type { Metadata } from "next";
import { RetiradaClient } from "./retirada-client";
import { param, type SearchParams } from "../params";
import { exigirPapelNaPagina } from "@/lib/auth";
import { buscarParaRetirada, listarAguardando } from "@/lib/encomendas";
import { buscarTurnoAberto } from "@/lib/turno";

export const metadata: Metadata = { title: "Confirmar retirada" };

export default async function RetiradaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await exigirPapelNaPagina("portaria", "admin");
  const sp = await searchParams;
  const codigoUrl = param(sp, "codigo", 20);

  const [turno, pendentes, resultado] = await Promise.all([
    buscarTurnoAberto(),
    listarAguardando(),
    codigoUrl ? buscarParaRetirada(codigoUrl) : null,
  ]);

  return (
    // a chave remonta o cliente quando o ?codigo= muda (ex.: voltar do detalhe com outro código)
    <RetiradaClient
      key={codigoUrl ?? ""}
      turno={turno ? { porteiroNome: turno.porteiroNome, inicioISO: turno.inicioISO } : null}
      pendentes={pendentes}
      inicial={codigoUrl && resultado ? { codigo: codigoUrl, resultado } : null}
    />
  );
}
