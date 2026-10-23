/**
 * Senha inicial legível (23/10/2026): 10 caracteres sorteados de um alfabeto
 * sem ambíguos (sem i l o 0 1), ~49 bits. Mesmo alfabeto e tamanho de
 * scripts/cria-usuarios.ts, de propósito: a senha que o admin gera na tela é
 * indistinguível da gerada pelo script.
 * Só servidor (node:crypto). A senha NUNCA vai para log.
 */
import { randomInt } from "node:crypto";

export const ALFABETO_SENHA = "abcdefghjkmnpqrstuvwxyz23456789";

export function gerarSenhaLegivel(tamanho = 10): string {
  let s = "";
  for (let i = 0; i < tamanho; i++) s += ALFABETO_SENHA[randomInt(ALFABETO_SENHA.length)];
  return s;
}
