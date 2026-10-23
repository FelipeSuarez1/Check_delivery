/**
 * Fotos das encomendas (22/10/2026). Segurança em camadas:
 *  - allowlist de extensão + mime + ASSINATURA REAL do arquivo (JPEG/PNG/WebP);
 *  - ≤ 10 MB; nome gerado no servidor (`<encomendaId>-<ordem>-<hex>.<ext>`),
 *    nunca derivado do que o cliente mandou;
 *  - grava em `uploads/encomendas/` (FORA de /public; só `/fotos/[id]` serve, com sessão);
 *  - retenção: `apagarFotosAntigas` remove o ARQUIVO e marca `apagadaEm`; o registro fica.
 * Só servidor (usa node:fs).
 */
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { DIA_MS } from "@/lib/datas";
import { ErroDominio } from "@/lib/erro-dominio";

export const FOTO_MAX_BYTES = 10 * 1024 * 1024;
export const DIR_FOTOS = path.resolve(process.cwd(), "uploads", "encomendas");

export type ExtensaoFoto = "jpg" | "png" | "webp";
const MIME_POR_EXT: Record<ExtensaoFoto, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const EXTENSOES_ACEITAS: Record<string, ExtensaoFoto> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp" };
const NOME_GERADO = /^\d+-\d+-[0-9a-f]{16}\.(jpg|png|webp)$/;

/** Erro de validação de foto — a mensagem é pt-BR e pode ir direto à tela. */
export class ErroFoto extends ErroDominio {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroFoto";
  }
}

export type ResultadoValidacaoFoto =
  | { ok: true; ext: ExtensaoFoto; tamanho: number }
  | { ok: false; erro: string };

function ehArquivo(v: unknown): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as File).arrayBuffer === "function" &&
    typeof (v as File).slice === "function" &&
    typeof (v as File).size === "number"
  );
}

function tipoPelaAssinatura(b: Uint8Array): ExtensaoFoto | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "webp";
  }
  return null;
}

/** Valida sem gravar (barato: lê só os 16 primeiros bytes). */
export async function validarFoto(file: unknown): Promise<ResultadoValidacaoFoto> {
  if (!ehArquivo(file)) return { ok: false, erro: "Foto inválida" };
  if (file.size === 0) return { ok: false, erro: "A foto veio vazia — tire de novo" };
  if (file.size > FOTO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1).replace(".", ",");
    return { ok: false, erro: `A foto tem ${mb} MB — o limite é 10 MB` };
  }
  const extNome = path.extname(file.name ?? "").slice(1).toLowerCase();
  const extDeclarada = EXTENSOES_ACEITAS[extNome];
  if (!extDeclarada) {
    return { ok: false, erro: `Formato${extNome ? ` .${extNome}` : ""} não aceito — use JPG, PNG ou WebP` };
  }
  const mime = (file.type ?? "").toLowerCase();
  if (mime && !Object.values(MIME_POR_EXT).includes(mime)) {
    return { ok: false, erro: "Tipo de imagem não aceito — use JPG, PNG ou WebP" };
  }
  const cabecalho = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const real = tipoPelaAssinatura(cabecalho);
  if (!real) return { ok: false, erro: "O arquivo não é uma imagem JPG, PNG ou WebP válida" };
  if (real !== extDeclarada) return { ok: false, erro: "O conteúdo do arquivo não bate com o formato informado" };
  return { ok: true, ext: real, tamanho: file.size };
}

/** Grava o arquivo + registro `FotoEncomenda`. Lança `ErroFoto` se a foto for inválida. */
export async function salvarFoto(
  file: File,
  encomendaId: number,
  ordem: number
): Promise<{ id: number; arquivo: string }> {
  if (!Number.isInteger(encomendaId) || encomendaId <= 0) throw new Error("encomendaId inválido");
  if (!Number.isInteger(ordem) || ordem < 1 || ordem > 9) throw new Error("ordem inválida");

  const v = await validarFoto(file);
  if (!v.ok) throw new ErroFoto(v.erro);

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length > FOTO_MAX_BYTES) throw new ErroFoto("Tamanho de foto inválido");

  await mkdir(DIR_FOTOS, { recursive: true });
  const arquivo = `${encomendaId}-${ordem}-${randomBytes(8).toString("hex")}.${v.ext}`;
  const destino = path.join(DIR_FOTOS, arquivo);
  await writeFile(destino, bytes, { flag: "wx", mode: 0o600 }); // wx: nunca sobrescreve

  try {
    const foto = await prisma.fotoEncomenda.create({ data: { encomendaId, arquivo, ordem } });
    return { id: foto.id, arquivo };
  } catch (e) {
    await unlink(destino).catch(() => undefined); // sem registro = sem arquivo órfão
    throw e;
  }
}

/** Caminho absoluto SEMPRE dentro de uploads/encomendas (basename + formato gerado). */
export function caminhoFoto(foto: { arquivo: string }): string {
  const nome = path.basename(foto.arquivo);
  if (!NOME_GERADO.test(nome)) throw new Error("Nome de arquivo de foto inválido");
  const caminho = path.join(DIR_FOTOS, nome);
  if (path.dirname(caminho) !== DIR_FOTOS) throw new Error("Caminho de foto fora da pasta de uploads");
  return caminho;
}

/** Content-Type pela extensão do arquivo gerado; null se a extensão não for aceita. */
export function tipoMimeFoto(arquivo: string): string | null {
  const ext = path.extname(arquivo).slice(1).toLowerCase();
  return ext in MIME_POR_EXT ? MIME_POR_EXT[ext as ExtensaoFoto] : null;
}

export type ItemRetencao = {
  fotoId: number;
  encomendaId: number;
  codigo: string;
  arquivo: string;
  status: string;
  desde: Date;
};

export type ResultadoRetencao = {
  aplicado: boolean;
  dias: number;
  limite: Date;
  /** fotos que se enquadram na regra */
  itens: ItemRetencao[];
  /** arquivos removidos agora */
  apagadas: number;
  /** registro marcado, mas o arquivo já não existia no disco */
  jaAusentes: number;
  falhas: { fotoId: number; erro: string }[];
};

/**
 * Retenção LGPD: fotos de encomendas entregues ou canceladas cuja data de
 * entrega/cancelamento é anterior a (agora - dias). `aplicar=false` (padrão)
 * só lista. `opcoes.encomendaIds` restringe o alcance (usado pelo teste).
 */
export async function apagarFotosAntigas(
  dias = 90,
  aplicar = false,
  opcoes?: { encomendaIds?: number[]; agora?: Date }
): Promise<ResultadoRetencao> {
  if (!Number.isInteger(dias) || dias < 1) throw new RangeError("dias deve ser um inteiro maior ou igual a 1");
  const agora = opcoes?.agora ?? new Date();
  const limite = new Date(agora.getTime() - dias * DIA_MS);

  const fotos = await prisma.fotoEncomenda.findMany({
    where: {
      apagadaEm: null,
      ...(opcoes?.encomendaIds ? { encomendaId: { in: opcoes.encomendaIds } } : {}),
      encomenda: {
        OR: [
          { status: "entregue", entregueEm: { lt: limite } },
          { status: "cancelada", canceladaEm: { lt: limite } },
        ],
      },
    },
    include: { encomenda: { select: { codigo: true, status: true, entregueEm: true, canceladaEm: true } } },
    orderBy: { id: "asc" },
  });

  const itens: ItemRetencao[] = fotos.map((f) => ({
    fotoId: f.id,
    encomendaId: f.encomendaId,
    codigo: f.encomenda.codigo,
    arquivo: f.arquivo,
    status: f.encomenda.status,
    desde: (f.encomenda.status === "entregue" ? f.encomenda.entregueEm : f.encomenda.canceladaEm) ?? limite,
  }));

  const resultado: ResultadoRetencao = {
    aplicado: aplicar,
    dias,
    limite,
    itens,
    apagadas: 0,
    jaAusentes: 0,
    falhas: [],
  };
  if (!aplicar) return resultado;

  for (const f of fotos) {
    try {
      try {
        await unlink(caminhoFoto(f));
        resultado.apagadas++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        resultado.jaAusentes++;
      }
      await prisma.fotoEncomenda.update({ where: { id: f.id }, data: { apagadaEm: agora } });
    } catch (e) {
      resultado.falhas.push({ fotoId: f.id, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return resultado;
}
