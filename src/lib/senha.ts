/**
 * Hash de senha com scrypt (node:crypto) — sem dependência externa.
 * Importável tanto pelo app quanto por scripts (ex.: scripts/cria-usuarios.ts).
 */
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Marca curta derivada do hash da senha, gravada na sessão. Trocar a senha muda
 * a marca e derruba as sessões abertas daquele usuário — é o que faz "redefinir
 * senha" conter de fato um vazamento (o cookie roubado para de valer). É um
 * digest do hash, nunca o hash em si.
 */
export function versaoSenha(senhaHash: string): string {
  return createHash("sha256").update(senhaHash).digest("hex").slice(0, 12);
}

export function gerarHashSenha(senha: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(senha, salt, 64).toString("hex");
  return { hash, salt };
}

export function conferirSenha(senha: string, salt: string, hashEsperado: string): boolean {
  const hash = scryptSync(senha, salt, 64);
  const esperado = Buffer.from(hashEsperado, "hex");
  return hash.length === esperado.length && timingSafeEqual(hash, esperado);
}

/**
 * Versão assíncrona — obrigatória no fluxo de login do site: o scrypt custa
 * dezenas de ms e a variante síncrona bloqueia o event loop do processo único,
 * fazendo tentativas de login repetidas derrubarem o site para todo mundo.
 */
export function conferirSenhaAsync(
  senha: string,
  salt: string,
  hashEsperado: string
): Promise<boolean> {
  return new Promise((resolve) => {
    scrypt(senha, salt, 64, (erro, hash) => {
      if (erro) return resolve(false);
      const esperado = Buffer.from(hashEsperado, "hex");
      resolve(hash.length === esperado.length && timingSafeEqual(hash, esperado));
    });
  });
}
