"use server";

/**
 * Escrita das encomendas (22/10/2026). Ordem de toda action: guarda de papel →
 * zod → regra de negócio (`lib/encomendas-escrita.ts`) → log → revalidate.
 * Guarda: `portaria` e `admin` (o admin opera o balcão também). Retorno sempre
 * `{ ok, erro? ... }` com mensagem em pt-BR; erro inesperado vira mensagem
 * genérica + LogEvento 'erro' (nunca vaza detalhe interno).
 *
 * Atenção: tudo que é EXPORTADO aqui vira endpoint público de Server Action —
 * por isso só as 4 actions são exportadas; os helpers ficam privados.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  MSG_SEM_PERMISSAO,
  MSG_SESSAO_EXPIRADA,
  exigirPortariaOuAdmin,
  lerSessaoVerificada,
} from "@/lib/auth";
import { TIPOS } from "@/lib/encomenda-constantes";
import {
  ErroFotoAposCriar,
  cancelarEncomendaDominio,
  marcarAvisoWhatsAppDominio,
  registrarEncomendaDominio,
  retirarEncomendaDominio,
} from "@/lib/encomendas-escrita";
import { prepararAviso } from "@/lib/encomendas";
import { ErroDominio } from "@/lib/erro-dominio";
import { registrarEvento } from "@/lib/log";
import type { SessaoPayload } from "@/lib/sessao-token";

export type ResultadoRegistro =
  | {
      ok: true;
      id: number;
      codigo: string;
      /** link pronto do WhatsApp, ou null se ninguém do apto tem telefone */
      linkWhatsApp: string | null;
      apartamento: string;
      destinatarioNome: string;
      tipo: string;
      transportadora: string | null;
      porteiroNome: string;
    }
  | { ok: false; erro: string };

export type ResultadoRetirada =
  | { ok: true; id: number; codigo: string; apartamento: string; retiradaPor: string; terceiro: boolean }
  | { ok: false; erro: string };

export type ResultadoCancelamento =
  | { ok: true; id: number; codigo: string }
  | { ok: false; erro: string };

export type ResultadoAviso = { ok: true; link: string } | { ok: false; link: null; erro: string };

/* ---------------------------------------------------------------- privados */

async function guarda(): Promise<{ sessao: SessaoPayload } | { erro: string }> {
  const sessao = await exigirPortariaOuAdmin();
  if (sessao) return { sessao };
  return { erro: (await lerSessaoVerificada()) ? MSG_SEM_PERMISSAO : MSG_SESSAO_EXPIRADA };
}

const MSG_INESPERADO = "Não foi possível concluir agora. Tente de novo; se continuar, avise o administrador.";

async function erroParaUsuario(
  e: unknown,
  sessao: SessaoPayload,
  rota: string,
  contexto: string
): Promise<string> {
  if (e instanceof ErroDominio) return e.message;
  console.error(`${contexto} falhou:`, e);
  await registrarEvento(sessao, "erro", rota, `${contexto}: ${e instanceof Error ? e.message : String(e)}`);
  return MSG_INESPERADO;
}

function revalidarEncomendas(): void {
  for (const rota of ["/portaria", "/portaria/historico", "/app", "/app/historico", "/admin"]) {
    revalidatePath(rota);
  }
  revalidatePath("/portaria/historico/[apto]", "page");
  revalidatePath("/app/encomenda/[codigo]", "page");
}

function primeiroErro(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Dados inválidos";
}

/** Campo de texto do FormData: aparado, "" vira undefined, arquivo vira undefined. */
function campo(fd: FormData, nome: string): string | undefined {
  const v = fd.get(nome);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function ehArquivo(v: unknown): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as File).arrayBuffer === "function" &&
    typeof (v as File).size === "number" &&
    typeof (v as File).name === "string"
  );
}

const idDoForm = (msg: string) =>
  z
    .string({ error: msg })
    .regex(/^\d{1,9}$/, msg)
    .transform(Number)
    .pipe(z.number().int().positive(msg));

const schemaRegistro = z
  .object({
    apartamentoId: idDoForm("Escolha o apartamento"),
    destinatarioMoradorId: idDoForm("Morador inválido").optional(),
    destinatarioNome: z.string().trim().min(2, "Informe para quem é a encomenda").max(80, "Nome longo demais (máx. 80)").optional(),
    tipo: z.enum(TIPOS, { error: "Escolha o tipo da encomenda" }),
    transportadora: z.string().trim().max(60, "Transportadora longa demais (máx. 60)").optional(),
    observacao: z.string().trim().max(300, "Observação longa demais (máx. 300)").optional(),
    local: z.string().trim().max(60, "Local longo demais (máx. 60)").optional(),
  })
  .refine((d) => d.destinatarioMoradorId !== undefined || d.destinatarioNome !== undefined, {
    message: "Escolha para quem é a encomenda",
    path: ["destinatarioNome"],
  });

const schemaRetirada = z.object({
  codigo: z.string({ error: "Informe o código da encomenda" }).max(40, "Código longo demais"),
  retiradaPorMoradorId: z.number({ error: "Morador inválido" }).int().positive("Morador inválido").nullish(),
  terceiroNome: z.string().trim().max(80, "Nome longo demais (máx. 80)").nullish(),
  terceiroDoc: z.string().trim().max(30, "Documento longo demais (máx. 30)").nullish(),
});

const schemaCancelamento = z.object({
  id: z.number({ error: "Encomenda inválida" }).int().positive("Encomenda inválida"),
  motivo: z
    .string({ error: "Informe o motivo do cancelamento" })
    .trim()
    .min(3, "Informe o motivo do cancelamento (mínimo 3 letras)")
    .max(200, "Motivo longo demais (máx. 200)"),
});

const schemaAviso = z.object({
  id: z.number({ error: "Encomenda inválida" }).int().positive("Encomenda inválida"),
});

/* ----------------------------------------------------------------- actions */

/**
 * Campos do FormData: apartamentoId, destinatarioMoradorId | destinatarioNome,
 * tipo, transportadora?, observacao?, local?, fotos (1 a 3 arquivos, mesmo nome
 * de campo "fotos"). Exige turno aberto: o porteiro do turno é o "recebido por".
 */
export async function registrarEncomenda(formData: FormData): Promise<ResultadoRegistro> {
  const g = await guarda();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const { sessao } = g;
  const rota = "/portaria/registrar";

  if (!(formData instanceof FormData)) return { ok: false, erro: "Dados inválidos" };
  const parsed = schemaRegistro.safeParse({
    apartamentoId: campo(formData, "apartamentoId"),
    destinatarioMoradorId: campo(formData, "destinatarioMoradorId"),
    destinatarioNome: campo(formData, "destinatarioNome"),
    tipo: campo(formData, "tipo"),
    transportadora: campo(formData, "transportadora"),
    observacao: campo(formData, "observacao"),
    local: campo(formData, "local"),
  });
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const fotos = formData.getAll("fotos").filter(ehArquivo);

  try {
    const r = await registrarEncomendaDominio({ ...parsed.data, fotos });
    let linkWhatsApp: string | null = null;
    try {
      const aviso = await prepararAviso(r.id);
      linkWhatsApp = aviso.ok ? aviso.link : null;
    } catch (e) {
      console.error("registrarEncomenda: aviso WhatsApp falhou (registro mantido):", e);
    }
    await registrarEvento(
      sessao,
      "encomenda",
      rota,
      `Registrada ${r.codigo} · ${r.apartamento} · ${r.destinatarioNome} · ${r.tipo}` +
        `${r.transportadora ? ` · ${r.transportadora}` : ""} · recebida por ${r.porteiroNome} (${r.totalFotos} foto${r.totalFotos > 1 ? "s" : ""})`
    );
    revalidarEncomendas();
    return {
      ok: true,
      id: r.id,
      codigo: r.codigo,
      linkWhatsApp,
      apartamento: r.apartamento,
      destinatarioNome: r.destinatarioNome,
      tipo: r.tipo,
      transportadora: r.transportadora,
      porteiroNome: r.porteiroNome,
    };
  } catch (e) {
    if (e instanceof ErroFotoAposCriar) {
      await registrarEvento(sessao, "cancelamento", rota, `Cancelada automaticamente ${e.codigo}: falha ao salvar foto`);
    }
    return { ok: false, erro: await erroParaUsuario(e, sessao, rota, "registrarEncomenda") };
  }
}

/**
 * Entrega a encomenda do `codigo` (só se estiver aguardando): quem retirou é um
 * morador do MESMO apto OU um terceiro (nome obrigatório) - exatamente um.
 * Exige turno aberto: o porteiro do turno é o "entregue por".
 */
export async function confirmarRetirada(entrada: {
  codigo: string;
  retiradaPorMoradorId?: number | null;
  terceiroNome?: string | null;
  terceiroDoc?: string | null;
}): Promise<ResultadoRetirada> {
  const g = await guarda();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const { sessao } = g;
  const rota = "/portaria/retirada";

  const parsed = schemaRetirada.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };

  try {
    const r = await retirarEncomendaDominio(parsed.data);
    const doc = parsed.data.terceiroDoc?.trim() ? ", documento informado" : "";
    await registrarEvento(
      sessao,
      "retirada",
      rota,
      `Retirada ${r.codigo} · ${r.apartamento} · retirou ${r.retiradaPor}${r.terceiro ? ` (terceiro${doc})` : ""} · entregue por ${r.entreguePorNome}`
    );
    revalidatePath("/portaria");
    revalidatePath("/portaria/historico");
    revalidatePath("/portaria/historico/[apto]", "page");
    revalidatePath("/app");
    revalidatePath("/app/historico");
    revalidatePath("/app/encomenda/[codigo]", "page");
    revalidatePath("/admin");
    return {
      ok: true,
      id: r.id,
      codigo: r.codigo,
      apartamento: r.apartamento,
      retiradaPor: r.retiradaPor,
      terceiro: r.terceiro,
    };
  } catch (e) {
    return { ok: false, erro: await erroParaUsuario(e, sessao, rota, "confirmarRetirada") };
  }
}

/**
 * Cancela (status `cancelada` + motivo; nada é apagado). Admin cancela qualquer
 * encomenda aguardando; portaria só as registradas no turno aberto atual.
 */
export async function cancelarEncomenda(entrada: { id: number; motivo: string }): Promise<ResultadoCancelamento> {
  const g = await guarda();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const { sessao } = g;
  const rota = "/portaria";

  const parsed = schemaCancelamento.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };

  try {
    const r = await cancelarEncomendaDominio({ ...parsed.data, admin: sessao.papel === "admin" });
    await registrarEvento(sessao, "cancelamento", rota, `Cancelada ${r.codigo} · ${r.apartamento} · motivo: ${r.motivo}`);
    revalidarEncomendas();
    return { ok: true, id: r.id, codigo: r.codigo };
  } catch (e) {
    return { ok: false, erro: await erroParaUsuario(e, sessao, rota, "cancelarEncomenda") };
  }
}

/**
 * Marca o aviso e devolve o link `wa.me` (telefone do destinatário; se ele não
 * tem, o do 1º morador do apto com telefone). Sem telefone: `link: null` + erro.
 */
export async function marcarAvisoWhatsApp(entrada: { id: number }): Promise<ResultadoAviso> {
  const g = await guarda();
  if ("erro" in g) return { ok: false, link: null, erro: g.erro };
  const { sessao } = g;
  const rota = "/portaria";

  const parsed = schemaAviso.safeParse(entrada);
  if (!parsed.success) return { ok: false, link: null, erro: primeiroErro(parsed.error) };

  try {
    const aviso = await marcarAvisoWhatsAppDominio(parsed.data.id);
    if (!aviso.ok) return { ok: false, link: null, erro: aviso.erro };
    await registrarEvento(sessao, "encomenda", rota, `Aviso por WhatsApp aberto para ${aviso.paraNome} (encomenda ${aviso.codigo})`);
    revalidatePath("/portaria");
    revalidatePath("/admin");
    return { ok: true, link: aviso.link };
  } catch (e) {
    return { ok: false, link: null, erro: await erroParaUsuario(e, sessao, rota, "marcarAvisoWhatsApp") };
  }
}
