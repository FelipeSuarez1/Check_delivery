import type { Metadata } from "next";
import { exigirPapelNaPagina } from "@/lib/auth";
import {
  aptosSemLogin,
  listarOpcoesApartamento,
  listarUsuariosAdmin,
} from "@/lib/admin";
import { SITUACOES_USUARIO } from "@/lib/admin-formato";
import { normalizarPapel } from "@/lib/papeis";
import { UsuariosClient } from "./usuarios-client";

export const metadata: Metadata = { title: "Usuários" };

type Params = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function UsuariosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sessao = await exigirPapelNaPagina("admin");
  const sp = await searchParams;
  const q = um(sp.q).trim().slice(0, 80);
  const papel = normalizarPapel(um(sp.papel)) ?? undefined;
  const sit = um(sp.situacao);
  const situacao = SITUACOES_USUARIO.find((s) => s.valor === sit)?.valor;

  const [{ usuarios, resumo }, semLogin, opcoes] = await Promise.all([
    listarUsuariosAdmin({ q, papel, situacao }),
    aptosSemLogin(),
    listarOpcoesApartamento(),
  ]);

  return (
    <UsuariosClient
      usuarios={usuarios}
      resumo={resumo}
      faltantes={semLogin.map((a) => a.numero)}
      opcoes={opcoes}
      meuId={sessao.id}
      filtroAtual={{ q, papel, situacao }}
    />
  );
}
