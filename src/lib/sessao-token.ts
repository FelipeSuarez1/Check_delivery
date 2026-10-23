/**
 * Token de sessão assinado (HMAC-SHA256 via Web Crypto) — funciona tanto no
 * middleware (edge) quanto em server components/actions (node).
 * Formato: base64url(payload JSON) + "." + base64url(assinatura).
 */

import { normalizarPapel, rotaPermitida, ROTA_INICIAL, type PapelUsuario } from "@/lib/papeis";

/** Papéis: fonte única em lib/papeis.ts (edge-safe, importável aqui). */
export type { PapelUsuario };

/**
 * Nome do cookie de sessão (usado pelo middleware e por lib/auth.ts). Diferente
 * do site financeiro de propósito: em localhost os dois apps dividem o host e o
 * cookie "sessao" de um sobrescrevia o do outro.
 */
export const COOKIE_SESSAO = "enc_sessao";

/**
 * O segredo que assina a sessão precisa ser longo e não pode ser o valor de
 * exemplo do .env.example (público no repositório): quem o soubesse forjaria
 * um token de admin. Middleware e lib/auth.ts recusam segredo fraco (fail closed).
 */
export function segredoSessaoValido(segredo: string | undefined): segredo is string {
  return !!segredo && segredo.length >= 32 && !/troque-por/i.test(segredo);
}

export type SessaoPayload = {
  id: number;
  nome: string;
  papel: PapelUsuario;
  exp: number; // epoch ms
  /** marca da senha vigente no login (ver versaoSenha) — conferida no banco */
  sv?: string;
  /** só morador: apartamento da sessão (relido do banco a cada request) */
  apartamentoId?: number | null;
};

/**
 * Valida o `?next=` do fluxo de login: só caminho interno, nunca de volta a
 * /login. Testar prefixo não basta — o parser de URL trata `\`, TAB, LF e CR
 * como separadores de autoridade (`/\evil.com` vira `http://evil.com`), então o
 * caminho é resolvido contra uma base sintética e o host tem que continuar sendo
 * o dela. Sem isso o site vira trampolim de phishing logo após o login.
 */
export function destinoPosLogin(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  // barra invertida e caracteres de controle (TAB/LF/CR...) sao removidos ou
  // reinterpretados pelo parser de URL — barra antes de chegarem nele
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  let url: URL;
  try {
    url = new URL(next, "http://destino.invalido");
  } catch {
    return "/";
  }
  if (url.host !== "destino.invalido") return "/";
  const caminho = url.pathname + url.search;
  return caminho.startsWith("/login") ? "/" : caminho;
}

/**
 * Destino pós-login ajustado ao papel (11/09/2026): o perfil de leitura só
 * enxerga o Gerencial, então um `next` para qualquer outra tela (bookmark
 * antigo, link colado) cairia num 404 logo depois de entrar — em vez disso
 * ele vai para a tela inicial de leitura.
 */
export function destinoPosLoginParaPapel(
  next: string | null | undefined,
  papel: PapelUsuario
): string {
  const destino = destinoPosLogin(next);
  if (destino === "/") return ROTA_INICIAL[papel];
  const caminho = destino.split(/[?#]/)[0];
  return rotaPermitida(papel, caminho) ? destino : ROTA_INICIAL[papel];
}

const enc = new TextEncoder();

function paraB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function chaveHmac(segredo: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function assinarSessao(payload: SessaoPayload, segredo: string): Promise<string> {
  const corpo = paraB64Url(enc.encode(JSON.stringify(payload)));
  const chave = await chaveHmac(segredo);
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(corpo));
  return `${corpo}.${paraB64Url(new Uint8Array(assinatura))}`;
}

export async function verificarSessao(
  token: string | undefined,
  segredo: string
): Promise<SessaoPayload | null> {
  if (!token) return null;
  const [corpo, assinatura] = token.split(".");
  if (!corpo || !assinatura) return null;
  try {
    const chave = await chaveHmac(segredo);
    const valida = await crypto.subtle.verify(
      "HMAC",
      chave,
      deB64Url(assinatura) as BufferSource,
      enc.encode(corpo)
    );
    if (!valida) return null;
    const payload = JSON.parse(new TextDecoder().decode(deB64Url(corpo))) as SessaoPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    // token emitido antes de 11/09/2026 traz 'convidado' — normalizarPapel o
    // aceita como 'gerente'; papel desconhecido derruba a sessão (fail closed)
    const papel = normalizarPapel(payload.papel);
    if (!papel) return null;
    return { ...payload, papel };
  } catch {
    return null;
  }
}
