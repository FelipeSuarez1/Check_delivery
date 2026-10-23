/**
 * Filtros do histórico (23/10/2026): leitura da URL → objeto, objeto → Periodo,
 * e montagem de links que preservam os outros filtros. Compartilhado por
 * /portaria/historico e /portaria/historico/[apto].
 *
 *   ?periodo=7|30|90|ano|tudo   (padrão varia por página)
 *   ?de=AAAA-MM-DD&ate=AAAA-MM-DD   (datas INCLUSIVAS; qualquer uma delas = período personalizado)
 *   ?torre=A|B  ?status=aguardando|entregue|cancelada  ?paradas=1  ?q=texto
 */
import { param, qs, type SearchParams } from "../params";
import { diaLocalISO, inicioDoDiaDeTexto, periodoDeDias, somarDiasLocal, partesLocais, type Periodo } from "@/lib/datas";
import { ehStatus, type StatusEncomenda } from "@/lib/encomenda-constantes";

export type PeriodoChave = "7" | "30" | "90" | "ano" | "tudo" | "custom";

export type FiltrosHistorico = {
  periodo: PeriodoChave;
  /** só no período personalizado */
  de?: string;
  ate?: string;
  torre?: "A" | "B";
  status?: StatusEncomenda;
  paradas: boolean;
  q?: string;
};

const PERIODOS: readonly PeriodoChave[] = ["7", "30", "90", "ano", "tudo"];

export function lerFiltros(sp: SearchParams, padrao: PeriodoChave): FiltrosHistorico {
  const de = inicioDoDiaDeTexto(param(sp, "de", 10)) ? param(sp, "de", 10) : undefined;
  const ate = inicioDoDiaDeTexto(param(sp, "ate", 10)) ? param(sp, "ate", 10) : undefined;
  const p = param(sp, "periodo", 6);
  const torre = param(sp, "torre");
  const status = param(sp, "status", 12);
  return {
    periodo: de || ate ? "custom" : (PERIODOS as readonly string[]).includes(p ?? "") ? (p as PeriodoChave) : padrao,
    de,
    ate,
    torre: torre === "A" || torre === "B" ? torre : undefined,
    status: ehStatus(status) ? status : undefined,
    paradas: param(sp, "paradas") === "1",
    q: param(sp, "q", 60),
  };
}

/** Intervalo em datas inclusivas ("AAAA-MM-DD"), ou {} quando é "tudo". */
export function intervaloEmTexto(f: FiltrosHistorico, agora: Date = new Date()): { de?: string; ate?: string } {
  const hoje = diaLocalISO(agora);
  switch (f.periodo) {
    case "7":
      return { de: diaLocalISO(somarDiasLocal(agora, -6)), ate: hoje };
    case "30":
      return { de: diaLocalISO(somarDiasLocal(agora, -29)), ate: hoje };
    case "90":
      return { de: diaLocalISO(somarDiasLocal(agora, -89)), ate: hoje };
    case "ano":
      return { de: `${partesLocais(agora).ano}-01-01`, ate: hoje };
    case "custom":
      return { de: f.de, ate: f.ate };
    default:
      return {};
  }
}

export function periodoDoFiltro(f: FiltrosHistorico, agora?: Date): Periodo {
  const { de, ate } = intervaloEmTexto(f, agora);
  return periodoDeDias(de, ate);
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Texto curto do período para os rótulos dos cartões ("nos últimos 30 dias", "em 2026"). */
export function rotuloPeriodo(f: FiltrosHistorico, agora: Date = new Date()): string {
  switch (f.periodo) {
    case "7":
      return "nos últimos 7 dias";
    case "30":
      return "nos últimos 30 dias";
    case "90":
      return "nos últimos 90 dias";
    case "ano":
      return `em ${partesLocais(agora).ano}`;
    case "tudo":
      return "no total";
    default: {
      if (f.de && f.ate) return `de ${dm(f.de)} a ${dm(f.ate)}`;
      if (f.de) return `desde ${dm(f.de)}`;
      return f.ate ? `até ${dm(f.ate)}` : "no período";
    }
  }
}

/** Link da própria página com os filtros atuais, trocando só o que veio em `mudar`. */
export function hrefFiltros(
  base: string,
  f: FiltrosHistorico,
  mudar: Partial<Record<"periodo" | "de" | "ate" | "torre" | "status" | "paradas" | "q", string | boolean | undefined | null>> = {}
): string {
  const v = { periodo: f.periodo === "custom" ? undefined : f.periodo, de: f.de, ate: f.ate, torre: f.torre, status: f.status, paradas: f.paradas, q: f.q, ...mudar };
  // escolher um período pronto descarta as datas personalizadas
  if ("periodo" in mudar && mudar.periodo) {
    v.de = undefined;
    v.ate = undefined;
  }
  return `${base}${qs(v as Record<string, string | boolean | undefined>)}`;
}
