/**
 * Papéis do app de encomendas (22/10/2026) — fonte única, edge-safe (o
 * middleware importa daqui; nada de prisma/node).
 *
 * - admin     → tudo (síndico/Felipe): painel, cadastros, usuários, logs,
 *               exportação; também opera como portaria.
 * - portaria  → login único do balcão (tablet): registra, confirma retirada,
 *               histórico de todos os aptos, WhatsApp, etiqueta.
 * - morador   → login do APARTAMENTO (ap11a…): só vê as encomendas do próprio
 *               apto (código, foto, histórico) e troca a própria senha.
 */
export type PapelUsuario = "admin" | "portaria" | "morador";

export const PAPEIS: readonly PapelUsuario[] = ["admin", "portaria", "morador"];

export const ROTULO_PAPEL: Record<PapelUsuario, string> = {
  admin: "Administrador",
  portaria: "Portaria",
  morador: "Morador",
};

export function normalizarPapel(valor: unknown): PapelUsuario | null {
  return typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor)
    ? (valor as PapelUsuario)
    : null;
}

/** Quem registra/entrega encomendas. */
export function papelOperaPortaria(papel: PapelUsuario | null | undefined): boolean {
  return papel === "admin" || papel === "portaria";
}

/** Tela inicial de cada papel (pós-login e ao abrir "/"). */
export const ROTA_INICIAL: Record<PapelUsuario, string> = {
  admin: "/admin",
  portaria: "/portaria",
  morador: "/app",
};

/** Rotas que NÃO exigem login (o middleware deixa passar). */
export function rotaPublica(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons/")
  );
}

/**
 * Allowlist por papel. Tudo fora dela responde 404 no servidor (middleware);
 * o layout e as pages reforçam. `pathname` sem querystring.
 */
export function rotaPermitida(papel: PapelUsuario, pathname: string): boolean {
  if (pathname === "/" || pathname === "/conta/senha") return true;
  if (/^\/fotos\/\d+$/.test(pathname)) return true;
  const portaria =
    pathname === "/portaria" ||
    pathname.startsWith("/portaria/") ||
    /^\/etiqueta\/[A-Z0-9]{4}$/.test(pathname);
  const morador = pathname === "/app" || pathname.startsWith("/app/");
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  if (papel === "admin") return portaria || morador || admin;
  if (papel === "portaria") return portaria;
  return morador;
}
