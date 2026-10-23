/**
 * Funções PURAS da área administrativa (23/10/2026) — sem Prisma e sem node:*,
 * então servem a server e client components e são testáveis sem banco.
 * Telefone (normalizar/formatar/mascarar), nomes, duração e CSV pt-BR.
 */

/* ------------------------------------------------------------------- texto */

/** Marcas de acento (U+0300 a U+036F) que sobram depois do NFD. */
const COMBINANTES = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

export const semAcento = (s: string): string =>
  s.normalize("NFD").replace(COMBINANTES, "").toLowerCase();

/** Espaços repetidos viram um só; pontas aparadas. */
export const limparNome = (s: string): string => s.trim().replace(/\s+/g, " ");

/** Chave de comparação de nomes: sem acento, sem caixa, sem espaço sobrando. */
export const chaveNome = (s: string): string => semAcento(limparNome(s));

/** Caractere de controle em nome/telefone digitado (cola de planilha, etc.). */
export const temControle = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s);

/* ---------------------------------------------------------------- telefone */

export type ResultadoTelefone = { ok: true; telefone: string | null } | { ok: false; erro: string };

const ERRO_TELEFONE = "Telefone inválido — informe DDD + número (10 ou 11 dígitos)";

/**
 * Telefone digitado → só dígitos, sem o DDI 55 (o link do WhatsApp o reaplica).
 * Vazio vira null. Aceita 10 ou 11 dígitos (DDD + número); o cadastro real
 * tem celulares com 10 dígitos e um com 11 que não começa em 9, então a regra
 * é só o tamanho — a mesma de scripts/importa-cadastro.ts.
 */
export function normalizarTelefone(bruto: string | null | undefined): ResultadoTelefone {
  if (bruto == null) return { ok: true, telefone: null };
  let d = bruto.replace(/\D/g, "");
  if (d === "") {
    // texto sem nenhum dígito ("abc") não é "vazio": é erro de digitação
    return bruto.trim() === "" ? { ok: true, telefone: null } : { ok: false, erro: ERRO_TELEFONE };
  }
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if ((d.length === 10 || d.length === 11) && !d.startsWith("0")) return { ok: true, telefone: d };
  return { ok: false, erro: ERRO_TELEFONE };
}

/** "11943006682" → "(11) 94300-6682" (tela de edição). */
export function formatarTelefone(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel ?? "";
}

/**
 * "11943006682" → "(11) 9****-6682": na lista aparecem só o DDD, o 1º dígito e
 * os 4 últimos (reconhecível por quem conhece o número, inútil para quem só
 * olha a tela por cima do ombro). Sem telefone → "".
 */
export function mascararTelefone(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d[2]}****-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ****-${d.slice(6)}`;
  if (d.length >= 4) return `****${d.slice(-4)}`;
  return "";
}

/* ---------------------------------------------------------------- duração */

/** 1 d 4 h · 5 h 12 min · 42 min · "—" quando não há dado. */
export function formatarDuracao(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.round(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/* --------------------------------------------------------------------- CSV */

/**
 * Célula de CSV pt-BR (separador ";"). Aspas quando há ; " CR ou LF.
 * Defesa contra injeção de fórmula: texto que começa com = + - @ TAB ou CR vira
 * texto literal no Excel/LibreOffice (prefixo apóstrofo) — o nome do
 * destinatário vem do teclado do porteiro e o admin abre o arquivo no Excel.
 */
export function celulaCsv(valor: string | number | null | undefined): string {
  if (valor == null) return "";
  let s = String(valor);
  if (typeof valor === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const BOM_UTF8 = String.fromCharCode(0xfeff);

/** Arquivo inteiro: BOM UTF-8 (o Excel pt-BR abre com acento certo) + CRLF. */
export function montarCsv(cabecalho: readonly string[], linhas: readonly (readonly (string | number | null)[])[]): string {
  const todas = [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(";"));
  return BOM_UTF8 + todas.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------- user-agent */

/**
 * O evento de login grava "ua: <user-agent inteiro>". Para ler no painel basta
 * "Chrome 156 · Windows"; o texto completo continua no banco e no `title`.
 * Devolve null quando o detalhe não é um user-agent.
 */
export function resumirUserAgent(detalhe: string | null | undefined): string | null {
  if (!detalhe || !detalhe.startsWith("ua: ")) return null;
  const ua = detalhe.slice(4);
  const versao = (re: RegExp) => re.exec(ua)?.[1]?.split(".")[0] ?? "";
  let navegador = "Navegador";
  if (/Edg(?:e|A|iOS)?\//.test(ua)) navegador = `Edge ${versao(/Edg(?:e|A|iOS)?\/([\d.]+)/)}`;
  else if (/OPR\//.test(ua)) navegador = `Opera ${versao(/OPR\/([\d.]+)/)}`;
  else if (/(?:Chrome|CriOS)\//.test(ua)) navegador = `Chrome ${versao(/(?:Chrome|CriOS)\/([\d.]+)/)}`;
  else if (/(?:Firefox|FxiOS)\//.test(ua)) navegador = `Firefox ${versao(/(?:Firefox|FxiOS)\/([\d.]+)/)}`;
  else if (/Safari\//.test(ua)) navegador = `Safari ${versao(/Version\/([\d.]+)/)}`;
  let sistema = "";
  if (/Windows/.test(ua)) sistema = "Windows";
  else if (/Android/.test(ua)) sistema = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) sistema = "iOS";
  else if (/Mac OS X|Macintosh/.test(ua)) sistema = "macOS";
  else if (/Linux|X11/.test(ua)) sistema = "Linux";
  return [navegador.trim(), sistema].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------ filtros de usuários */

/** Situações do filtro de /admin/usuarios (valor na URL + rótulo da lista). */
export const SITUACOES_USUARIO = [
  { valor: "ativos", rotulo: "Só ativos" },
  { valor: "desativados", rotulo: "Só desativados" },
  { valor: "pendentes", rotulo: "Senha inicial pendente" },
] as const;
