/** Leitura segura de searchParams das pages da portaria (valor repetido vira o 1º; vazio vira undefined). */
export type SearchParams = Record<string, string | string[] | undefined>;

export function param(sp: SearchParams, nome: string, max = 80): string | undefined {
  const v = sp[nome];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s.slice(0, max) : undefined;
}

/** QueryString a partir de pares; ignora undefined/""/false. */
export function qs(pares: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(pares)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    u.set(k, v === true ? "1" : String(v));
  }
  const t = u.toString();
  return t ? `?${t}` : "";
}
