/**
 * Teste das ACTIONS e da rota /fotos/[id] (22/10/2026) - auto-reversivel.
 * As actions leem o cookie via next/headers; aqui o modulo e substituido por um
 * stub e a sessao e um token REAL (HMAC) de usuarios de teste criados no banco.
 * Cobre: guarda de papel, zod sobre FormData/JSON, fluxo registrar -> avisar ->
 * retirar -> cancelar, turno, LogEvento, /fotos/[id] (200/404) e a renderizacao
 * SSR dos componentes. Inclui a recusa de aviso por WhatsApp (LGPD, 23/10/2026):
 * definirAvisoWhatsApp (admin), registrar/marcarAviso sem link para quem recusou e as
 * telas da portaria com o motivo. Apaga tudo ao final. Saida ASCII; exit 1 se falhar.
 *   npx tsx scripts/teste-actions.ts
 */
import Module from "node:module";
import { readdir, unlink } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createElement } from "react";
import { codigoValido } from "../src/lib/codigo";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { PassThrough } from "node:stream";

const MARCA = "ZZTESTE";
process.env.AUTH_SECRET = `teste-actions-${Math.random().toString(36).slice(2)}-segredo-longo`;

let tokenAtual = "";
let nomeCookie = "";
const revalidados: string[] = [];
const carregador = Module as unknown as { _load: (request: string, ...resto: unknown[]) => unknown };
const carregarOriginal = carregador._load;
carregador._load = function (request: string, ...resto: unknown[]) {
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (nome: string) => (tokenAtual && nome === nomeCookie ? { name: nome, value: tokenAtual } : undefined),
      }),
      headers: async () => new Headers(),
    };
  }
  if (request === "next/navigation") {
    return {
      notFound: () => {
        throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
      },
      useRouter: () => ({ back: () => undefined, push: () => undefined }),
    };
  }
  if (request === "next/cache") {
    return { revalidatePath: (p: string) => void revalidados.push(p), revalidateTag: () => undefined, updateTag: () => undefined };
  }
  return carregarOriginal.call(this, request, ...resto);
};

let total = 0;
let falhas = 0;
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
function ok(cond: boolean, nome: string, detalhe = ""): void {
  total++;
  if (cond) console.log(`PASS ${nome}`);
  else {
    falhas++;
    console.log(`FAIL ${nome}${detalhe ? ` -> ${ascii(detalhe)}` : ""}`);
  }
}
const temErro = (r: { ok: boolean; erro?: string }, trecho: string) =>
  !r.ok && ascii(r.erro ?? "").toLowerCase().includes(ascii(trecho).toLowerCase());

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunkPng(tipo: string, dados: Buffer): Buffer {
  const t = Buffer.from(tipo, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
function pngMinimo(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", deflateSync(Buffer.from([0, 0xc4, 0x7a, 0x2c]))),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}
const foto = (nome = "etiqueta.png") => new File([new Uint8Array(pngMinimo())], nome, { type: "image/png" });

function formulario(campos: Record<string, string | undefined>, fotos: File[] = [foto()]): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) fd.append(k, v);
  for (const f of fotos) fd.append("fotos", f);
  return fd;
}

async function main(): Promise<void> {
  // carregados DEPOIS do stub de next/headers e next/cache
  const { prisma } = await import("../src/lib/db");
  const auth = await import("../src/lib/auth");
  const { assinarSessao } = await import("../src/lib/sessao-token");
  const { versaoSenha } = await import("../src/lib/senha");
  const act = await import("../src/actions/encomendas");
  const tur = await import("../src/actions/turno");
  const rotaFoto = await import("../src/app/fotos/[id]/route");
  const { caminhoFoto, DIR_FOTOS } = await import("../src/lib/fotos");
  nomeCookie = auth.COOKIE_SESSAO;

  const APTO_A = "993A";
  const APTO_B = "994B";
  async function limpar(): Promise<void> {
    const aptos = await prisma.apartamento.findMany({ where: { numero: { in: [APTO_A, APTO_B] } }, select: { id: true } });
    const ids = aptos.map((a) => a.id);
    const fotos = await prisma.fotoEncomenda.findMany({ where: { encomenda: { apartamentoId: { in: ids } } } });
    for (const f of fotos) await unlink(caminhoFoto(f)).catch(() => undefined);
    await prisma.fotoEncomenda.deleteMany({ where: { encomenda: { apartamentoId: { in: ids } } } });
    await prisma.encomenda.deleteMany({ where: { apartamentoId: { in: ids } } });
    await prisma.logEvento.deleteMany({ where: { usuarioNome: { startsWith: MARCA } } });
    await prisma.usuario.deleteMany({ where: { login: { startsWith: "zzteste-" } } });
    await prisma.morador.deleteMany({ where: { apartamentoId: { in: ids } } });
    await prisma.apartamento.deleteMany({ where: { id: { in: ids } } });
    const ps = (await prisma.porteiro.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id);
    await prisma.turno.deleteMany({ where: { porteiroId: { in: ps } } });
    await prisma.porteiro.deleteMany({ where: { id: { in: ps } } });
  }

  await limpar();
  const abertosAntes = (await prisma.turno.findMany({ where: { fim: null }, select: { id: true } })).map((t) => t.id);
  const arquivosAntes = (await readdir(DIR_FOTOS).catch(() => [] as string[])).sort();
  try {
    const aptoA = await prisma.apartamento.create({ data: { numero: APTO_A, torre: "A", andar: 98 } });
    const aptoB = await prisma.apartamento.create({ data: { numero: APTO_B, torre: "B", andar: 98 } });
    const ana = await prisma.morador.create({ data: { apartamentoId: aptoA.id, nome: "Ana Prado", telefone: "(11) 98765-4321" } });
    const rui = await prisma.morador.create({ data: { apartamentoId: aptoA.id, nome: "Rui Prado" } });
    const porteiro = await prisma.porteiro.create({ data: { nome: `${MARCA} Carlos` } });

    const hash = "hash-de-teste-nao-usado-para-login";
    const usuario = (login: string, papel: string, apartamentoId?: number) =>
      prisma.usuario.create({
        data: { login: `zzteste-${login}`, nome: `${MARCA} ${login}`, senhaHash: hash, senhaSalt: "salt", papel, apartamentoId: apartamentoId ?? null, precisaTrocarSenha: false },
      });
    const uPort = await usuario("portaria", "portaria");
    const uAdmin = await usuario("admin", "admin");
    const uMorA = await usuario("morador-a", "morador", aptoA.id);
    const uMorB = await usuario("morador-b", "morador", aptoB.id);
    const tokenDe = (u: { id: number; nome: string; papel: string }) =>
      assinarSessao({ id: u.id, nome: u.nome, papel: u.papel as "admin", exp: Date.now() + 3_600_000, sv: versaoSenha(hash) }, process.env.AUTH_SECRET as string);
    const tPort = await tokenDe(uPort);
    const tAdmin = await tokenDe(uAdmin);
    const tMorA = await tokenDe(uMorA);
    const tMorB = await tokenDe(uMorB);

    console.log("--- guarda de papel");
    tokenAtual = "";
    ok(temErro(await act.registrarEncomenda(formulario({})), "Sessão expirada"), "sem cookie: registrarEncomenda pede login");
    ok(temErro(await act.confirmarRetirada({ codigo: "K7M3", terceiroNome: "X Y" }), "Sessão expirada"), "sem cookie: confirmarRetirada");
    ok(temErro(await act.cancelarEncomenda({ id: 1, motivo: "teste" }), "Sessão expirada"), "sem cookie: cancelarEncomenda");
    ok(temErro(await tur.iniciarTurno({ porteiroId: porteiro.id }), "Sessão expirada"), "sem cookie: iniciarTurno");
    ok((await tur.turnoAberto()) === null, "sem cookie: turnoAberto = null");
    tokenAtual = tMorA;
    const MSG = "Sem permissão";
    ok(temErro(await act.registrarEncomenda(formulario({ apartamentoId: String(aptoA.id) })), MSG), "morador: registrarEncomenda barrado");
    ok(temErro(await act.confirmarRetirada({ codigo: "K7M3", terceiroNome: "X Y" }), MSG), "morador: confirmarRetirada barrado");
    ok(temErro(await act.cancelarEncomenda({ id: 1, motivo: "teste" }), MSG), "morador: cancelarEncomenda barrado");
    const av = await act.marcarAvisoWhatsApp({ id: 1 });
    ok(!av.ok && ascii(av.erro).includes("Sem permissao") && av.link === null, "morador: marcarAvisoWhatsApp barrado");
    ok(temErro(await tur.iniciarTurno({ porteiroId: porteiro.id }), MSG) && temErro(await tur.encerrarTurno(), MSG), "morador: turno barrado");
    ok((await tur.turnoAberto()) === null, "morador: turnoAberto = null");

    await executarFluxos({ prisma, act, tur, rotaFoto, caminhoFoto, aptoA, aptoB, ana, rui, porteiro, uPort, uAdmin, uMorA, uMorB, tPort, tAdmin, tMorA, tMorB });
  } finally {
    tokenAtual = "";
    await limpar();
    if (abertosAntes.length > 0) await prisma.turno.updateMany({ where: { id: { in: abertosAntes } }, data: { fim: null } });
  }
  const sobras = await prisma.usuario.count({ where: { login: { startsWith: "zzteste-" } } });
  ok(sobras === 0 && (await prisma.apartamento.count({ where: { numero: { in: [APTO_A, APTO_B] } } })) === 0, "limpeza: usuarios e aptos de teste removidos");
  ok(JSON.stringify((await readdir(DIR_FOTOS).catch(() => [] as string[])).sort()) === JSON.stringify(arquivosAntes), "limpeza: uploads igual ao de antes");
  await prisma.$disconnect();
}

type Ambiente = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function executarFluxos(e: Ambiente): Promise<void> {
  const { prisma, act, tur, rotaFoto, aptoA, ana, porteiro, tPort, tAdmin, tMorA, tMorB } = e;
  const registrar = (fd: FormData) => act.registrarEncomenda(fd);
  const contar = () => prisma.encomenda.count({ where: { apartamentoId: aptoA.id } });
  const base = { apartamentoId: String(aptoA.id), destinatarioMoradorId: String(ana.id), tipo: "caixa" };

  await prisma.turno.updateMany({ where: { fim: null }, data: { fim: new Date() } });
  tokenAtual = tPort;
  console.log("--- turno");
  ok(temErro(await registrar(formulario(base)), "Abra o turno"), "sem turno aberto: registrar pede turno");
  ok(temErro(await tur.iniciarTurno({ porteiroId: "abc" as never }), "Escolha o porteiro"), "iniciarTurno: zod recusa porteiroId invalido");
  ok(temErro(await tur.iniciarTurno({ porteiroId: 99999999 }), "Porteiro não encontrado"), "iniciarTurno: porteiro inexistente");
  const ini = await tur.iniciarTurno({ porteiroId: porteiro.id });
  ok(ini.ok && ini.trocou && ini.turno.porteiroNome === porteiro.nome, "iniciarTurno ok");
  const aberto = await tur.turnoAberto();
  ok(aberto?.porteiroId === porteiro.id && typeof aberto.inicioISO === "string", "turnoAberto devolve o turno");
  const logTurno = await prisma.logEvento.findFirst({ where: { tipo: "turno", usuarioId: e.uPort.id }, orderBy: { id: "desc" } });
  ok(!!logTurno && logTurno.detalhe?.includes("Turno iniciado"), "iniciarTurno gravou LogEvento");

  console.log("--- registrarEncomenda (validacao)");
  ok(temErro(await registrar(formulario({ ...base, apartamentoId: undefined })), "Escolha o apartamento"), "sem apartamento");
  ok(temErro(await registrar(formulario({ ...base, apartamentoId: "1e3" })), "Escolha o apartamento"), "apartamentoId so aceita digitos");
  ok(temErro(await registrar(formulario({ ...base, tipo: undefined })), "Escolha o tipo"), "sem tipo");
  ok(temErro(await registrar(formulario({ ...base, tipo: "foguete" })), "Escolha o tipo"), "tipo fora da lista");
  ok(temErro(await registrar(formulario({ ...base, destinatarioMoradorId: undefined })), "para quem"), "sem destinatario");
  ok(temErro(await registrar(formulario({ ...base, observacao: "x".repeat(301) })), "Observação longa"), "observacao longa");
  ok(temErro(await registrar(formulario(base, [])), "pelo menos 1 foto"), "sem foto");
  ok(temErro(await registrar(formulario(base, [foto(), foto(), foto(), foto()])), "No máximo 3"), "4 fotos");
  ok(temErro(await registrar(formulario(base, [new File(["<html>"], "x.jpg", { type: "image/jpeg" })])), "imagem"), "foto que nao e imagem");
  ok((await contar()) === 0, "validacao falha nao cria encomenda");

  console.log("--- registrarEncomenda (fluxo)");
  revalidados.length = 0;
  const r = await registrar(formulario({ ...base, transportadora: "Amazon", local: "A3" }, [foto(), foto("volume.png")]));
  ok(r.ok && codigoValido(r.codigo), "registra e devolve codigo valido");
  if (!r.ok) throw new Error(`registrar falhou: ${r.erro}`);
  ok(typeof r.linkWhatsApp === "string" && r.linkWhatsApp.startsWith("https://wa.me/5511987654321?text="), "devolve link do WhatsApp do destinatario");
  ok(r.apartamento === "993A" && r.destinatarioNome === "Ana Prado" && r.porteiroNome === porteiro.nome, "devolve apto, destinatario e porteiro do turno");
  ok((await prisma.fotoEncomenda.count({ where: { encomendaId: r.id } })) === 2, "2 fotos gravadas");
  ok(revalidados.includes("/portaria") && revalidados.includes("/app"), "revalida /portaria e /app");
  const logReg = await prisma.logEvento.findFirst({ where: { tipo: "encomenda", usuarioId: e.uPort.id }, orderBy: { id: "desc" } });
  ok(!!logReg && (logReg.detalhe ?? "").includes(r.codigo) && logReg.rota === "/portaria/registrar", "gravou LogEvento da encomenda");

  console.log("--- /fotos/[id]");
  const fotos = await prisma.fotoEncomenda.findMany({ where: { encomendaId: r.id }, orderBy: { ordem: "asc" } });
  const pedir = (id: string, token: string) => {
    tokenAtual = token;
    return rotaFoto.GET(new Request(`http://localhost/fotos/${id}`) as never, { params: Promise.resolve({ id }) }) as Promise<Response>;
  };
  const resp = await pedir(String(fotos[0].id), tPort);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  ok(resp.status === 200 && resp.headers.get("content-type") === "image/png" && bytes[0] === 0x89, "portaria recebe a imagem (200, image/png)");
  ok(resp.headers.get("x-content-type-options") === "nosniff" && resp.headers.get("cache-control") === "private, no-store", "cabecalhos nosniff e sem cache (aparelho compartilhado)");
  ok((await pedir(String(fotos[0].id), tAdmin)).status === 200, "admin recebe a foto");
  ok((await pedir(String(fotos[0].id), tMorA)).status === 200, "morador do MESMO apto recebe a foto");
  ok((await pedir(String(fotos[0].id), tMorB)).status === 404, "morador de OUTRO apto: 404 (nunca 403)");
  ok((await pedir(String(fotos[0].id), "")).status === 404, "sem sessao: 404");
  for (const id of ["abc", "0", "-1", "1.5", "99999999999", "99999999"]) {
    ok((await pedir(id, tPort)).status === 404, `id invalido/inexistente (${id}): 404`);
  }
  await prisma.fotoEncomenda.update({ where: { id: fotos[1].id }, data: { apagadaEm: new Date() } });
  ok((await pedir(String(fotos[1].id), tPort)).status === 404, "foto apagada pela retencao: 404");
  const barra = String.fromCharCode(92);
  for (const arquivo of ["../../.env", `..${barra}..${barra}.env`, "1-1-0000000000000000.png", "x.html"]) {
    await prisma.fotoEncomenda.update({ where: { id: fotos[0].id }, data: { arquivo } });
    ok((await pedir(String(fotos[0].id), tPort)).status === 404, `nome adulterado no banco (${arquivo.split(barra).join("/")}): 404`);
  }
  await prisma.fotoEncomenda.update({ where: { id: fotos[0].id }, data: { arquivo: fotos[0].arquivo } });
  ok((await pedir(String(fotos[0].id), tPort)).status === 200, "restaurado: volta a servir");

  await fluxoRetiradaCancelamento(e, r);
}

async function fluxoRetiradaCancelamento(e: Ambiente, r: { id: number; codigo: string }): Promise<void> {
  const { prisma, act, tur, aptoA, ana, rui, tPort, tAdmin } = e;
  const registrar = (fd: FormData) => act.registrarEncomenda(fd);
  const base = { apartamentoId: String(aptoA.id), destinatarioMoradorId: String(ana.id), tipo: "caixa" };
  tokenAtual = tPort;

  console.log("--- aviso e retirada");
  const aviso = await act.marcarAvisoWhatsApp({ id: r.id });
  ok(aviso.ok && aviso.link.includes("wa.me/5511987654321"), "marcarAvisoWhatsApp devolve o link");
  ok(!!(await prisma.encomenda.findUniqueOrThrow({ where: { id: r.id } })).avisoWhatsAppEm, "marcarAvisoWhatsApp grava avisoWhatsAppEm");
  const avBad = await act.marcarAvisoWhatsApp({ id: "x" as never });
  ok(!avBad.ok && ascii(avBad.erro).includes("Encomenda invalida"), "marcarAvisoWhatsApp: zod recusa id invalido");
  ok(temErro(await act.confirmarRetirada({ codigo: 123 as never }), "código"), "confirmarRetirada: zod recusa codigo que nao e texto");
  ok(temErro(await act.confirmarRetirada({ codigo: r.codigo }), "quem retirou"), "confirmarRetirada: exige quem retirou");
  ok(temErro(await act.confirmarRetirada({ codigo: r.codigo, retiradaPorMoradorId: ana.id, terceiroNome: "Zé Silva" }), "só quem retirou"), "confirmarRetirada: morador E terceiro juntos");
  ok(temErro(await act.confirmarRetirada({ codigo: r.codigo, retiradaPorMoradorId: -5 }), "Morador inválido"), "confirmarRetirada: id de morador invalido");
  ok(temErro(await act.confirmarRetirada({ codigo: "K0M3", terceiroNome: "Zé Silva" }), "nunca usam"), "confirmarRetirada: codigo com 0");
  ok(temErro(await act.confirmarRetirada({ codigo: r.codigo, terceiroNome: "Y".repeat(81) }), "Nome longo"), "confirmarRetirada: nome longo demais");
  const ret = await act.confirmarRetirada({ codigo: r.codigo.toLowerCase(), retiradaPorMoradorId: rui.id });
  ok(ret.ok && ret.retiradaPor === "Rui Prado" && !ret.terceiro && ret.apartamento === "993A", "confirmarRetirada por morador do apto");
  ok(temErro(await act.confirmarRetirada({ codigo: r.codigo, terceiroNome: "Zé Silva" }), "já foi entregue"), "confirmarRetirada de novo: ja entregue");
  const logRet = await prisma.logEvento.findFirst({ where: { tipo: "retirada", usuarioId: e.uPort.id }, orderBy: { id: "desc" } });
  ok(!!logRet && (logRet.detalhe ?? "").includes("Rui Prado") && (logRet.detalhe ?? "").includes(r.codigo), "retirada gravou LogEvento");
  ok(temErro((await act.marcarAvisoWhatsApp({ id: r.id })) as never, "não está mais aguardando"), "aviso de encomenda entregue recusado");

  await fluxoRecusaWhatsApp(e);
  tokenAtual = tPort;

  console.log("--- cancelamento");
  const r2 = await registrar(formulario({ ...base, destinatarioMoradorId: undefined, destinatarioNome: "  Visita  Teste " }));
  if (!r2.ok) throw new Error(`registrar r2 falhou: ${r2.erro}`);
  ok(temErro(await act.cancelarEncomenda({ id: r2.id, motivo: "ab" }), "mínimo 3"), "cancelar: motivo curto (zod)");
  ok(temErro(await act.cancelarEncomenda({ id: "x" as never, motivo: "teste ok" }), "Encomenda inválida"), "cancelar: id invalido (zod)");
  await prisma.encomenda.update({ where: { id: r2.id }, data: { recebidaEm: new Date(Date.now() - 2 * 86_400_000) } });
  ok(temErro(await act.cancelarEncomenda({ id: r2.id, motivo: "registro duplicado" }), "outro turno"), "portaria nao cancela registro de antes do turno");
  tokenAtual = tAdmin;
  const canc = await act.cancelarEncomenda({ id: r2.id, motivo: "registro duplicado" });
  ok(canc.ok && (await prisma.encomenda.findUniqueOrThrow({ where: { id: r2.id } })).status === "cancelada", "admin cancela");
  const logC = await prisma.logEvento.findFirst({ where: { tipo: "cancelamento", usuarioId: e.uAdmin.id }, orderBy: { id: "desc" } });
  ok(!!logC && (logC.detalhe ?? "").includes("registro duplicado"), "cancelamento gravou LogEvento do admin");
  const r3 = await registrar(formulario({ ...base, destinatarioMoradorId: undefined, destinatarioNome: "Visita Admin" }));
  ok(r3.ok && typeof r3.linkWhatsApp === "string", "admin tambem registra (link cai no 1o morador com telefone)");
  tokenAtual = tPort;
  const enc = await tur.encerrarTurno();
  ok(enc.ok && (await tur.turnoAberto()) === null, "encerrarTurno ok");
  ok(temErro(await tur.encerrarTurno(), "Não há turno aberto"), "encerrarTurno sem turno");
  ok(temErro(await registrar(formulario(base)), "Abra o turno"), "depois de encerrar o turno, registrar pede turno");
  await renderizacao(r.codigo);
  const cancelada = await prisma.encomenda.findUniqueOrThrow({ where: { id: r2.id } });
  await paginaEtiqueta(
    { aguardando: r3.ok ? r3.codigo : "", entregue: r.codigo, cancelada: cancelada.codigo },
    { tPort, tAdmin, tMorA: e.tMorA }
  );
}

/** Renderiza um elemento (server component ja resolvido) para HTML, esperando tudo ficar pronto. */
async function paraHtml(elemento: Parameters<typeof renderToPipeableStream>[0]): Promise<string> {
  const saida = new PassThrough();
  let html = "";
  saida.on("data", (parte) => (html += parte));
  await new Promise<void>((resolver, falhar) => {
    const { pipe } = renderToPipeableStream(elemento, { onAllReady: () => pipe(saida), onError: falhar });
    saida.on("end", () => resolver());
  });
  return html;
}

/**
 * 23/10/2026 (LGPD): o morador pode recusar o aviso por WhatsApp. Cobre o admin (guarda, zod, log sem telefone,
 * criar/editar com o campo) e a portaria (registrar e marcar aviso nunca devolvem link para quem recusou; o
 * fallback so usa quem aceita), mais a renderizacao das telas da portaria com o motivo. Ao final o Ana volta a aceitar
 * (o resto da bateria depende do link dela) e os moradores criados aqui saem.
 */
async function fluxoRecusaWhatsApp(e: Ambiente): Promise<void> {
  const { prisma, act, aptoA, ana, rui, tPort, tAdmin, tMorA } = e;
  const acCad = await import("../src/actions/admin-cadastros");
  const registrar = (fd: FormData) => act.registrarEncomenda(fd);
  const base = { apartamentoId: String(aptoA.id), tipo: "caixa" };
  const MSG_ANA = "Ana Prado pediu para não receber avisos no WhatsApp";
  const logCadastro = () => prisma.logEvento.findFirst({ where: { tipo: "cadastro", usuarioId: e.uAdmin.id }, orderBy: { id: "desc" } });
  const aceita = async (id: number): Promise<boolean> => (await prisma.morador.findUniqueOrThrow({ where: { id } })).avisoWhatsApp;
  console.log("--- recusa de aviso por WhatsApp (LGPD)");

  // guarda de papel: so o admin liga/desliga
  for (const [quem, token] of [["portaria", tPort], ["morador", tMorA], ["sem sessao", ""]] as const) {
    tokenAtual = token;
    const r = await acCad.definirAvisoWhatsApp({ id: ana.id, avisar: false });
    ok(!r.ok && (quem === "sem sessao" ? temErro(r, "Sessão expirada") : temErro(r, "Só o administrador")), `${quem}: definirAvisoWhatsApp barrado`, JSON.stringify(r));
  }
  ok((await aceita(ana.id)) === true, "tentativas negadas nao gravaram nada");

  tokenAtual = tAdmin;
  ok(temErro(await acCad.definirAvisoWhatsApp({ id: "x" as never, avisar: false }), "Registro inválido"), "definirAvisoWhatsApp: zod recusa id invalido");
  ok(temErro(await acCad.definirAvisoWhatsApp({ id: ana.id, avisar: "nao" as never }), "aceita aviso"), "definirAvisoWhatsApp: zod recusa 'avisar' que nao e boolean");
  ok(temErro(await acCad.definirAvisoWhatsApp({ id: 99999999, avisar: false }), "Morador não encontrado"), "definirAvisoWhatsApp: morador inexistente");
  revalidados.length = 0;
  const off = await acCad.definirAvisoWhatsApp({ id: ana.id, avisar: false });
  ok(off.ok === true && (await aceita(ana.id)) === false, "admin desliga o aviso da Ana: grava avisoWhatsApp=false");
  const logOff = await logCadastro();
  const detalheOff = logOff?.detalhe ?? "";
  ok(
    logOff?.rota === "/admin/moradores" && detalheOff.includes("aviso WhatsApp desligado") && detalheOff.includes("Ana Prado") && !/98765|4321/.test(detalheOff),
    "LogEvento tipo cadastro: 'aviso WhatsApp desligado' e NENHUM telefone",
    detalheOff
  );
  ok(revalidados.includes("/admin/moradores") && revalidados.includes("/portaria"), "revalida /admin/moradores e a portaria (chips e links)");
  const dup = await acCad.definirAvisoWhatsApp({ id: ana.id, avisar: false });
  ok(
    dup.ok === true && /já estava desligado/.test(dup.aviso ?? "") && (await logCadastro())?.id === logOff?.id,
    "desligar o que ja esta desligado: ok com aviso, sem novo log",
    JSON.stringify(dup)
  );

  // portaria: destinatario que recusou nao recebe link, nem pelo registrar nem por marcarAvisoWhatsApp
  tokenAtual = tPort;
  const rAna = await registrar(formulario({ ...base, destinatarioMoradorId: String(ana.id) }));
  if (!rAna.ok) throw new Error(`registrar para a Ana (recusou) falhou: ${rAna.erro}`);
  ok(rAna.linkWhatsApp === null && rAna.motivoSemWhatsApp === MSG_ANA, "registrarEncomenda: destinatario que recusou -> linkWhatsApp null + motivoSemWhatsApp", JSON.stringify([rAna.linkWhatsApp, rAna.motivoSemWhatsApp]));
  const avAna = await act.marcarAvisoWhatsApp({ id: rAna.id });
  ok(!avAna.ok && avAna.link === null && avAna.erro === MSG_ANA, "marcarAvisoWhatsApp: devolve { ok:false, link:null, erro } e nunca o link", JSON.stringify(avAna));
  ok((await prisma.encomenda.findUniqueOrThrow({ where: { id: rAna.id } })).avisoWhatsAppEm === null, "marcarAvisoWhatsApp recusado nao grava avisoWhatsAppEm");
  // fallback: a Ana e a unica com telefone no apto e recusou -> o Rui (sem telefone) e "outro nome" tambem ficam sem link
  const rRui = await registrar(formulario({ ...base, destinatarioMoradorId: String(rui.id) }));
  const rVisita = await registrar(formulario({ ...base, destinatarioNome: "Visita Recusa" }));
  for (const [quem, r] of [["destinatario sem telefone", rRui], ["'outro nome'", rVisita]] as const) {
    ok(
      r.ok && r.linkWhatsApp === null && (r.motivoSemWhatsApp ?? "").includes("Ana Prado, único morador do 993A com telefone cadastrado, pediu para não receber avisos no WhatsApp"),
      `registrarEncomenda (${quem}): fallback nao usa o telefone de quem recusou`,
      JSON.stringify(r.ok ? [r.linkWhatsApp, r.motivoSemWhatsApp] : r.erro)
    );
  }
  const avRui = await act.marcarAvisoWhatsApp({ id: rRui.ok ? rRui.id : 0 });
  ok(!avRui.ok && avRui.link === null, "marcarAvisoWhatsApp (fallback so com quem recusou): sem link");

  // telas da portaria com o motivo (SSR)
  const { default: PaginaDetalhe } = await import("../src/app/portaria/encomenda/[id]/page");
  const html = await paraHtml(await PaginaDetalhe({ params: Promise.resolve({ id: String(rAna.id) }) }));
  ok(
    html.includes(MSG_ANA) && /<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*?Avisar no WhatsApp/.test(html) && !html.includes("wa.me") && html.includes("Sem aviso no WhatsApp"),
    "detalhe da encomenda: botao do WhatsApp desabilitado, motivo na tela e na linha do tempo, nenhum link wa.me"
  );
  const { CodigoGerado } = await import("../src/app/portaria/registrar/codigo-gerado");
  const gerado = renderToStaticMarkup(createElement(CodigoGerado, { registrada: { ...rAna, registradaEm: new Date().toISOString() }, onRegistrarOutra: () => undefined }));
  ok(
    gerado.includes(MSG_ANA) && /<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*?Avisar no WhatsApp/.test(gerado) && !gerado.includes("wa.me"),
    "tela 'codigo gerado': botao desabilitado e o motivo da recusa"
  );
  const semMotivo = renderToStaticMarkup(createElement(CodigoGerado, { registrada: { ...rAna, motivoSemWhatsApp: undefined, registradaEm: new Date().toISOString() }, onRegistrarOutra: () => undefined }));
  ok(semMotivo.includes("Nenhum morador do 993A tem telefone cadastrado"), "tela 'codigo gerado' sem motivo do servidor: texto antigo de 'sem telefone'");

  // admin liga de novo: o link volta
  tokenAtual = tAdmin;
  const on = await acCad.definirAvisoWhatsApp({ id: ana.id, avisar: true });
  ok(on.ok === true && (await aceita(ana.id)) === true, "admin liga o aviso da Ana de novo");
  ok(((await logCadastro())?.detalhe ?? "").includes("aviso WhatsApp ligado"), "LogEvento: 'aviso WhatsApp ligado'");
  tokenAtual = tPort;
  const rOk = await registrar(formulario({ ...base, destinatarioMoradorId: String(ana.id) }));
  ok(
    rOk.ok && typeof rOk.linkWhatsApp === "string" && rOk.linkWhatsApp.startsWith("https://wa.me/5511987654321?text=") && !("motivoSemWhatsApp" in rOk),
    "Ana aceitando: registrarEncomenda volta a devolver o link (sem motivoSemWhatsApp)"
  );
  const avOk = await act.marcarAvisoWhatsApp({ id: rOk.ok ? rOk.id : 0 });
  ok(avOk.ok && avOk.link.includes("wa.me/5511987654321"), "Ana aceitando: marcarAvisoWhatsApp devolve o link");

  // criar/editar morador com o campo
  tokenAtual = tAdmin;
  ok(temErro(await acCad.criarMorador({ apartamentoId: aptoA.id, nome: "Zeca Recusa", avisoWhatsApp: "sim" as never }), "aceita aviso"), "criarMorador: zod recusa avisoWhatsApp que nao e boolean");
  const cria = await acCad.criarMorador({ apartamentoId: aptoA.id, nome: "Zeca Recusa", telefone: "(11) 95555-4444", avisoWhatsApp: false });
  const zeca = await prisma.morador.findFirst({ where: { apartamentoId: aptoA.id, nome: "Zeca Recusa" } });
  ok(cria.ok === true && zeca?.avisoWhatsApp === false && zeca.telefone === "11955554444", "criarMorador com avisoWhatsApp=false");
  const detalheCria = (await logCadastro())?.detalhe ?? "";
  ok(detalheCria.includes("aviso WhatsApp desligado") && !detalheCria.includes("95555"), "log de criacao cita o aviso desligado e nao o telefone", detalheCria);
  const padrao = await acCad.criarMorador({ apartamentoId: aptoA.id, nome: "Zuleica Padrao" });
  const zuleica = await prisma.morador.findFirst({ where: { apartamentoId: aptoA.id, nome: "Zuleica Padrao" } });
  ok(padrao.ok === true && zuleica?.avisoWhatsApp === true, "criarMorador sem o campo: aceita WhatsApp (padrao)");
  const edSem = await acCad.editarMorador({ id: zeca!.id, apartamentoId: aptoA.id, nome: "Zeca Recusa", telefone: "(11) 95555-4444" });
  ok(edSem.ok === true && edSem.aviso === "Nada mudou" && (await aceita(zeca!.id)) === false, "editarMorador sem o campo mantem a escolha");
  const edLiga = await acCad.editarMorador({ id: zeca!.id, apartamentoId: aptoA.id, nome: "Zeca Recusa", telefone: "(11) 95555-4444", avisoWhatsApp: true });
  const detalheEd = (await logCadastro())?.detalhe ?? "";
  ok(edLiga.ok === true && (await aceita(zeca!.id)) === true && detalheEd.includes("aviso WhatsApp ligado") && !detalheEd.includes("95555"), "editarMorador liga o aviso e loga sem telefone", detalheEd);
  const edDesliga = await acCad.editarMorador({ id: zeca!.id, apartamentoId: aptoA.id, nome: "Zeca Recusa", telefone: "(11) 95555-4444", avisoWhatsApp: false });
  ok(edDesliga.ok === true && (await aceita(zeca!.id)) === false && ((await logCadastro())?.detalhe ?? "").includes("aviso WhatsApp desligado"), "editarMorador desliga o aviso");
  await prisma.morador.deleteMany({ where: { id: { in: [zeca!.id, zuleica!.id] } } });
}

async function renderizacao(codigo: string): Promise<void> {
  console.log("--- renderizacao SSR dos componentes");
  const lib = await import("../src/lib/encomendas");
  const { CardEncomenda } = await import("../src/components/encomenda/card-encomenda");
  const { StampStatus } = await import("../src/components/encomenda/stamp-status");
  const { CodigoEncomenda } = await import("../src/components/encomenda/codigo-encomenda");
  const { QrCodigo } = await import("../src/components/encomenda/qr-codigo");
  const { FotoEncomenda } = await import("../src/components/encomenda/foto-encomenda");
  const { FotoCaptura } = await import("../src/components/encomenda/foto-captura-client");
  const { SeletorMoradores } = await import("../src/components/encomenda/seletor-moradores");
  const { ChipsTipo } = await import("../src/components/encomenda/chips-tipo");
  const { ChipsTransportadora } = await import("../src/components/encomenda/chips-transportadora");
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  const resumo = await lib.buscarPorCodigo(codigo);
  if (!resumo) throw new Error("encomenda do teste sumiu");
  const card = html(createElement(CardEncomenda, { encomenda: resumo, href: "/portaria/historico/993A" }));
  ok(card.includes(resumo.codigo) && card.includes("993A") && card.includes("Ana Prado") && card.includes("Caixa · Amazon"), "CardEncomenda: codigo, apto, destinatario, tipo e transportadora");
  ok(card.includes("Entregue") && card.includes("Retirou Rui Prado") && card.includes(`href="/portaria/historico/993A"`), "CardEncomenda: carimbo Entregue, quem retirou e link do card");
  const cardParada = html(createElement(CardEncomenda, { encomenda: { ...resumo, status: "aguardando", parada: true, diasParada: 4, entregueEm: null, retiradaPor: null, fotoId: 12 } }));
  ok(cardParada.includes("border-warn") && cardParada.includes("4 dias") && cardParada.includes(`src="/fotos/12"`), "CardEncomenda parada: borda warn, carimbo 4 dias, foto /fotos/12");
  const stamps = [
    html(createElement(StampStatus, { status: "aguardando", diasParada: 1 })),
    html(createElement(StampStatus, { status: "aguardando", diasParada: 3 })),
    html(createElement(StampStatus, { status: "entregue" })),
    html(createElement(StampStatus, { status: "cancelada" })),
  ];
  ok(stamps[0].includes("Aguardando") && stamps[1].includes("3 dias") && stamps[1].includes("text-warn") && stamps[2].includes("Entregue") && stamps[3].includes("Cancelada"), "StampStatus: 4 estados");
  const cod = html(createElement(CodigoEncomenda, { codigo: "K7M3", size: "xl", className: "text-ink" }));
  ok(cod.includes("text-[72px]") && cod.includes("text-ink") && !cod.includes("text-kraft-ink") && cod.includes("K 7 M 3"), "CodigoEncomenda: tamanho xl, override de cor, leitor de tela");
  const qr = await QrCodigo({ codigo: "K7M3", size: 100 });
  const qrHtml = html(qr as never);
  ok(qrHtml.includes("<svg") && qrHtml.includes(`width="100"`) && qrHtml.includes("K7M3"), "QrCodigo: SVG com o tamanho pedido");
  ok((await QrCodigo({ codigo: "K0M3" })) === null, "QrCodigo: codigo invalido nao renderiza");
  ok(!html(createElement(FotoEncomenda, { fotoId: null, alt: "sem foto" })).includes("<img") && html(createElement(FotoEncomenda, { fotoId: 7, alt: "x", size: 96 })).includes(`src="/fotos/7"`), "FotoEncomenda: placeholder sem foto, <img> com foto");
  const cap = html(createElement(FotoCaptura, { value: [], onChange: () => undefined }));
  ok(cap.includes("Tirar foto da etiqueta") && cap.includes(`capture="environment"`) && cap.includes(`accept="image/*"`) && cap.includes("até 3 fotos"), "FotoCaptura: botao, input com capture e legenda");
  const sel = html(createElement(SeletorMoradores, { moradores: [{ id: 1, nome: "Ana" }, { id: 2, nome: "Rui" }], valor: { nome: "" }, onChange: () => undefined }));
  ok(sel.includes("Ana") && sel.includes("Outro nome") && sel.includes("<input"), "SeletorMoradores: chips e campo de nome no modo Outro");
  ok(!sel.includes("não recebe WhatsApp"), "SeletorMoradores: sem marcador quando ninguem recusou");
  const selRecusa = html(createElement(SeletorMoradores, { moradores: [{ id: 1, nome: "Ana", avisoWhatsApp: false }, { id: 2, nome: "Rui", avisoWhatsApp: true }], valor: { moradorId: 2 }, onChange: () => undefined }));
  ok((selRecusa.match(/title="não recebe WhatsApp"/g) ?? []).length === 1 && selRecusa.includes("(não recebe WhatsApp)"), "SeletorMoradores: so o chip de quem recusou leva o marcador (title + texto para leitor de tela)");
  ok(!selRecusa.includes("pediu para não receber"), "SeletorMoradores: com outro morador escolhido nao ha nota de recusa");
  const selEscolhida = html(createElement(SeletorMoradores, { moradores: [{ id: 1, nome: "Ana", avisoWhatsApp: false }], valor: { moradorId: 1 }, onChange: () => undefined }));
  ok(selEscolhida.includes("Ana pediu para não receber avisos no WhatsApp"), "SeletorMoradores: recusa escolhida mostra a nota 'esta encomenda nao gera o link'");
  ok(!html(createElement(SeletorMoradores, { moradores: [{ id: 1, nome: "Ana" }], valor: { moradorId: 1 }, onChange: () => undefined })).includes("<input"), "SeletorMoradores: sem campo quando um morador esta escolhido");
  ok(html(createElement(ChipsTipo, { valor: "perecivel", onChange: () => undefined })).includes("Perecível"), "ChipsTipo: rotulos");
  const ct = html(createElement(ChipsTransportadora, { valor: "Mercado Livre", onChange: () => undefined }));
  ok(ct.includes("Mercado Livre") && ct.includes("Outro") && !ct.includes("<input"), "ChipsTransportadora: sugeridas e Outro, sem campo");
  ok(html(createElement(ChipsTransportadora, { valor: "Loggi", onChange: () => undefined })).includes("<input"), "ChipsTransportadora: valor fora da lista abre o campo");
}

async function renderizarPagina(codigoRota: string, token: string): Promise<{ html: string } | { erro: string }> {
  tokenAtual = token;
  const { default: Pagina } = await import("../src/app/etiqueta/[codigo]/page");
  try {
    const elemento = await Pagina({ params: Promise.resolve({ codigo: codigoRota }) });
    const saida = new PassThrough();
    let html = "";
    saida.on("data", (parte) => (html += parte));
    await new Promise<void>((resolver, falhar) => {
      const { pipe } = renderToPipeableStream(elemento, { onAllReady: () => pipe(saida), onError: falhar });
      saida.on("end", () => resolver());
    });
    return { html };
  } catch (err) {
    return { erro: err instanceof Error ? err.message : String(err) };
  }
}

async function paginaEtiqueta(
  codigos: { aguardando: string; entregue: string; cancelada: string },
  tokens: { tPort: string; tAdmin: string; tMorA: string }
): Promise<void> {
  console.log("--- pagina /etiqueta/[codigo]");
  const ag = await renderizarPagina(codigos.aguardando, tokens.tPort);
  const html = "html" in ag ? ag.html : "";
  ok(html.includes(codigos.aguardando) && html.includes("993A") && html.includes("Visita Admin"), "etiqueta: codigo, apto e destinatario");
  ok(html.includes("<svg") && html.includes("Imprimir") && html.includes("Voltar"), "etiqueta: QR em SVG e botoes Imprimir/Voltar");
  ok(html.includes("@page") && html.includes("148mm") && html.includes("@media print"), "etiqueta: CSS A6 paisagem e regras de impressao");
  ok(!html.includes("Atenção:"), "etiqueta de encomenda aguardando nao traz aviso");
  ok((await renderizarPagina(codigos.aguardando.toLowerCase(), tokens.tAdmin)).hasOwnProperty("html"), "etiqueta: admin tambem imprime (codigo em minuscula normalizado)");
  const ent = await renderizarPagina(codigos.entregue, tokens.tPort);
  ok("html" in ent && ent.html.includes("ENTREGUE"), "etiqueta de entregue avisa para nao colar");
  const can = await renderizarPagina(codigos.cancelada, tokens.tPort);
  ok("html" in can && can.html.includes("CANCELADA"), "etiqueta de cancelada avisa para nao colar");
  const mor = await renderizarPagina(codigos.aguardando, tokens.tMorA);
  ok("erro" in mor && mor.erro.includes("404"), "etiqueta: morador recebe 404");
  const ruim = await renderizarPagina("K0M3", tokens.tPort);
  const inex = await renderizarPagina("ZZZZ", tokens.tPort);
  ok("erro" in ruim && "erro" in inex, "etiqueta: codigo invalido ou inexistente = 404");
}

main()
  .catch((err) => {
    falhas++;
    console.log(`FAIL excecao nao tratada -> ${ascii(err instanceof Error ? (err.stack ?? err.message) : String(err))}`);
  })
  .finally(() => {
    console.log(`\n${total - falhas}/${total} verificacoes passaram${falhas ? ` - ${falhas} FALHA(S)` : " - TUDO PASS"}`);
    process.exit(falhas > 0 ? 1 : 0);
  });
