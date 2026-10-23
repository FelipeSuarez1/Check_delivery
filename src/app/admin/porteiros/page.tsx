import type { Metadata } from "next";
import { exigirPapelNaPagina } from "@/lib/auth";
import { listarPorteirosAdmin } from "@/lib/admin";
import { PorteirosClient } from "./porteiros-client";

export const metadata: Metadata = { title: "Porteiros" };

export default async function PorteirosPage() {
  await exigirPapelNaPagina("admin");
  const porteiros = await listarPorteirosAdmin();
  return <PorteirosClient porteiros={porteiros} />;
}
