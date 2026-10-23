/**
 * FRONTEIRAS DE PAPEL por HTTP, com cookie real (23/10/2026) - auto-reversivel.
 *
 * O que faz: entra pelo formulario de login (Playwright) com cada conta de teste e usa o
 * cookie `enc_sessao` REAL do navegador em requisicoes HTTP cruas (node:http, sem normalizar
 * o caminho) contra o servidor ligado. Monta a matriz  rota x ator  e compara cada celula
 * com o esperado calculado a partir de src/lib/papeis.ts (rotaPermitida / rotaPublica /
 * ROTA_INICIAL):
 *   - rota fora da allowlist do papel -> 404 em TEXTO SIMPLES gerado pelo middleware
 *     ("Nao encontrado"; nunca 403/500; nenhuma pagina chega a rodar);
 *   - sem sessao -> redireciona para /login (exceto as rotas publicas);
 *   - rota permitida com recurso real -> 200; recurso inexistente -> 404 da propria pagina.
 * Cobre ainda: normalizacao de caminho (/ADMIN, /admin%2F, /app/../admin, /sw.jsx, barra
 * final, ponto final, /icons/../admin...), carimbo x-rota-verificada forjado, token adulterado,
 * metodo POST, cabecalhos de seguranca e flags do cookie. E as SERVER ACTIONS chamadas por HTTP
 * cru (POST + cabecalho Next-Action, ids lidos de .next/server/server-reference-manifest.json,
 * entao so roda na pasta do build): chamadas hostis de anon/morador/portaria nunca alteram o banco
 * (impressao SHA-1 das tabelas antes/depois), com controles que provam que o formato de chamada
 * e valido (admin cria porteiro; portaria consulta/avisa/retira) e um teste de Origin forjado.
 *
 * Atores: anon (sem cookie) | portaria-teste | morador-teste (apto 11A) |
 *         zz-morador-21a (criado e removido aqui, apto 21A) | admin-teste.
 *
 * Como rodar (servidor de TESTE com banco COPIADO; nunca o de producao):
 *   npx tsx scripts/cria-usuarios-teste.ts <senha>          # admin-teste, portaria-teste, morador-teste
 *   DATABASE_URL=file:<abs>/prisma/dev.db TESTE_BASE=http://localhost:3090 SENHA_TESTE=<senha> \
 *     npx tsx scripts/teste-fronteiras.ts
 *   (servidor e script PRECISAM apontar para o MESMO banco e rodar da MESMA pasta do build; o
 *    script semeia 1 encomenda do 11A com 1 foto, abre um turno se nao houver e apaga tudo ao
 *    final: encomenda, arquivo da foto, conta zz-morador-21a, porteiros ZZFRONT-*, o turno e os
 *    eventos do livro gerados pelas contas de teste durante a execucao.)
 *   SAIDA_JSON=<arquivo> grava a matriz em JSON. Saida em ASCII; exit 1 se houver desvio.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { gerarCodigo } from "../src/lib/encomendas";
import { caminhoFoto, salvarFoto } from "../src/lib/fotos";
import { ROTA_INICIAL, rotaPermitida, type PapelUsuario } from "../src/lib/papeis";
import { gerarHashSenha } from "../src/lib/senha";
import { COOKIE_SESSAO } from "../src/lib/sessao-token";
import { abrirNavegador } from "./_navegador";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const SENHA = process.env.SENHA_TESTE ?? "";
const MARCA = "[TESTE-FRONTEIRAS]";
const LOGIN_21A = "zz-morador-21a";

/* ------------------------------------------------------------------ atores */

type Ator = "anon" | "portaria" | "morador" | "morador21A" | "admin";
const ATORES: Ator[] = ["anon", "portaria", "morador", "morador21A", "admin"];
const LOGIN_DO_ATOR: Record<Exclude<Ator, "anon">, string> = {
  portaria: "portaria-teste",
  morador: "morador-teste",
  morador21A: LOGIN_21A,
  admin: "admin-teste",
};
const PAPEL_DO_ATOR: Record<Exclude<Ator, "anon">, PapelUsuario> = {
  portaria: "portaria",
  morador: "morador",
  morador21A: "morador",
  admin: "admin",
};
const CABECALHO_COLUNA: Record<Ator, string> = {
  anon: "sem-cookie",
  portaria: "portaria",
  morador: "morador11A",
  morador21A: "morador21A",
  admin: "admin",
};

/* -------------------------------------------------------------- HTTP cru */

type Resp = { status: number; headers: http.IncomingHttpHeaders; texto: string; bytes: number };

/** GET/POST com o caminho EXATAMENTE como escrito (sem normalizar `..`, `%2F`, etc.). */
function requisitar(
  caminho: string,
  opcoes: { cookie?: string; headers?: Record<string, string>; metodo?: string; corpo?: string } = {}
): Promise<Resp> {
  const u = new URL(BASE);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(opcoes.headers ?? {}) };
    if (opcoes.cookie !== undefined) headers.cookie = `${COOKIE_SESSAO}=${opcoes.cookie}`;
    if (opcoes.metodo === "POST") {
      headers["content-type"] ??= "text/plain";
      headers["content-length"] ??= String(Buffer.byteLength(opcoes.corpo ?? ""));
    }
    const r = http.request(
      { host: u.hostname, port: Number(u.port || 80), path: caminho, method: opcoes.metodo ?? "GET", headers },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("end", () => {
          const corpo = Buffer.concat(partes);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            texto: corpo.subarray(0, 200_000).toString("utf8"),
            bytes: corpo.length,
          });
        });
      }
    );
    r.on("error", reject);
    r.setTimeout(30_000, () => r.destroy(new Error(`timeout em ${caminho}`)));
    r.end(opcoes.corpo);
  });
}

const tipoDe = (r: Resp) => String(r.headers["content-type"] ?? "");
const destinoDe = (r: Resp): string => {
  const loc = r.headers.location;
  if (!loc) return "";
  try {
    return new URL(loc, BASE).pathname;
  } catch {
    return loc;
  }
};
const ehRedirect = (r: Resp) => [301, 302, 303, 307, 308].includes(r.status);

/* ----------------------------------------------------- expectativas e celula */

/** 200 | 404t (404 em texto simples "Nao encontrado") | 404 (qualquer 404) | redir (30x; `para` = pathname do Location) */
type Alt = { s: "200" | "404t" | "404" | "redir"; para?: string };
type Esperado = Alt[];

function confere(r: Resp, a: Alt): boolean {
  if ([403, 500, 502, 503].includes(r.status)) return false; // regra do contrato: nunca 403/5xx
  switch (a.s) {
    case "200":
      return r.status === 200;
    case "404":
      return r.status === 404;
    case "404t":
      return r.status === 404 && /^text\/plain/.test(tipoDe(r)) && r.texto === "Não encontrado";
    case "redir":
      return ehRedirect(r) && (a.para === undefined || destinoDe(r) === a.para);
  }
}
const atende = (r: Resp, e: Esperado) => e.some((a) => confere(r, a));

function celula(r: Resp): string {
  if (ehRedirect(r)) return `>${destinoDe(r) || "?"}`;
  if (r.status === 404) return /^text\/plain/.test(tipoDe(r)) ? "404t" : "404h";
  return String(r.status);
}
function descAlt(a: Alt): string {
  return a.s === "redir" ? `redir${a.para ? ">" + a.para : ""}` : a.s;
}

const ANON_LOGIN: Esperado = [{ s: "redir", para: "/login" }];

/** Rota protegida normal: anon -> login; papel fora da allowlist -> 404t; senao 200 (ou 404 se o recurso nao existe). */
function protegida(ator: Ator, caminhoLogico: string, recurso: "existe" | "inexistente" = "existe"): Esperado {
  if (ator === "anon") return ANON_LOGIN;
  if (!rotaPermitida(PAPEL_DO_ATOR[ator], caminhoLogico)) return [{ s: "404t" }];
  return recurso === "existe" ? [{ s: "200" }] : [{ s: "404" }];
}

/** `seguir`: o Next normaliza (barra dupla/final) com 308 ANTES do middleware; o esperado vale para o destino final dessa(s) normalizacao(oes). */
type Linha = { grupo: string; rotulo: string; caminho: string; esperado: (a: Ator) => Esperado; seguir?: boolean };

/* ------------------------------------------------------------------- dados */

type Semente = { encId: number; codigo: string; fotoId: number; porteiroCriadoId: number | null; arquivo: string };

async function semear(): Promise<Semente> {
  await limparSementes();
  const apto = await prisma.apartamento.findUnique({ where: { numero: "11A" }, select: { id: true } });
  if (!apto) throw new Error("apto 11A nao existe no banco de teste");
  const mor = await prisma.morador.findFirst({ where: { apartamentoId: apto.id, ativo: true }, select: { id: true, nome: true } });
  let porteiro = await prisma.porteiro.findFirst({ where: { ativo: true }, select: { id: true } });
  let porteiroCriadoId: number | null = null;
  if (!porteiro) {
    porteiro = await prisma.porteiro.create({ data: { nome: "ZZFRONT", ativo: false }, select: { id: true } });
    porteiroCriadoId = porteiro.id;
  }
  const codigo = await gerarCodigo();
  const e = await prisma.encomenda.create({
    data: {
      codigo,
      apartamentoId: apto.id,
      destinatarioMoradorId: mor?.id ?? null,
      destinatarioNome: mor?.nome ?? "Teste Fronteiras",
      tipo: "caixa",
      transportadora: "Correios",
      observacao: MARCA,
      recebidaPorPorteiroId: porteiro.id,
    },
    select: { id: true },
  });
  const bytes = fs.readFileSync(path.join(process.cwd(), "public", "icons", "icon-192.png"));
  const foto = await salvarFoto(new File([new Uint8Array(bytes)], "etiqueta.png", { type: "image/png" }), e.id, 1);
  const reg = await prisma.fotoEncomenda.findUnique({ where: { id: foto.id }, select: { arquivo: true } });
  return { encId: e.id, codigo, fotoId: foto.id, porteiroCriadoId, arquivo: reg?.arquivo ?? "" };
}

async function limparSementes(): Promise<void> {
  const encs = await prisma.encomenda.findMany({ where: { observacao: MARCA }, select: { id: true } });
  const ids = encs.map((e) => e.id);
  const fotos = await prisma.fotoEncomenda.findMany({ where: { encomendaId: { in: ids } } });
  for (const f of fotos) await unlink(caminhoFoto(f)).catch(() => undefined);
  await prisma.fotoEncomenda.deleteMany({ where: { encomendaId: { in: ids } } });
  await prisma.encomenda.deleteMany({ where: { id: { in: ids } } });
  await prisma.porteiro.deleteMany({ where: { nome: "ZZFRONT", ativo: false, recebidas: { none: {} }, turnos: { none: {} } } });
}

async function remover21A(): Promise<void> {
  const u = await prisma.usuario.findUnique({ where: { login: LOGIN_21A }, select: { id: true } });
  if (!u) return;
  await prisma.logEvento.deleteMany({ where: { usuarioId: u.id } });
  await prisma.pushInscricao.deleteMany({ where: { usuarioId: u.id } });
  await prisma.usuario.delete({ where: { id: u.id } });
}

async function criar21A(): Promise<void> {
  await remover21A();
  const apto = await prisma.apartamento.findUnique({ where: { numero: "21A" }, select: { id: true } });
  if (!apto) throw new Error("apto 21A nao existe no banco de teste");
  const { hash, salt } = gerarHashSenha(SENHA);
  await prisma.usuario.create({
    data: { login: LOGIN_21A, nome: "Apto 21A (teste fronteiras)", papel: "morador", apartamentoId: apto.id, senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: false, ativo: true },
  });
}

/* ------------------------------------------------------------------- login */

type CookieInfo = { valor: string; httpOnly: boolean; sameSite: string; path: string; secure: boolean; expiraDias: number };

async function logarTodos(): Promise<Record<Exclude<Ator, "anon">, CookieInfo>> {
  const browser = await abrirNavegador();
  const out = {} as Record<Exclude<Ator, "anon">, CookieInfo>;
  try {
    for (const ator of Object.keys(LOGIN_DO_ATOR) as Exclude<Ator, "anon">[]) {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      await page.fill("#login", LOGIN_DO_ATOR[ator]);
      await page.fill("#senha", SENHA);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }), page.click("button[type=submit]")]);
      const c = (await ctx.cookies()).find((k) => k.name === COOKIE_SESSAO);
      if (!c) throw new Error(`login de ${LOGIN_DO_ATOR[ator]} nao deixou o cookie ${COOKIE_SESSAO}`);
      out[ator] = {
        valor: c.value,
        httpOnly: c.httpOnly,
        sameSite: String(c.sameSite),
        path: c.path,
        secure: c.secure,
        expiraDias: Math.round((c.expires * 1000 - Date.now()) / 86_400_000),
      };
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

/* ------------------------------------------------- Server Actions por HTTP */

type AcaoDef = { nome: string; pagina: string; args: unknown[] };

/** Impressao digital das tabelas que as actions alteram: qualquer efeito de uma chamada hostil muda o hash. */
async function impressaoDoBanco(): Promise<string> {
  const [usu, port, mor, enc, tur] = await Promise.all([
    prisma.usuario.findMany({ orderBy: { id: "asc" } }),
    prisma.porteiro.findMany({ orderBy: { id: "asc" } }),
    prisma.morador.findMany({ orderBy: { id: "asc" } }),
    prisma.encomenda.findMany({ orderBy: { id: "asc" } }),
    prisma.turno.findMany({ orderBy: { id: "asc" } }),
  ]);
  return createHash("sha1").update(JSON.stringify([usu, port, mor, enc, tur])).digest("hex");
}

/**
 * Chama as Server Actions como o navegador chama (POST + cabecalho Next-Action + corpo JSON dos
 * argumentos), com o cookie real de cada papel, e prova que quem nao pode nao consegue: nenhuma
 * chamada hostil altera o banco. Antes disso confirma que o PROPRIO formato de chamada funciona
 * (controles: admin cria porteiro; portaria marca aviso e retira) - senao "nao fez nada" nao provaria nada.
 */
async function acoesPorHttp(sem: Semente, cookieDe: (a: Ator) => string | undefined): Promise<void> {
  console.log("\n=== Server Actions chamadas por HTTP cru (cookie real + Next-Action) ===");
  const manifestoPath = path.join(process.cwd(), ".next", "server", "server-reference-manifest.json");
  if (!fs.existsSync(manifestoPath)) {
    console.log("PULADO: .next/server/server-reference-manifest.json nao existe (so vale para build de producao rodando desta pasta)");
    return;
  }
  const manifesto = JSON.parse(fs.readFileSync(manifestoPath, "utf8")).node as Record<string, { exportedName: string }>;
  const idDe = (nome: string): string => {
    const e = Object.entries(manifesto).find(([, v]) => v.exportedName === nome);
    if (!e) throw new Error(`acao ${nome} nao esta no manifesto`);
    return e[0];
  };

  const uMor = await prisma.usuario.findUnique({ where: { login: "morador-teste" }, select: { id: true } });
  const u21 = await prisma.usuario.findUnique({ where: { login: LOGIN_21A }, select: { id: true } });
  const apto11 = await prisma.apartamento.findUnique({ where: { numero: "11A" }, select: { id: true } });
  const mor11 = apto11 ? await prisma.morador.findFirst({ where: { apartamentoId: apto11.id }, select: { id: true } }) : null;
  const porteiro = await prisma.porteiro.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
  if (!uMor || !u21 || !apto11 || !mor11 || !porteiro) throw new Error("dados de base ausentes para o teste de actions");

  // com um turno aberto, as actions da portaria so negariam por falta de turno se a guarda de papel nao existisse
  let turnoCriadoId: number | null = null;
  if (!(await prisma.turno.findFirst({ where: { fim: null } }))) {
    turnoCriadoId = (await prisma.turno.create({ data: { porteiroId: porteiro.id } })).id;
  }

  try {
    const enc = await prisma.encomenda.findUnique({ where: { id: sem.encId }, select: { destinatarioNome: true } });
    const defsAdmin: AcaoDef[] = [
      { nome: "criarUsuario", pagina: "/admin/usuarios", args: [{ login: "zz-intruso", nome: "Intruso", papel: "admin", apartamentoId: null }] },
      { nome: "editarUsuario", pagina: "/admin/usuarios", args: [{ id: uMor.id, nome: "Morador Teste", papel: "admin", apartamentoId: null }] },
      { nome: "redefinirSenha", pagina: "/admin/usuarios", args: [{ id: uMor.id }] },
      { nome: "desativarUsuario", pagina: "/admin/usuarios", args: [{ id: uMor.id }] },
      { nome: "excluirUsuario", pagina: "/admin/usuarios", args: [{ id: u21.id }] },
      { nome: "gerarLoginsFaltantes", pagina: "/admin/usuarios", args: [] },
      { nome: "criarMorador", pagina: "/admin/moradores", args: [{ apartamentoId: apto11.id, nome: "Intruso", telefone: null }] },
      { nome: "desativarMorador", pagina: "/admin/moradores", args: [{ id: mor11.id }] },
      { nome: "definirAvisoWhatsApp", pagina: "/admin/moradores", args: [{ id: mor11.id, avisar: false }] },
      { nome: "criarPorteiro", pagina: "/admin/porteiros", args: [{ nome: "ZZFRONT-INTRUSO" }] },
      { nome: "renomearPorteiro", pagina: "/admin/porteiros", args: [{ id: porteiro.id, nome: "HACK" }] },
      { nome: "desativarPorteiro", pagina: "/admin/porteiros", args: [{ id: porteiro.id }] },
    ];
    const defsPortaria: AcaoDef[] = [
      { nome: "iniciarTurno", pagina: "/portaria", args: [{ porteiroId: porteiro.id }] },
      { nome: "encerrarTurno", pagina: "/portaria", args: [] },
      { nome: "confirmarRetirada", pagina: "/portaria/retirada", args: [{ codigo: sem.codigo, terceiroNome: "Intruso" }] },
      { nome: "buscarEncomendaParaRetirada", pagina: "/portaria/retirada", args: [sem.codigo] },
      { nome: "cancelarEncomenda", pagina: `/portaria/encomenda/${sem.encId}`, args: [{ id: sem.encId, motivo: "Intruso" }] },
      { nome: "marcarAvisoWhatsApp", pagina: `/portaria/encomenda/${sem.encId}`, args: [{ id: sem.encId }] },
    ];

    const chamar = (ator: Ator, pagina: string, def: AcaoDef, extra: Record<string, string> = {}) =>
      requisitar(pagina, {
        cookie: cookieDe(ator),
        metodo: "POST",
        corpo: JSON.stringify(def.args),
        headers: { "next-action": idDe(def.nome), accept: "text/x-component", "content-type": "text/plain;charset=UTF-8", origin: BASE, ...extra },
      });
    const classe = (r: Resp): string =>
      ehRedirect(r) ? "redirect-login" : r.status === 404 && /^text\/plain/.test(tipoDe(r)) ? "404t" : r.status === 200 && /json/.test(tipoDe(r)) ? "ignorada-pelo-Next" : r.status === 200 && /x-component/.test(tipoDe(r)) ? "executou" : `outro-${r.status}`;

    // ---- controles: o formato de chamada e valido
    const nPort0 = await prisma.porteiro.count();
    let r = await chamar("admin", "/admin/porteiros", { nome: "criarPorteiro", pagina: "", args: [{ nome: "ZZFRONT-ACAO" }] });
    const criado = await prisma.porteiro.findFirst({ where: { nome: "ZZFRONT-ACAO" } });
    ok(r.status === 200 && (await prisma.porteiro.count()) === nPort0 + 1 && !!criado, "controle: admin cria porteiro por HTTP cru (formato Next-Action valido)", `status ${r.status}`);
    r = await chamar("portaria", "/portaria/retirada", defsPortaria[3]);
    ok(r.status === 200 && r.texto.includes(sem.codigo), "controle: portaria consulta a encomenda pelo codigo por HTTP cru (leitura funciona para quem pode)", `status ${r.status}`);

    // ---- chamadas hostis
    const tally = new Map<string, number>();
    const efeitos: string[] = [];
    const vazamentos: string[] = [];
    let chamadas = 0;
    const paginasDoAtor = (a: Ator, propria: string): string[] => (a === "anon" ? [propria, "/conta/senha"] : a === "portaria" ? [propria, "/portaria", "/conta/senha"] : [propria, "/app", "/conta/senha"]);
    for (const ator of ["anon", "morador", "morador21A", "portaria"] as Ator[]) {
      const defs = ator === "portaria" ? defsAdmin : [...defsAdmin, ...defsPortaria];
      for (const def of defs) {
        const antes = await impressaoDoBanco();
        for (const pag of paginasDoAtor(ator, def.pagina)) {
          const resp = await chamar(ator, pag, def);
          chamadas++;
          const k = `${CABECALHO_COLUNA[ator]}: ${classe(resp)}`;
          tally.set(k, (tally.get(k) ?? 0) + 1);
          if ([403, 500, 502, 503].includes(resp.status)) vazamentos.push(`${def.nome} ${CABECALHO_COLUNA[ator]} ${pag}: status ${resp.status}`);
          if (resp.texto.includes(sem.codigo) || resp.texto.includes(enc?.destinatarioNome ?? "NAO-EXISTE-DESTINATARIO")) vazamentos.push(`${def.nome} ${CABECALHO_COLUNA[ator]} ${pag}: resposta traz dado da encomenda`);
          if (/"ok":true/.test(resp.texto)) vazamentos.push(`${def.nome} ${CABECALHO_COLUNA[ator]} ${pag}: resposta com ok:true`);
        }
        if ((await impressaoDoBanco()) !== antes) efeitos.push(`${def.nome} como ${CABECALHO_COLUNA[ator]}`);
      }
    }
    console.log(`INFO ${chamadas} chamadas hostis. Resultado por tipo de resposta:`);
    for (const [k, v] of [...tally.entries()].sort()) console.log(`INFO   ${k.padEnd(34)} ${v}`);
    ok(efeitos.length === 0, `${chamadas} chamadas hostis (anon/morador/morador21A/portaria x ${defsAdmin.length + defsPortaria.length} actions, na pagina propria e em paginas acessiveis): nenhuma alterou o banco`, efeitos.join("; "));
    ok(vazamentos.length === 0, "nenhuma resposta hostil com 403/5xx, ok:true nem dado da encomenda", vazamentos.slice(0, 4).join("; "));

    // ---- CSRF: Origin de outro site com cookie valido de admin
    const nPort1 = await prisma.porteiro.count();
    r = await chamar("admin", "/admin/porteiros", { nome: "criarPorteiro", pagina: "", args: [{ nome: "ZZFRONT-CSRF" }] }, { origin: "http://evil.example" });
    ok((await prisma.porteiro.count()) === nPort1 && !(await prisma.porteiro.findFirst({ where: { nome: "ZZFRONT-CSRF" } })), "Server Action com Origin de outro site (cookie de admin valido) e barrada pelo Next", `status ${r.status} (o Next responde com erro do proprio framework)`);

    // ---- controles da portaria: agora o formato prova o efeito
    r = await chamar("portaria", `/portaria/encomenda/${sem.encId}`, defsPortaria[5]);
    let e2 = await prisma.encomenda.findUnique({ where: { id: sem.encId }, select: { avisoWhatsAppEm: true, status: true } });
    ok(r.status === 200 && !!e2?.avisoWhatsAppEm, "controle: portaria marca o aviso de WhatsApp por HTTP cru (efeito no banco)");
    r = await chamar("portaria", "/portaria/retirada", defsPortaria[2]);
    e2 = await prisma.encomenda.findUnique({ where: { id: sem.encId }, select: { avisoWhatsAppEm: true, status: true } });
    ok(r.status === 200 && e2?.status === "entregue", "controle: portaria confirma a retirada por HTTP cru (encomenda passa a entregue)", `status ${r.status} / ${e2?.status}`);
  } finally {
    await prisma.porteiro.deleteMany({ where: { nome: { startsWith: "ZZFRONT-" } } });
    if (turnoCriadoId) await prisma.turno.deleteMany({ where: { id: turnoCriadoId } });
  }
}

/* -------------------------------------------------------------------- main */

let total = 0;
let falhas = 0;
const desvios: string[] = [];
function ok(cond: boolean, nome: string, detalhe = ""): void {
  total++;
  if (cond) console.log(`PASS ${nome}`);
  else {
    falhas++;
    console.log(`FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ""}`);
    desvios.push(`${nome}${detalhe ? ` -> ${detalhe}` : ""}`);
  }
}

async function main() {
  if (SENHA.length < 8) throw new Error("defina SENHA_TESTE (a senha usada em cria-usuarios-teste.ts, >= 8 caracteres)");
  for (const login of ["admin-teste", "portaria-teste", "morador-teste"]) {
    const u = await prisma.usuario.findUnique({ where: { login }, select: { ativo: true } });
    if (!u?.ativo) throw new Error(`conta ${login} ausente/inativa - rode: npx tsx scripts/cria-usuarios-teste.ts <senha>`);
  }
  const t0 = new Date();
  const antesEnc = await prisma.encomenda.count();
  const antesUsu = await prisma.usuario.count();
  const antesPort = await prisma.porteiro.count();
  const antesFotos = await prisma.fotoEncomenda.count();

  await criar21A();
  const sem = await semear();
  let cookies: Record<Exclude<Ator, "anon">, CookieInfo>;
  try {
    cookies = await logarTodos();
  } catch (e) {
    await limparTudo(sem);
    throw e;
  }
  const cookieDe = (a: Ator): string | undefined => (a === "anon" ? undefined : cookies[a].valor);

  try {
    /* ---------------------------------------------------------- linhas */
    const L: Linha[] = [];
    const add = (grupo: string, rotulo: string, caminho: string, esperado: (a: Ator) => Esperado, seguir = false) =>
      L.push({ grupo, rotulo, caminho, esperado, seguir });

    add("raiz", "/", "/", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "redir", para: ROTA_INICIAL[PAPEL_DO_ATOR[a]] }]));
    add("raiz", "/login", "/login", (a) => (a === "anon" ? [{ s: "200" }] : [{ s: "redir", para: ROTA_INICIAL[PAPEL_DO_ATOR[a]] }]));
    for (const r of ["/portaria", "/portaria/registrar", "/portaria/retirada", "/portaria/historico", "/portaria/historico/11A", "/portaria/turno"]) {
      add("portaria", r, r, (a) => protegida(a, r));
    }
    add("portaria", "/portaria/encomenda/1", "/portaria/encomenda/1", (a) => protegida(a, "/portaria/encomenda/1", "inexistente"));
    add("portaria", `/portaria/encomenda/${sem.encId} (real)`, `/portaria/encomenda/${sem.encId}`, (a) => protegida(a, "/portaria/encomenda/x"));
    add("portaria", "/etiqueta/ABCD", "/etiqueta/ABCD", (a) => protegida(a, "/etiqueta/ABCD", "inexistente"));
    add("portaria", `/etiqueta/${sem.codigo} (real)`, `/etiqueta/${sem.codigo}`, (a) => protegida(a, "/etiqueta/ABCD"));
    for (const r of ["/app", "/app/historico", "/app/conta"]) add("morador", r, r, (a) => protegida(a, r));
    add("morador", "/app/encomenda/ABCD", "/app/encomenda/ABCD", (a) => protegida(a, "/app/encomenda/ABCD", "inexistente"));
    add("morador", `/app/encomenda/${sem.codigo} (real 11A)`, `/app/encomenda/${sem.codigo}`, (a) => {
      if (a === "morador21A") return [{ s: "404" }]; // apto errado: 404 da pagina, sem 403
      return protegida(a, "/app/encomenda/ABCD");
    });
    for (const r of ["/admin", "/admin/moradores", "/admin/porteiros", "/admin/usuarios", "/admin/exportar", "/admin/logs"]) {
      add("admin", r, r, (a) => protegida(a, r));
    }
    add("admin", "/admin/exportar/csv?de=..&ate=..", "/admin/exportar/csv?de=2026-10-01&ate=2026-10-31", (a) => protegida(a, "/admin/exportar/csv"));
    add("admin", `/admin/exportar/csv?apto=11A`, `/admin/exportar/csv?de=2026-01-01&ate=2026-12-31&apto=11A`, (a) => protegida(a, "/admin/exportar/csv"));
    add("logados", "/conta/senha", "/conta/senha", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "200" }]));
    add("logados", "/fotos/1", "/fotos/1", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "404t" }]));
    add("logados", `/fotos/${sem.fotoId} (real 11A)`, `/fotos/${sem.fotoId}`, (a) => {
      if (a === "anon") return ANON_LOGIN;
      return a === "morador21A" ? [{ s: "404t" }] : [{ s: "200" }];
    });
    for (const r of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) add("publicas", r, r, () => [{ s: "200" }]);

    // normalizacao de caminho / bypass: o que importa e NUNCA 2xx indevido e NUNCA 5xx/403
    add("normaliza", "/portaria/encomenda/1.", "/portaria/encomenda/1.", (a) => protegida(a, "/portaria/encomenda/1.", "inexistente"));
    add("normaliza", "/app/../admin", "/app/../admin", (a) => {
      if (a === "anon") return [...ANON_LOGIN, { s: "404" }];
      return a === "admin" ? [{ s: "200" }, { s: "404" }] : [{ s: "404" }];
    });
    add("normaliza", "/ADMIN", "/ADMIN", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "404" }]));
    add("normaliza", "/admin%2F", "/admin%2F", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "404" }]));
    add("normaliza", "/fotos/1/", "/fotos/1/", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "404t" }]), true);
    add("normaliza", "/sw.jsx", "/sw.jsx", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "404t" }]));
    add("normaliza", "/sw.js/", "/sw.js/", () => [{ s: "200" }], true);
    add("normaliza", "/manifest.webmanifest.x", "/manifest.webmanifest.x", (a) => (a === "anon" ? ANON_LOGIN : [{ s: "404t" }]));
    add("normaliza", "/icons/../admin", "/icons/../admin", (a) => {
      if (a === "anon") return [...ANON_LOGIN, { s: "404" }];
      return a === "admin" ? [{ s: "200" }, { s: "404" }] : [{ s: "404" }];
    });
    add("normaliza", "/icons/%2e%2e/admin", "/icons/%2e%2e/admin", (a) => {
      if (a === "anon") return [...ANON_LOGIN, { s: "404" }];
      return a === "admin" ? [{ s: "200" }, { s: "404" }] : [{ s: "404" }];
    });
    add("normaliza", "/_next/static/../../admin", "/_next/static/../../admin", (a) => {
      if (a === "anon") return [...ANON_LOGIN, { s: "404" }];
      return a === "admin" ? [{ s: "200" }, { s: "404" }] : [{ s: "404" }];
    });
    add("normaliza", "//admin", "//admin", (a) => protegida(a, "/admin"), true);
    add("normaliza", "/%61dmin", "/%61dmin", (a) => (a === "anon" ? [...ANON_LOGIN, { s: "404" }] : [{ s: "404" }, ...(a === "admin" ? [{ s: "200" as const }] : [])]));
    add("normaliza", `/etiqueta/${sem.codigo.toLowerCase()} (minuscula)`, `/etiqueta/${sem.codigo.toLowerCase()}`, (a) => protegida(a, `/etiqueta/${sem.codigo.toLowerCase()}`, "inexistente"));
    add("normaliza", "/admin/ (barra final)", "/admin/", (a) => protegida(a, "/admin"), true);

    /* ------------------------------------------------------- matriz */
    console.log(`\n=== MATRIZ rota x ator (${BASE}) ===`);
    console.log("legenda: 200 | 404t = 404 texto simples do middleware/rota | 404h = 404 HTML da pagina | >/x = redirect para /x | '!' = DESVIO\n");
    const larg0 = Math.max(...L.map((l) => l.rotulo.length), 10) + 1;
    const larg = 17;
    console.log("rota".padEnd(larg0) + ATORES.map((a) => CABECALHO_COLUNA[a].padEnd(larg)).join(""));
    const matriz: Record<string, Record<string, string>> = {};
    let combos = 0;
    let certas = 0;
    let n404t = 0;
    let n404tEsperadas = 0;
    const respostas: Record<string, Record<Ator, Resp>> = {};
    let grupoAtual = "";
    for (const l of L) {
      if (l.grupo !== grupoAtual) {
        grupoAtual = l.grupo;
        console.log(`-- ${grupoAtual}`);
      }
      let linha = l.rotulo.padEnd(larg0);
      matriz[l.rotulo] = {};
      respostas[l.rotulo] = {} as Record<Ator, Resp>;
      for (const a of ATORES) {
        let r = await requisitar(l.caminho, { cookie: cookieDe(a) });
        let trilha = "";
        if (l.seguir) {
          // segue SO as normalizacoes permanentes (308/301); 307 (login) e o resultado, nao se segue
          for (let salto = 0; salto < 3 && (r.status === 308 || r.status === 301) && r.headers.location; salto++) {
            const dest = new URL(String(r.headers.location), BASE);
            trilha += `>${dest.pathname}`;
            r = await requisitar(dest.pathname + dest.search, { cookie: cookieDe(a) });
          }
        }
        respostas[l.rotulo][a] = r;
        const esp = l.esperado(a);
        const bom = atende(r, esp);
        combos++;
        if (bom) certas++;
        else desvios.push(`${l.rotulo} [${CABECALHO_COLUNA[a]}]: obtido ${celula(r)} (status ${r.status}, ${tipoDe(r) || "sem content-type"}, loc=${r.headers.location ?? "-"}) esperado ${esp.map(descAlt).join(" | ")}`);
        if (esp.length === 1 && esp[0].s === "404t") {
          n404tEsperadas++;
          if (bom) n404t++;
        }
        const c = trilha + (trilha && !ehRedirect(r) ? ">" : "") + celula(r) + (bom ? "" : "!");
        matriz[l.rotulo][CABECALHO_COLUNA[a]] = c;
        linha += c.padEnd(larg);
      }
      console.log(linha);
    }
    ok(certas === combos, `matriz: ${certas}/${combos} combinacoes conforme o esperado`, `${combos - certas} desvio(s)`);
    ok(n404t === n404tEsperadas, `proibido = 404 em texto simples do middleware: ${n404t}/${n404tEsperadas}`);
    const statusRuins = Object.values(respostas).flatMap((m) => Object.values(m)).filter((r) => [403, 500, 502, 503].includes(r.status));
    ok(statusRuins.length === 0, "nenhuma resposta 403/500/502/503 em toda a matriz", `${statusRuins.length} resposta(s)`);

    // corpo das negativas nao vaza nada
    const negativas = Object.values(respostas).flatMap((m) => Object.values(m)).filter((r) => r.status === 404 && /^text\/plain/.test(tipoDe(r)));
    ok(negativas.every((r) => r.bytes < 64 && r.texto === "Não encontrado"), `corpo das ${negativas.length} negativas em texto simples e identico (sem pista)`);
    ok(negativas.every((r) => String(r.headers["cache-control"] ?? "").includes("no-store")), "negativas em texto simples com Cache-Control: no-store");

    /* ------------------------------------------- conteudo dos 200 reais */
    const csv = respostas["/admin/exportar/csv?de=..&ate=.."].admin;
    ok(/^text\/csv/.test(tipoDe(csv)) && /attachment/.test(String(csv.headers["content-disposition"] ?? "")), "CSV do admin: text/csv + attachment");
    const csvApto = respostas["/admin/exportar/csv?apto=11A"].admin;
    const linhasCsv = csvApto.texto.split(/\r?\n/).filter(Boolean);
    ok(csvApto.status === 200 && linhasCsv.some((x) => x.includes(sem.codigo)), "CSV com apto=11A contem a encomenda semeada");
    const foto = respostas[`/fotos/${sem.fotoId} (real 11A)`].morador;
    ok(/^image\/png/.test(tipoDe(foto)) && foto.bytes > 100 && String(foto.headers["cache-control"]) === "private, no-store", "foto do proprio apto: image/png, Cache-Control private, no-store", `ct=${tipoDe(foto)} cc=${foto.headers["cache-control"]}`);
    const codigoPg = respostas[`/app/encomenda/${sem.codigo} (real 11A)`].morador;
    ok(codigoPg.status === 200 && codigoPg.texto.includes(sem.codigo), "morador 11A: pagina do codigo traz o codigo");
    // 404 do apto errado: so o proprio codigo da URL (que o morador digitou) aparece no payload da pagina
    const vazou = respostas[`/app/encomenda/${sem.codigo} (real 11A)`].morador21A;
    const inexist = respostas["/app/encomenda/ABCD"].morador21A;
    const sem404 = (t: string, cod: string) => t.split(cod).join("XXXX");
    const encDb = await prisma.encomenda.findUnique({ where: { id: sem.encId }, select: { destinatarioNome: true } });
    ok(
      vazou.status === 404 &&
        !vazou.texto.includes(encDb?.destinatarioNome ?? "NAO-EXISTE-DESTINATARIO") &&
        !vazou.texto.includes("Correios") &&
        !vazou.texto.includes(`/fotos/${sem.fotoId}`),
      "morador 21A: 404 do codigo do 11A nao traz destinatario, transportadora nem foto"
    );
    ok(
      sem404(vazou.texto, sem.codigo) === sem404(inexist.texto, "ABCD"),
      "morador 21A: 404 de codigo do OUTRO apto e identico ao de codigo inexistente (sem pista de existencia)",
      `len ${vazou.texto.length} vs ${inexist.texto.length}`
    );

    /* ---------------------------------------- carimbo e token forjados */
    console.log("\n=== Carimbo x-rota-verificada forjado / token adulterado / metodo ===");
    const alvoAdmin = "/admin";
    let r = await requisitar(alvoAdmin, { headers: { "x-rota-verificada": "/login" } });
    ok(ehRedirect(r) && destinoDe(r) === "/login", "anon + carimbo forjado '/login' em /admin -> redirect /login", celula(r));
    r = await requisitar(alvoAdmin, { headers: { "x-rota-verificada": "/admin" } });
    ok(ehRedirect(r) && destinoDe(r) === "/login", "anon + carimbo forjado '/admin' em /admin -> redirect /login", celula(r));
    r = await requisitar("/portaria", { headers: { "x-rota-verificada": "/portaria" } });
    ok(ehRedirect(r) && destinoDe(r) === "/login", "anon + carimbo forjado em /portaria -> redirect /login", celula(r));
    r = await requisitar(alvoAdmin, { cookie: cookies.morador.valor, headers: { "x-rota-verificada": "/app" } });
    ok(r.status === 404 && /^text\/plain/.test(tipoDe(r)), "morador + carimbo forjado '/app' em /admin -> 404t", celula(r));
    r = await requisitar("/portaria", { cookie: cookies.morador.valor, headers: { "x-rota-verificada": "/app", "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" } });
    ok(r.status === 404 && /^text\/plain/.test(tipoDe(r)), "morador + x-middleware-subrequest forjado em /portaria -> 404t", celula(r));
    r = await requisitar(alvoAdmin, { headers: { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" } });
    ok(ehRedirect(r) && destinoDe(r) === "/login", "anon + x-middleware-subrequest forjado em /admin -> redirect /login (CVE-2025-29927)", celula(r));

    const tk = cookies.morador.valor;
    const [corpo, assin] = tk.split(".");
    const flip = (s: string) => s.slice(0, -2) + (s.at(-2) === "A" ? "B" : "A") + s.at(-1);
    const payloadAdmin = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")), papel: "admin" })).toString("base64url");
    const adulterados: [string, string][] = [
      ["assinatura com 1 caractere trocado", `${corpo}.${flip(assin)}`],
      ["payload com papel=admin e a assinatura original", `${payloadAdmin}.${assin}`],
      ["lixo (abc.def)", "abc.def"],
      ["token de admin sem assinatura", `${payloadAdmin}.`],
    ];
    for (const [nome, valor] of adulterados) {
      for (const rota of ["/admin", "/portaria", "/app"]) {
        r = await requisitar(rota, { cookie: valor });
        ok(ehRedirect(r) && destinoDe(r) === "/login", `cookie adulterado (${nome}) em ${rota} -> redirect /login`, celula(r));
      }
    }
    for (const a of ["anon", "portaria", "morador"] as const) {
      r = await requisitar("/admin/moradores", { cookie: cookieDe(a), metodo: "POST" });
      ok(a === "anon" ? ehRedirect(r) && destinoDe(r) === "/login" : r.status === 404 && /^text\/plain/.test(tipoDe(r)), `POST /admin/moradores como ${CABECALHO_COLUNA[a]} nao chega a pagina`, celula(r));
    }

    /* ---------------------------------------- Server Actions por HTTP */
    await acoesPorHttp(sem, cookieDe);

    /* ------------------------------------------------ cabecalhos */
    console.log("\n=== Cabecalhos de seguranca e cookie ===");
    const login = respostas["/login"].anon;
    const h = login.headers;
    const csp = String(h["content-security-policy"] ?? "");
    ok(csp.includes("frame-ancestors 'none'") && csp.includes("default-src 'self'") && !csp.includes("unsafe-eval"), "CSP: frame-ancestors none, default-src self, sem unsafe-eval (producao)", csp.slice(0, 80));
    ok(h["x-content-type-options"] === "nosniff", "X-Content-Type-Options: nosniff");
    ok(h["x-frame-options"] === "DENY", "X-Frame-Options: DENY");
    ok(h["referrer-policy"] === "same-origin", "Referrer-Policy: same-origin");
    ok(String(h["permissions-policy"] ?? "").includes("camera=(self)") && String(h["permissions-policy"] ?? "").includes("geolocation=()"), "Permissions-Policy: camera=(self), geolocation=()");
    ok(!!h["strict-transport-security"], "Strict-Transport-Security presente");
    ok(h["x-powered-by"] === undefined, "sem X-Powered-By");
    const pg = respostas["/portaria"].portaria;
    ok(!!pg.headers["content-security-policy"] && pg.headers["x-frame-options"] === "DENY", "pagina logada tambem leva CSP e X-Frame-Options");
    for (const a of ["portaria", "morador", "morador21A", "admin"] as const) {
      const c = cookies[a];
      ok(c.httpOnly && c.path === "/" && /^(Lax|Strict)$/.test(c.sameSite), `cookie de ${CABECALHO_COLUNA[a]}: HttpOnly, path=/, SameSite=${c.sameSite}, validade ${c.expiraDias} dias, Secure=${c.secure}`);
    }

    /* ----------------------------------------- observacao: token apos Sair */
    console.log("\n=== Observacao (nao reprova) ===");
    console.log("INFO sessao e um token HMAC sem estado no servidor: 'Sair' apaga o cookie do navegador, mas o token copiado segue valido");
    console.log("INFO ate expirar (30 dias) ou ate a senha ser trocada / a conta desativada (sv + ativo sao reconferidos no banco a cada request).");

    if (process.env.SAIDA_JSON) {
      fs.writeFileSync(process.env.SAIDA_JSON, JSON.stringify({ base: BASE, colunas: ATORES.map((a) => CABECALHO_COLUNA[a]), combinacoes: combos, conformes: certas, matriz, desvios }, null, 2), "utf8");
    }
    console.log(`\nResumo da matriz: ${L.length} rotas x ${ATORES.length} atores = ${combos} combinacoes, ${certas} conformes, ${combos - certas} desvio(s).`);
  } finally {
    await limparTudo(sem);
    // eventos do livro gerados por este roteiro nas contas de teste (login, exportacao, cadastro, retirada...)
    const contas = await prisma.usuario.findMany({ where: { login: { in: ["admin-teste", "portaria-teste", "morador-teste"] } }, select: { id: true } });
    await prisma.logEvento.deleteMany({ where: { usuarioId: { in: contas.map((u) => u.id) }, criadoEm: { gte: t0 } } });
    const depois = {
      enc: await prisma.encomenda.count(),
      usu: await prisma.usuario.count(),
      port: await prisma.porteiro.count(),
      fotos: await prisma.fotoEncomenda.count(),
    };
    ok(depois.enc === antesEnc && depois.usu === antesUsu && depois.port === antesPort && depois.fotos === antesFotos, "limpeza: contagens de encomendas/usuarios/porteiros/fotos voltaram as do inicio", JSON.stringify({ antesEnc, antesUsu, antesPort, antesFotos, depois }));
  }

  console.log(`\n${total - falhas}/${total} verificacoes ok`);
  if (desvios.length) {
    console.log("\nDESVIOS:");
    for (const d of desvios) console.log(` - ${d}`);
  }
  console.log(falhas ? `${falhas} FALHA(S)` : "TUDO PASS");
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}

async function limparTudo(sem: Semente) {
  await limparSementes();
  await remover21A();
  if (sem.porteiroCriadoId) await prisma.porteiro.deleteMany({ where: { id: sem.porteiroCriadoId } });
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
