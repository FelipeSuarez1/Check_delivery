"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; rotulo: string }[] = [
  { href: "/admin", rotulo: "Painel" },
  { href: "/admin/moradores", rotulo: "Moradores" },
  { href: "/admin/porteiros", rotulo: "Porteiros" },
  { href: "/admin/usuarios", rotulo: "Usuários" },
  { href: "/admin/exportar", rotulo: "Exportar" },
  { href: "/admin/logs", rotulo: "Logs" },
];

/** Links do admin; o ativo sai da URL no cliente (o layout não re-renderiza a cada navegação). */
export function NavAdmin() {
  const pathname = usePathname();
  return (
    <nav aria-label="Administração" className="flex gap-1 overflow-x-auto">
      {LINKS.map(({ href, rotulo }) => {
        // "Painel" só é ativo na raiz; os demais valem para as subrotas
        const ligado = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={ligado ? "page" : undefined}
            className={
              "inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3.5 font-semibold transition-colors " +
              (ligado ? "bg-ink text-white" : "text-ink-2 hover:bg-muted hover:text-ink")
            }
          >
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
