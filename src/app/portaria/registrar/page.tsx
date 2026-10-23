/**
 * /portaria/registrar - registrar encomenda (23/10/2026). Foto obrigatória à
 * esquerda; apartamento, destinatário, tipo e transportadora à direita. Ao salvar,
 * a MESMA tela passa a mostrar o código gerado (WhatsApp, etiqueta, registrar outra).
 * Todos os aptos e seus moradores (sem telefone) vão como prop: trocar de
 * apartamento não depende de rede.
 */
import type { Metadata } from "next";
import { RegistrarClient } from "./registrar-client";
import { exigirPapelNaPagina } from "@/lib/auth";
import { listarApartamentosComMoradores } from "@/lib/encomendas";
import { buscarTurnoAberto } from "@/lib/turno";

export const metadata: Metadata = { title: "Registrar encomenda" };

export default async function RegistrarPage() {
  await exigirPapelNaPagina("portaria", "admin");
  const [turno, apartamentos] = await Promise.all([buscarTurnoAberto(), listarApartamentosComMoradores()]);
  return (
    <RegistrarClient
      turno={turno ? { porteiroNome: turno.porteiroNome, inicioISO: turno.inicioISO } : null}
      apartamentos={apartamentos}
    />
  );
}
