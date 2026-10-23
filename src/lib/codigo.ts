/**
 * Código da encomenda (22/10/2026) — 4 caracteres de um alfabeto sem ambíguos.
 *
 * Isomórfico de propósito (sem node:crypto): componentes client podem importar
 * `normalizarCodigo`/`codigoValido` para validar o que o porteiro digita.
 * O código NÃO é segredo (vai na etiqueta e no WhatsApp); a segurança é quem retira.
 */

/** 32 símbolos — sem 0, O, 1, I. Tamanho potência de 2 = sorteio sem viés (byte & 31). */
export const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TAMANHO_CODIGO = 4;

if (ALFABETO.length !== 32) throw new Error("ALFABETO precisa ter 32 símbolos (sorteio por máscara)");

const REGEX_CODIGO = new RegExp(`^[${ALFABETO}]{${TAMANHO_CODIGO}}$`);

/** Combinações que formam palavrão (pt/en) com este alfabeto — nunca saem numa etiqueta. */
const CODIGOS_PROIBIDOS: ReadonlySet<string> = new Set([
  "PUTA", "PUTO", "FODA", "FODE", "FUDE", "ROLA", "CUZA",
  "FUCK", "COCK", "CUNT", "TWAT", "ANUS", "ANAL", "RAPE", "SEXO", "SEXY", "CUCK",
]);

/** Sorteia um candidato (não consulta o banco — a unicidade é de `gerarCodigo`). */
export function gerarCodigoCandidato(): string {
  for (;;) {
    const bytes = new Uint8Array(TAMANHO_CODIGO);
    globalThis.crypto.getRandomValues(bytes);
    let c = "";
    for (const b of bytes) c += ALFABETO[b & 31];
    if (!CODIGOS_PROIBIDOS.has(c)) return c;
  }
}

/** true só para string EXATAMENTE no formato (já normalizada, maiúscula). */
export function codigoValido(s: unknown): s is string {
  return typeof s === "string" && REGEX_CODIGO.test(s);
}

export type ResultadoCodigo = { ok: true; codigo: string } | { ok: false; erro: string };

const AMBIGUOS = new Set(["0", "O", "1", "I"]);

/**
 * Limpa o que o porteiro digitou/colou: maiúsculas; remove espaços, hífens e
 * caracteres invisíveis. NÃO converte O→0 nem I→1: esses caracteres não existem
 * nos códigos, então digitá-los é erro de leitura da etiqueta — rejeita com
 * mensagem clara (converter silenciosamente poderia casar com a encomenda errada).
 */
export function validarCodigo(entrada: unknown): ResultadoCodigo {
  if (typeof entrada !== "string") return { ok: false, erro: "Informe o código da encomenda" };
  const limpo = entrada
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s​-‍﻿­\-‐-―−]/g, "");
  if (limpo === "") return { ok: false, erro: "Informe o código da encomenda" };

  const exibido = limpo.length > 12 ? `${limpo.slice(0, 12)}…` : limpo;
  const invalidos = Array.from(new Set(Array.from(limpo).filter((ch) => !ALFABETO.includes(ch))));
  if (invalidos.length > 0) {
    if (invalidos.every((ch) => AMBIGUOS.has(ch))) {
      return {
        ok: false,
        erro: `O código "${exibido}" tem ${invalidos.join(", ")} — os códigos nunca usam 0, O, 1 nem I. Confira a etiqueta.`,
      };
    }
    return { ok: false, erro: `O código "${exibido}" tem caractere inválido (${invalidos.join(" ")}). Use só letras e números.` };
  }
  if (limpo.length !== TAMANHO_CODIGO) {
    return {
      ok: false,
      erro: `O código tem ${TAMANHO_CODIGO} caracteres — "${exibido}" tem ${limpo.length}.`,
    };
  }
  return { ok: true, codigo: limpo };
}

export class CodigoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CodigoInvalidoError";
  }
}

/** Versão que lança `CodigoInvalidoError` (mensagem pt-BR pronta para a tela). */
export function normalizarCodigo(entrada: string): string {
  const r = validarCodigo(entrada);
  if (!r.ok) throw new CodigoInvalidoError(r.erro);
  return r.codigo;
}
