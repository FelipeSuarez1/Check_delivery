"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type AbaPortaria = "aguardando" | "hoje" | "historico";

/**
 * Abas do cabeçalho da portaria. A aba ativa sai da URL no CLIENTE: o layout
 * (onde o cabeçalho vive) não re-renderiza a cada navegação, então uma aba
 * calculada no servidor ficaria presa na primeira tela aberta. `abaAtiva`
 * (opcional) força o valor, para testes.
 */
export function NavPortaria({
  contadores,
  abaAtiva,
}: {
  contadores: { aguardando: number; entreguesHoje: number };
  abaAtiva?: AbaPortaria;
}) {
  const pathname = usePathname();
  const aba = useSearchParams().get("aba");

  const derivada: AbaPortaria | null =
    pathname === "/portaria"
      ? aba === "hoje"
        ? "hoje"
        : "aguardando"
      : pathname.startsWith("/portaria/historico")
        ? "historico"
        : null;
  const ativa = abaAtiva ?? derivada;

  const abas: { chave: AbaPortaria; rotulo: string; href: string; contador?: number }[] = [
    { chave: "aguardando", rotulo: "Aguardando", href: "/portaria", contador: contadores.aguardando },
    { chave: "hoje", rotulo: "Entregues hoje", href: "/portaria?aba=hoje", contador: contadores.entreguesHoje },
    { chave: "historico", rotulo: "Histórico", href: "/portaria/historico" },
  ];

  return (
    <nav aria-label="Seções da portaria" className="flex gap-1">
      {abas.map((a) => {
        const ligada = ativa === a.chave;
        return (
          <Link
            key={a.chave}
            href={a.href}
            aria-current={ligada ? "page" : undefined}
            className={
              "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3 font-semibold transition-colors md:px-4 " +
              (ligada ? "bg-ink text-white" : "text-ink-2 hover:bg-muted hover:text-ink")
            }
          >
            {a.rotulo}
            {a.contador !== undefined && (
              <span
                className={
                  "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-[7px] text-xs tabular-nums " +
                  (ligada ? "bg-white/20" : "bg-kraft-soft text-kraft-ink")
                }
              >
                {a.contador}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
