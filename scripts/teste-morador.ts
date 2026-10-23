/**
 * Teste da area do MORADOR (23/10/2026) - AUTO-REVERSIVEL (Playwright + prisma/dev.db).
 *
 *   TESTE_BASE=http://localhost:3012 npx tsx scripts/teste-morador.ts
 *
 * Cria (direto no banco) encomendas dos aptos 11A e 21A, contas de teste proprias
 * (zz-morador-t1 = 11A, zz-morador-t2 = 21A, zz-admin-t1), loga em celular 390x844 e
 * prova: isolamento entre aptos (tela, codigo, foto), rotas de outros papeis = 404,
 * telefone nunca na tela, nenhum controle de escrita alem de Sair/Instalar/Trocar senha,
 * sem rolagem lateral, alvos de toque >= 44 px, linha do tempo, historico (ano/busca),
 * instalacao (Android/iOS/instalado), manifest e service worker (so estaticos).
 * Ao final APAGA tudo que criou (encomendas, fotos + arquivos, porteiro, contas, eventos).
 *
 * Modos auxiliares (para screenshots; nao rodam os testes):
 *   --semear   cria as encomendas de demonstracao e as MANTEM (imprime os codigos); com
 *              SENHA_DEMO no ambiente tambem cria as 3 contas (zz-morador-t1/t2, zz-admin-t1)
 *   --limpar   remove tudo que o teste/semear criou (encomendas, fotos, porteiro, contas, eventos)
 * Saida ASCII; exit 1 se algo falhar.
 */
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { request, type Browser, type Page } from "playwright";
import { prisma } from "../src/lib/db";
import { gerarCodigo } from "../src/lib/encomendas";
import { caminhoFoto, salvarFoto } from "../src/lib/fotos";
import { partesLocais } from "../src/lib/datas";
import { nomeExibicao, nomesCurtos } from "../src/lib/morador";
import { gerarHashSenha } from "../src/lib/senha";
import { abrirNavegador } from "./_navegador";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const MARCA = "ZZTESTE-MORADOR";
const LOGIN_M11 = "zz-morador-t1";
const LOGIN_M21 = "zz-morador-t2";
const LOGIN_ADM = "zz-admin-t1";
const DIA = 86_400_000;
const HORA = 3_600_000;

let total = 0;
let falhas = 0;
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");

function ok(cond: boolean, nome: string, detalhe = ""): void {
  total++;
  if (cond) console.log(`PASS ${nome}`);
  else {
    falhas++;
    console.log(`FAIL ${nome}${detalhe ? ` -> ${ascii(detalhe)}` : ""}`);
  }
}

/* ------------------------------------------------------------------ PNG */

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

/** Caixa de papelao 160x160 (fita no meio, etiqueta branca) - so para as telas terem o que mostrar. */
function pngCaixa(variacao = 0): Buffer {
  const w = 160;
  const h = 160;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const base = y * (w * 3 + 1);
    raw[base] = 0;
    for (let x = 0; x < w; x++) {
      let r = 196 - Math.floor(y / 8) + variacao * 6;
      let g = 150 - Math.floor(y / 9) + variacao * 4;
      let b = 100 - Math.floor(y / 10);
      if (x >= 72 && x < 88) [r, g, b] = [226, 205, 160]; // fita
      if (x >= 18 && x < 84 && y >= 92 && y < 140) [r, g, b] = [250, 248, 243]; // etiqueta
      if (x >= 26 && x < 76 && [102, 112, 122, 130].includes(y)) [r, g, b] = [31, 29, 26]; // linhas de texto
      const o = base + 1 + x * 3;
      raw[o] = Math.max(0, r);
      raw[o + 1] = Math.max(0, g);
      raw[o + 2] = Math.max(0, b);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", deflateSync(raw)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- dados */

type Item = { id: number; codigo: string; fotoIds: number[] };
type Semente = {
  apto11: { id: number; numero: string };
  apto21: { id: number; numero: string };
  nomes11: string[];
  /** 11A */
  k1: Item; // aguardando, 2 h 17 min, prateleira A3, aviso WhatsApp, 1 foto
  k2: Item; // aguardando parada (4 dias), 2 fotos
  e1: Item; // entregue (morador retirou)
  e2: Item; // entregue (terceiro) ha 40 dias
  e3: Item; // entregue ano anterior
  c1: Item; // cancelada
  /** 21A */
  x1: Item; // aguardando de OUTRO apto (nunca pode aparecer para o 11A)
  anoAnterior: number;
};

async function limpar(): Promise<void> {
  const encs = await prisma.encomenda.findMany({ where: { observacao: MARCA }, select: { id: true } });
  const ids = encs.map((e) => e.id);
  const fotos = await prisma.fotoEncomenda.findMany({ where: { encomendaId: { in: ids } } });
  for (const f of fotos) {
    try {
      await unlink(caminhoFoto(f));
    } catch {
      /* ja removido */
    }
  }
  await prisma.fotoEncomenda.deleteMany({ where: { encomendaId: { in: ids } } });
  const porteiros = await prisma.encomenda.findMany({
    where: { id: { in: ids } },
    select: { recebidaPorPorteiroId: true, entreguePorPorteiroId: true },
  });
  await prisma.encomenda.deleteMany({ where: { id: { in: ids } } });
  // porteiro de teste: so some se mais ninguem usa (nunca um porteiro real)
  const candidatos = new Set<number>();
  for (const p of porteiros) {
    candidatos.add(p.recebidaPorPorteiroId);
    if (p.entreguePorPorteiroId) candidatos.add(p.entreguePorPorteiroId);
  }
  for (const pid of candidatos) {
    const [usos, turnos] = await Promise.all([
      prisma.encomenda.count({ where: { OR: [{ recebidaPorPorteiroId: pid }, { entreguePorPorteiroId: pid }] } }),
      prisma.turno.count({ where: { porteiroId: pid } }),
    ]);
    if (usos === 0 && turnos === 0) await prisma.porteiro.deleteMany({ where: { id: pid, ativo: false } });
  }
  const usuarios = await prisma.usuario.findMany({
    where: { login: { in: [LOGIN_M11, LOGIN_M21, LOGIN_ADM] } },
    select: { id: true },
  });
  const uids = usuarios.map((u) => u.id);
  await prisma.logEvento.deleteMany({ where: { usuarioId: { in: uids } } });
  await prisma.pushInscricao.deleteMany({ where: { usuarioId: { in: uids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: uids } } });
}

async function semear(): Promise<Semente> {
  await limpar(); // sobras de uma execucao interrompida

  const apto11 = await prisma.apartamento.findUnique({ where: { numero: "11A" }, select: { id: true, numero: true } });
  const apto21 = await prisma.apartamento.findUnique({ where: { numero: "21A" }, select: { id: true, numero: true } });
  if (!apto11 || !apto21) throw new Error("aptos 11A/21A nao existem - rode scripts/importa-cadastro.ts --aplicar");
  const moradores = await prisma.morador.findMany({
    where: { apartamentoId: apto11.id, ativo: true },
    orderBy: { id: "asc" },
    select: { id: true, nome: true },
  });
  if (moradores.length === 0) throw new Error("11A nao tem morador ativo");
  const m0 = moradores[0];
  const m1 = moradores[1] ?? moradores[0];

  // inativo: nao aparece na lista de porteiros do turno (nao atrapalha quem testa a portaria)
  const porteiro = await prisma.porteiro.create({ data: { nome: "José", ativo: false } });

  const agora = Date.now();
  const anoAnterior = partesLocais(agora).ano - 1;

  async function criar(d: {
    apartamentoId: number;
    destinatarioMoradorId?: number | null;
    destinatarioNome: string;
    tipo: string;
    transportadora?: string | null;
    local?: string | null;
    status: "aguardando" | "entregue" | "cancelada";
    recebidaEm: Date;
    avisoEm?: Date | null;
    entregueEm?: Date | null;
    retiradaMoradorId?: number | null;
    terceiro?: string | null;
    canceladaEm?: Date | null;
    motivo?: string | null;
    fotos: number;
  }): Promise<Item> {
    const codigo = await gerarCodigo();
    const e = await prisma.encomenda.create({
      data: {
        codigo,
        apartamentoId: d.apartamentoId,
        destinatarioMoradorId: d.destinatarioMoradorId ?? null,
        destinatarioNome: d.destinatarioNome,
        tipo: d.tipo,
        transportadora: d.transportadora ?? null,
        observacao: MARCA,
        local: d.local ?? null,
        status: d.status,
        recebidaEm: d.recebidaEm,
        recebidaPorPorteiroId: porteiro.id,
        avisoWhatsAppEm: d.avisoEm ?? null,
        entregueEm: d.entregueEm ?? null,
        entreguePorPorteiroId: d.status === "entregue" ? porteiro.id : null,
        retiradaPorMoradorId: d.retiradaMoradorId ?? null,
        retiradaTerceiroNome: d.terceiro ?? null,
        canceladaEm: d.canceladaEm ?? null,
        canceladaMotivo: d.motivo ?? null,
      },
      select: { id: true },
    });
    const fotoIds: number[] = [];
    for (let i = 1; i <= d.fotos; i++) {
      const f = await salvarFoto(new File([new Uint8Array(pngCaixa(i))], "etiqueta.png", { type: "image/png" }), e.id, i);
      fotoIds.push(f.id);
    }
    return { id: e.id, codigo, fotoIds };
  }

  const k1 = await criar({
    apartamentoId: apto11.id,
    destinatarioMoradorId: m0.id,
    destinatarioNome: m0.nome,
    tipo: "caixa",
    transportadora: "Mercado Livre",
    local: "Prateleira A3",
    status: "aguardando",
    recebidaEm: new Date(agora - (2 * HORA + 17 * 60_000)),
    avisoEm: new Date(agora - (2 * HORA + 5 * 60_000)),
    fotos: 1,
  });
  const k2 = await criar({
    apartamentoId: apto11.id,
    destinatarioMoradorId: m1.id,
    destinatarioNome: m1.nome,
    tipo: "sacola",
    transportadora: "iFood mercado",
    status: "aguardando",
    recebidaEm: new Date(agora - (4 * DIA + 3 * HORA)),
    fotos: 2,
  });
  const e1 = await criar({
    apartamentoId: apto11.id,
    destinatarioMoradorId: m0.id,
    destinatarioNome: m0.nome,
    tipo: "envelope",
    transportadora: "Correios",
    status: "entregue",
    recebidaEm: new Date(agora - 9 * DIA),
    entregueEm: new Date(agora - (9 * DIA - 3 * HORA)),
    retiradaMoradorId: m0.id,
    fotos: 1,
  });
  const e2 = await criar({
    apartamentoId: apto11.id,
    destinatarioMoradorId: m1.id,
    destinatarioNome: m1.nome,
    tipo: "caixa",
    transportadora: "Amazon",
    status: "entregue",
    recebidaEm: new Date(agora - 40 * DIA),
    entregueEm: new Date(agora - (40 * DIA - 5 * HORA)),
    terceiro: "Ana Souza",
    fotos: 1,
  });
  const e3 = await criar({
    apartamentoId: apto11.id,
    destinatarioMoradorId: m0.id,
    destinatarioNome: m0.nome,
    tipo: "perecivel",
    transportadora: "Mercado",
    status: "entregue",
    recebidaEm: new Date(Date.UTC(anoAnterior, 11, 15, 15, 0)),
    entregueEm: new Date(Date.UTC(anoAnterior, 11, 15, 22, 10)),
    retiradaMoradorId: m1.id,
    fotos: 1,
  });
  const c1 = await criar({
    apartamentoId: apto11.id,
    destinatarioNome: "Vizinho do 12A",
    tipo: "caixa",
    transportadora: "Shopee",
    status: "cancelada",
    recebidaEm: new Date(agora - 20 * DIA),
    canceladaEm: new Date(agora - (20 * DIA - HORA)),
    motivo: "Registrada no apartamento errado",
    fotos: 1,
  });
  const x1 = await criar({
    apartamentoId: apto21.id,
    destinatarioNome: "Vizinho ZZ Teste",
    tipo: "caixa",
    transportadora: "Shopee",
    status: "aguardando",
    recebidaEm: new Date(agora - HORA),
    fotos: 1,
  });

  return { apto11, apto21, nomes11: moradores.map((m) => nomeExibicao(m.nome)), k1, k2, e1, e2, e3, c1, x1, anoAnterior };
}

async function criarContas(senha: string, s: Semente): Promise<void> {
  const contas = [
    { login: LOGIN_M11, nome: "Apto 11A (teste)", papel: "morador", apartamentoId: s.apto11.id },
    { login: LOGIN_M21, nome: "Apto 21A (teste)", papel: "morador", apartamentoId: s.apto21.id },
    { login: LOGIN_ADM, nome: "Admin (teste)", papel: "admin", apartamentoId: null },
  ];
  for (const c of contas) {
    const { hash, salt } = gerarHashSenha(senha);
    await prisma.usuario.create({
      data: { ...c, senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: false, ativo: true },
    });
  }
}

/* ------------------------------------------------------------- navegador */

const paginasVistas: { rota: string; html: string }[] = [];

async function entrar(page: Page, login: string, senha: string): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120_000 });
  await page.fill("#login", login);
  await page.fill("#senha", senha);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.click("button[type=submit]"),
  ]);
  await page.waitForTimeout(500);
}

async function visitar(page: Page, rota: string, guardar = true) {
  const resp = await page.goto(`${BASE}${rota}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(800); // hidratacao
  const status = resp?.status() ?? 0;
  const html = await page.content();
  const texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (guardar) paginasVistas.push({ rota, html });
  return { status, html, texto, caminho: new URL(page.url()).pathname };
}

async function larguras(page: Page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    janela: window.innerWidth,
  }));
}

async function alvosPequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("a, button, input:not([type=hidden]), select, textarea, summary").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.display === "none") return;
      if (r.height < 43.5 || r.width < 43.5) {
        const rotulo = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} "${rotulo}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    });
    return out;
  });
}

/** Controles que gravam algo: formularios de acao (POST / server action) e botoes/links com verbo de escrita. */
async function controlesDeEscrita(page: Page) {
  return page.evaluate(() => {
    const formsPost = [...document.forms]
      .filter((f) => f.method.toLowerCase() === "post" || f.querySelector('input[name^="$ACTION"]'))
      .map((f) => (f.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30));
    const verbos = /(registrar|retirar|confirmar|cancelar|entregar|excluir|apagar|salvar|enviar|avisar|editar|criar|remover)/i;
    const verbosos: string[] = [];
    document.querySelectorAll("button, a, input[type=submit]").forEach((el) => {
      const t = ((el as HTMLElement).innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").trim();
      if (verbos.test(t)) verbosos.push(t.slice(0, 40));
    });
    return { formsPost, verbosos };
  });
}

function telefonesVazados(htmls: { rota: string; html: string }[], telefones: string[]): string[] {
  const achados: string[] = [];
  for (const { rota, html } of htmls) {
    for (const t of telefones) {
      const digitos = t.replace(/\D/g, "");
      if (digitos.length < 8) continue;
      if (html.includes(t) || html.includes(digitos)) achados.push(`${rota}: ${digitos.slice(0, 4)}...`);
    }
  }
  return achados;
}

function dimensaoPng(buf: Buffer): [number, number] | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function eventoInstalacao(page: Page, aceito = true): Promise<void> {
  return page.evaluate((aceitar) => {
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        (window as unknown as Record<string, unknown>).__prompted = true;
      },
      userChoice: Promise.resolve({ outcome: aceitar ? "accepted" : "dismissed" }),
    });
    window.dispatchEvent(ev);
  }, aceito);
}

/* ------------------------------------------------------------------ testes */

async function testar(browser: Browser, s: Semente, senha: string): Promise<void> {
  const celular = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  // tsx (esbuild) injeta __name() nas funcoes; dentro de page.evaluate ele nao existe
  const novoContexto = async (extra: Parameters<Browser["newContext"]>[0] = {}) => {
    const c = await browser.newContext({ ...celular, ...extra });
    await c.addInitScript("window.__name = window.__name || ((f) => f);");
    return c;
  };
  const ctx = await novoContexto();
  const page = await ctx.newPage();
  const errosConsole: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errosConsole.push(m.text());
  });
  page.on("pageerror", (e) => errosConsole.push(`pageerror: ${e.message}`));

  const moradoresBanco = await prisma.morador.findMany({
    where: { apartamento: { numero: { in: ["11A", "21A"] } } },
    select: { telefone: true },
  });
  const telefones = moradoresBanco.map((m) => m.telefone).filter((t): t is string => !!t);

  /* ---- funcoes puras de exibicao ---- */
  ok(nomeExibicao("ANA REIS") === "Ana Reis", "nomeExibicao: caixa alta vira Title Case");
  ok(nomeExibicao("MARIA DA SILVA E SOUZA") === "Maria da Silva e Souza", "nomeExibicao: conectores ficam minusculos");
  ok(nomeExibicao("ANA-LUIZA D'ÁVILA") === "Ana-Luiza D'Ávila", "nomeExibicao: hifen, apostrofo e acento");
  ok(nomeExibicao("Vizinho do 12A") === "Vizinho do 12A" && nomeExibicao("José") === "José", "nomeExibicao: nome com minuscula nao e tocado");
  ok(nomeExibicao("  ") === "" && nomeExibicao("12A") === "12A", "nomeExibicao: vazio e sem letras");
  ok(nomesCurtos(["Ana Reis", "Bruno"]).join("|") === "Ana|Bruno", "nomesCurtos: primeiro nome");
  ok(nomesCurtos(["Felipe Suarez", "Felipe Lima", "Ana"]).join("|") === "Felipe S.|Felipe L.|Ana", "nomesCurtos: homonimos ganham inicial do sobrenome");

  /* ---- login e /app ---- */
  await entrar(page, LOGIN_M11, senha);
  ok(new URL(page.url()).pathname === "/app", "login do morador cai em /app", page.url());

  const inicio = await visitar(page, "/app");
  ok(inicio.status === 200, "/app responde 200", String(inicio.status));
  const codigosNaTela = await page
    .locator('article[aria-label^="Encomenda "]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").replace("Encomenda ", "")));
  const aguardando11 = (
    await prisma.encomenda.findMany({ where: { apartamentoId: s.apto11.id, status: "aguardando" }, select: { codigo: true } })
  ).map((e) => e.codigo);
  ok(
    codigosNaTela.includes(s.k1.codigo) && codigosNaTela.includes(s.k2.codigo),
    "/app lista as duas encomendas aguardando do 11A",
    codigosNaTela.join(",")
  );
  ok(
    codigosNaTela.length > 0 && codigosNaTela.every((c) => aguardando11.includes(c)) && codigosNaTela.length === aguardando11.length,
    "/app mostra exatamente as aguardando do 11A (nenhuma de outro apto)",
    `tela=${codigosNaTela.join(",")} banco=${aguardando11.join(",")}`
  );
  ok(!inicio.html.includes(s.x1.codigo) && !inicio.texto.includes("Vizinho ZZ Teste"), "/app nao vaza a encomenda do 21A");
  ok(/Apto 11A/.test(inicio.texto) && /Espaço Tangará/i.test(inicio.texto), "cabecalho 'Espaco Tangara / Apto 11A'");
  const primeiros = s.nomes11.map((n) => n.split(/\s+/)[0]);
  ok(primeiros.some((p) => inicio.texto.includes(p)), "chip mostra os nomes dos moradores do apto", primeiros.join(","));
  ok(/\d+ encomendas? na portaria/.test(inicio.texto) && /qualquer um do apto retira/.test(inicio.texto), "contagem + 'qualquer um do apto retira'");
  ok(/Todos do apartamento veem as mesmas encomendas/.test(inicio.texto), "rodape explicativo presente");
  const cartaoK2 = (await page.locator(`article[aria-label="Encomenda ${s.k2.codigo}"]`).innerText()).replace(/\s+/g, " ");
  const cartaoK1 = (await page.locator(`article[aria-label="Encomenda ${s.k1.codigo}"]`).innerText()).replace(/\s+/g, " ");
  ok(/\b4 dias\b/i.test(cartaoK2), "card parado ha 4 dias ganha carimbo '4 dias'", cartaoK2);
  ok(!/\bdias?\b/i.test(cartaoK1), "card recente nao tem carimbo de dias", cartaoK1);
  ok(/Código/i.test(cartaoK1) && /para /.test(cartaoK1) && /Caixa · Mercado Livre/.test(cartaoK1) && /recebida por José/.test(cartaoK1), "card tem Codigo, para, tipo · transportadora, recebida por", cartaoK1);
  const hrefK1 = await page.locator(`article[aria-label="Encomenda ${s.k1.codigo}"] a`).first().getAttribute("href");
  ok(hrefK1 === `/app/encomenda/${s.k1.codigo}`, "botao 'Mostrar ao porteiro' leva a /app/encomenda/<codigo>", String(hrefK1));
  const tamanhoCodigo = await page
    .locator(`article[aria-label="Encomenda ${s.k1.codigo}"] .font-mono`)
    .evaluate((el) => getComputedStyle(el).fontSize);
  ok(tamanhoCodigo === "34px", "codigo do card em mono 34 px", tamanhoCodigo);
  const nav = await page.locator('nav[aria-label="Navegação do morador"]').innerText();
  ok(/Na portaria/.test(nav) && /Histórico/.test(nav) && /Apto 11A/.test(nav), "nav inferior com 3 itens");
  const badge = await page.locator('nav[aria-label="Navegação do morador"] [aria-label$="na portaria"]').innerText();
  ok(Number(badge) === aguardando11.length, "badge do nav = aguardando do apto", badge);

  // ?apto= e ignorado para o morador
  const forcado = await visitar(page, "/app?apto=21A");
  ok(forcado.status === 200 && /Apto 11A/.test(forcado.texto) && !forcado.html.includes(s.x1.codigo), "morador com ?apto=21A continua vendo so o 11A");

  /* ---- detalhe ---- */
  const d1 = await visitar(page, `/app/encomenda/${s.k1.codigo}`);
  ok(d1.status === 200, "detalhe do proprio codigo = 200", String(d1.status));
  ok((await page.locator(`svg[aria-label="QR code da encomenda ${s.k1.codigo}"]`).count()) === 1, "detalhe mostra o QR");
  const tamCod = await page.locator("section[aria-label^='Código'] .font-mono").first().evaluate((el) => getComputedStyle(el).fontSize);
  ok(tamCod === "52px", "codigo do detalhe em 52 px", tamCod);
  const qr = await page.locator(`svg[aria-label^="QR code"]`).boundingBox();
  ok(!!qr && Math.round(qr.width) === 200 && Math.round(qr.height) === 200, "QR com 200 px", JSON.stringify(qr));
  ok(/Mostre esta tela ao porteiro, ou diga o código\./.test(d1.texto), "instrucao 'Mostre esta tela ao porteiro'");
  ok(/Guardada na prateleira A3/.test(d1.texto), "local: 'Guardada na prateleira A3'");
  ok(/Linha do tempo/i.test(d1.texto) && /Recebida na portaria/.test(d1.texto) && /Aviso enviado no WhatsApp/.test(d1.texto), "linha do tempo: recebida + aviso");
  ok(/Aguardando retirada.*há 2 h (1[6-9]|2\d) min/.test(d1.texto), "linha do tempo: aguardando ha 2 h 17 min", d1.texto.slice(-200));
  ok(/hoje, \d{2}:\d{2} · por José/.test(d1.texto) || /(ontem|seg|ter|qua|qui|sex|sáb|dom)[^·]*· por José/.test(d1.texto), "recebida: 'quando · por <porteiro>'");
  const voltar = await page.locator("a:has-text('Voltar')").first().getAttribute("href");
  ok(voltar === "/app", "Voltar (aguardando) volta para /app", String(voltar));

  // foto em tela cheia
  await page.locator('button[aria-label^="Ampliar"]').first().click();
  await page.waitForSelector('[role="dialog"] img', { timeout: 10_000 });
  await page.waitForTimeout(500);
  const imgOk = await page.locator('[role="dialog"] img').first().evaluate((el) => (el as HTMLImageElement).naturalWidth > 0);
  ok(imgOk, "toque na foto abre o dialogo com a foto carregada");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok((await page.locator('[role="dialog"]').count()) === 0, "Esc fecha o dialogo da foto");

  // 2 fotos: badge +1 e duas imagens no dialogo
  const d2 = await visitar(page, `/app/encomenda/${s.k2.codigo.toLowerCase()}`);
  ok(d2.status === 200, "codigo em minusculas tambem abre (normalizado)", String(d2.status));
  ok(/\+1/.test(await page.locator('button[aria-label^="Ampliar"]').first().innerText()), "miniatura com 2 fotos mostra '+1'");
  await page.locator('button[aria-label^="Ampliar"]').first().click();
  await page.waitForSelector('[role="dialog"] img', { timeout: 10_000 });
  ok((await page.locator('[role="dialog"] img').count()) === 2, "dialogo empilha as 2 fotos");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok(/Aguardando retirada.*há 4 dias/.test(d2.texto), "parada: 'Aguardando retirada ... ha 4 dias'", d2.texto.slice(-160));

  // entregue por morador / terceiro / cancelada
  const de1 = await visitar(page, `/app/encomenda/${s.e1.codigo}`);
  ok(de1.status === 200 && (await page.locator("svg[aria-label^='QR code']").count()) === 0, "entregue: sem QR");
  ok(/Entregue/.test(de1.texto) && /Retirou: /.test(de1.texto) && /por José/.test(de1.texto), "entregue: quem entregou e quem retirou");
  ok((await page.locator("a:has-text('Voltar')").first().getAttribute("href")) === "/app/historico", "Voltar (encerrada) volta para o historico");
  const de2 = await visitar(page, `/app/encomenda/${s.e2.codigo}`);
  ok(/Retirou: Ana Souza \(terceiro\)/.test(de2.texto), "entregue a terceiro: 'Retirou: Ana Souza (terceiro)'");
  const dc1 = await visitar(page, `/app/encomenda/${s.c1.codigo}`);
  ok(/Cancelada/.test(dc1.texto) && /Motivo: Registrada no apartamento errado/.test(dc1.texto), "cancelada: motivo na linha do tempo");

  /* ---- 404 de outro apto / invalido ---- */
  const outro = await visitar(page, `/app/encomenda/${s.x1.codigo}`, false);
  ok(outro.status === 404, "codigo de OUTRO apto = 404 (nunca 403)", String(outro.status));
  ok(!outro.html.includes("Vizinho ZZ Teste") && !outro.html.includes(`QR code da encomenda ${s.x1.codigo}`), "404 do outro apto nao vaza dados");
  const invalido = await visitar(page, "/app/encomenda/ZZZZ0", false);
  ok(invalido.status === 404, "codigo invalido = 404", String(invalido.status));

  /* ---- fotos ---- */
  const resFotoPropria = await ctx.request.get(`${BASE}/fotos/${s.k1.fotoIds[0]}`, { maxRedirects: 0 });
  ok(resFotoPropria.status() === 200 && (resFotoPropria.headers()["content-type"] ?? "").startsWith("image/"), "/fotos/<id> da propria encomenda = 200 imagem", String(resFotoPropria.status()));
  const resFotoOutra = await ctx.request.get(`${BASE}/fotos/${s.x1.fotoIds[0]}`, { maxRedirects: 0 });
  ok(resFotoOutra.status() === 404, "/fotos/<id> de OUTRO apto = 404", String(resFotoOutra.status()));
  const anonimo = await request.newContext();
  const resAnon = await anonimo.get(`${BASE}/fotos/${s.k1.fotoIds[0]}`, { maxRedirects: 0 });
  ok(resAnon.status() !== 200 && !(resAnon.headers()["content-type"] ?? "").startsWith("image/"), "/fotos/<id> sem login nao entrega a imagem", String(resAnon.status()));
  await anonimo.dispose();

  /* ---- rotas de outros papeis ---- */
  for (const rota of ["/portaria", "/portaria/registrar", "/portaria/retirada", "/admin", "/admin/logs", `/etiqueta/${s.k1.codigo}`]) {
    const r = await ctx.request.get(`${BASE}${rota}`, { maxRedirects: 0 });
    ok(r.status() === 404, `${rota} = 404 para o morador`, String(r.status()));
  }

  /* ---- historico ---- */
  const h = await visitar(page, "/app/historico");
  ok(h.status === 200, "/app/historico = 200", String(h.status));
  const anoAtual = partesLocais(Date.now()).ano;
  const chips = await page.locator('main a.chip').allInnerTexts();
  ok(chips.includes(String(anoAtual)) && chips.includes(String(s.anoAnterior)) && chips.includes("Tudo"), "chips: anos com registro + Tudo", chips.join("|"));
  ok(/Buscar/.test(h.texto), "chip Buscar presente");
  const ativo = (await page.locator('main a.chip[aria-current="true"]').allInnerTexts()).join("|");
  ok(/^\d{4}$/.test(ativo), "um ano esta ativo por padrao", ativo);
  const anoAtivo = Number(ativo);
  const recebidas = await prisma.encomenda.findMany({
    where: { id: { in: [s.e1.id, s.e2.id, s.e3.id, s.c1.id] } },
    select: { id: true, codigo: true, recebidaEm: true },
  });
  const devem = recebidas.filter((r) => partesLocais(r.recebidaEm).ano === anoAtivo).map((r) => r.codigo);
  const naoDevem = recebidas.filter((r) => partesLocais(r.recebidaEm).ano !== anoAtivo).map((r) => r.codigo);
  ok(devem.every((c) => h.html.includes(c)) && naoDevem.every((c) => !h.html.includes(c)), "historico filtra pelo ano ativo", `devem=${devem} naoDevem=${naoDevem}`);
  ok(!h.html.includes(s.k1.codigo) && !h.html.includes(s.k2.codigo) && !h.html.includes(s.x1.codigo), "historico nao lista aguardando nem outro apto");
  ok(/retirada por .+ · \d{2}\/\d{2} \d{2}:\d{2}/.test(h.texto), "item: 'retirada por <quem> · dd/MM HH:mm'");
  ok(/\(terceiro\)/.test(h.texto) || devem.indexOf(s.e2.codigo) < 0, "item de terceiro marca '(terceiro)'");
  ok(/cancelada: Registrada no apartamento errado/.test(h.texto) || devem.indexOf(s.c1.codigo) < 0, "item cancelado mostra o motivo");
  ok(/A foto fica guardada por 90 dias depois da entrega\./.test(h.texto), "rodape sobre 90 dias");
  const meses = await page.locator("main section h2").allInnerTexts();
  ok(meses.length > 0 && meses.every((m) => /^(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)$/i.test(m.trim())), "agrupado por mes (so o mes, com ano filtrado)", meses.join("|"));
  const tudo = await visitar(page, "/app/historico?ano=tudo");
  ok(tudo.html.includes(s.e3.codigo) && tudo.html.includes(s.e1.codigo), "?ano=tudo inclui o ano anterior");
  const mesesTudo = await page.locator("main section h2").allInnerTexts();
  ok(mesesTudo.some((m) => new RegExp(`de ${s.anoAnterior}$`, "i").test(m.trim())), "em 'Tudo' o mes leva o ano", mesesTudo.join("|"));
  const anterior = await visitar(page, `/app/historico?ano=${s.anoAnterior}`);
  ok(anterior.html.includes(s.e3.codigo) && !anterior.html.includes(s.e1.codigo), "?ano=<anterior> mostra so o ano anterior");
  const invalidoAno = await visitar(page, "/app/historico?ano=1999");
  ok(invalidoAno.status === 200 && /\d{4}/.test(invalidoAno.texto), "?ano invalido cai no padrao sem erro");
  const buscaTerceiro = await visitar(page, "/app/historico?q=ana%20souza");
  ok(buscaTerceiro.html.includes(s.e2.codigo) && !buscaTerceiro.html.includes(s.e1.codigo), "?q= acha pelo nome de quem retirou");
  const hifen = `${s.e1.codigo.slice(0, 2).toLowerCase()}-${s.e1.codigo.slice(2).toLowerCase()}`;
  const buscaCodigo = await visitar(page, `/app/historico?q=${hifen}`);
  ok(buscaCodigo.html.includes(s.e1.codigo) && !buscaCodigo.html.includes(s.e2.codigo), "?q= acha pelo codigo (minusculo, com hifen)");
  const buscaTransp = await visitar(page, "/app/historico?q=correios");
  ok(buscaTransp.html.includes(s.e1.codigo), "?q= acha pela transportadora");
  ok((await page.locator('input[type="search"]').count()) === 1, "com busca ativa o campo ja aparece aberto");
  const buscaVazia = await visitar(page, "/app/historico?q=zznaoexiste");
  ok(/Nada encontrado/.test(buscaVazia.texto), "busca sem resultado: 'Nada encontrado'");
  await visitar(page, "/app/historico");
  await page.getByRole("button", { name: /Buscar/ }).first().click();
  ok((await page.locator('input[type="search"]').count()) === 1, "clicar em Buscar abre o campo");
  await page.fill('input[type="search"]', "amazon");
  await Promise.all([page.waitForURL(/q=amazon/, { timeout: 30_000 }), page.keyboard.press("Enter")]);
  await page.waitForTimeout(500);
  ok((await page.content()).includes(s.e2.codigo), "buscar por digitacao filtra a lista (GET ?q=)");

  /* ---- conta ---- */
  const conta = await visitar(page, "/app/conta");
  ok(conta.status === 200 && /Apto 11A/.test(conta.texto), "/app/conta = 200 com 'Apto 11A'");
  ok(s.nomes11.every((n) => conta.texto.includes(n)), "conta lista os nomes dos moradores", s.nomes11.join(","));
  ok((await page.locator('a[href="/conta/senha"]').count()) === 1 && /Trocar senha/.test(conta.texto), "link 'Trocar senha' -> /conta/senha");
  ok(/Instalar no celular/.test(conta.texto), "cartao 'Instalar no celular'");
  ok((await page.getByRole("button", { name: "Sair" }).count()) === 1, "botao Sair presente");

  /* ---- sem controles de escrita / telefone ---- */
  for (const rota of ["/app", `/app/encomenda/${s.k1.codigo}`, "/app/historico", "/app/conta"]) {
    await visitar(page, rota, false);
    const c = await controlesDeEscrita(page);
    const esperaSair = rota === "/app/conta" ? 1 : 0;
    ok(c.formsPost.length === esperaSair, `${rota}: formularios de escrita = ${esperaSair} (so o Sair)`, JSON.stringify(c.formsPost));
    ok(c.verbosos.filter((v) => !/^Sair$/i.test(v)).length === 0, `${rota}: nenhum botao/link com verbo de escrita`, c.verbosos.join("|"));
  }
  const vazados = telefonesVazados(paginasVistas, telefones);
  ok(vazados.length === 0, `telefone de morador nunca aparece (${telefones.length} numeros conferidos em ${paginasVistas.length} paginas)`, vazados.join(","));

  /* ---- 390 px: rolagem lateral e alvos de toque ---- */
  for (const rota of ["/app", `/app/encomenda/${s.k1.codigo}`, "/app/historico", "/app/historico?ano=tudo", "/app/conta"]) {
    await visitar(page, rota, false);
    const l = await larguras(page);
    ok(l.doc <= l.janela && l.body <= l.janela, `${rota}: sem rolagem lateral a 390 px`, JSON.stringify(l));
    const pequenos = await alvosPequenos(page);
    ok(pequenos.length === 0, `${rota}: alvos de toque >= 44 px`, pequenos.join("; "));
  }

  /* ---- tela pequena (320 px) ---- */
  await page.setViewportSize({ width: 320, height: 640 });
  for (const rota of ["/app", `/app/encomenda/${s.k1.codigo}`, "/app/historico?ano=tudo", "/app/conta"]) {
    await visitar(page, rota, false);
    const l = await larguras(page);
    ok(l.doc <= l.janela && l.body <= l.janela, `${rota}: sem rolagem lateral a 320 px`, JSON.stringify(l));
  }
  await page.setViewportSize({ width: 390, height: 844 });

  /* ---- estado vazio de /app: nada aguardando ---- */
  const outrasAguardando = await prisma.encomenda.count({
    where: { apartamentoId: s.apto11.id, status: "aguardando", id: { notIn: [s.k1.id, s.k2.id] } },
  });
  if (outrasAguardando === 0) {
    const ent = new Date();
    const base = await prisma.encomenda.findUniqueOrThrow({ where: { id: s.k1.id }, select: { recebidaPorPorteiroId: true } });
    await prisma.encomenda.updateMany({
      where: { id: { in: [s.k1.id, s.k2.id] } },
      data: { status: "entregue", entregueEm: ent, entreguePorPorteiroId: base.recebidaPorPorteiroId },
    });
    await prisma.encomenda.update({ where: { id: s.k1.id }, data: { entregueEm: new Date(ent.getTime() + 60_000) } });
    const vazio = await visitar(page, "/app");
    ok(/Nenhuma encomenda na portaria/.test(vazio.texto), "estado vazio: 'Nenhuma encomenda na portaria'");
    ok(vazio.texto.includes(`Última entrega: ${s.k1.codigo}`), "estado vazio mostra a ultima entrega recebida", vazio.texto.slice(0, 300));
    ok((await page.locator('nav[aria-label="Navegação do morador"] [aria-label$="na portaria"]').count()) === 0, "nav sem badge quando nao ha nada aguardando");
    const pv = await alvosPequenos(page);
    const lv = await larguras(page);
    ok(pv.length === 0 && lv.doc <= lv.janela, "estado vazio: alvos >= 44 px e sem rolagem lateral", pv.join("; "));
    await page.locator("a:has-text('Última entrega')").click();
    await page.waitForURL(new RegExp(`/app/encomenda/${s.k1.codigo}`), { timeout: 30_000 });
    await page.waitForTimeout(500);
    ok((await page.locator("text=Esta encomenda já foi entregue").count()) > 0, "ultima entrega leva ao detalhe da encomenda entregue");
    // volta ao estado anterior: os testes seguintes usam as duas como "aguardando"
    await prisma.encomenda.updateMany({
      where: { id: { in: [s.k1.id, s.k2.id] } },
      data: { status: "aguardando", entregueEm: null, entreguePorPorteiroId: null },
    });
  } else {
    console.log(`SKIP estado vazio (ha ${outrasAguardando} outra(s) aguardando no 11A)`);
  }

  /* ---- instalacao: Android (evento), dispensar, instalado ---- */
  const estado = await ctx.storageState();
  const ctxAnd = await novoContexto({ storageState: estado });
  const pa = await ctxAnd.newPage();
  await pa.goto(`${BASE}/app`, { waitUntil: "load", timeout: 120_000 });
  await pa.waitForTimeout(900);
  await eventoInstalacao(pa);
  await pa.waitForTimeout(300);
  ok((await pa.locator('aside[aria-label="Instalar o app"]').count()) === 1, "Android: com o evento aparece o banner de instalacao");
  const pequenosBanner = await alvosPequenos(pa);
  ok(pequenosBanner.length === 0, "banner de instalacao: alvos >= 44 px", pequenosBanner.join("; "));
  const lb = await larguras(pa);
  ok(lb.doc <= lb.janela, "banner de instalacao: sem rolagem lateral", JSON.stringify(lb));
  await pa.locator('aside[aria-label="Instalar o app"]').getByRole("button", { name: "Instalar", exact: true }).click();
  await pa.waitForTimeout(300);
  ok((await pa.evaluate(() => (window as unknown as Record<string, unknown>).__prompted === true)), "botao Instalar do banner dispara o prompt do navegador");
  ok((await pa.locator('aside[aria-label="Instalar o app"]').count()) === 0, "depois de instalar o banner some");
  await pa.getByRole("link", { name: /Apto 11A/ }).click();
  await pa.waitForURL(/\/app\/conta/, { timeout: 30_000 });
  await pa.waitForTimeout(600);
  ok(/Instalado ✓/.test(await pa.locator("body").innerText()), "/app/conta mostra 'Instalado ✓' depois da instalacao");
  // dispensar o banner persiste
  await pa.goto(`${BASE}/app`, { waitUntil: "load" });
  await pa.waitForTimeout(700);
  await eventoInstalacao(pa);
  await pa.waitForTimeout(300);
  ok((await pa.locator('aside[aria-label="Instalar o app"]').count()) === 1, "banner volta a aparecer apos recarregar (ainda nao dispensado)");
  await pa.getByRole("button", { name: "Dispensar aviso de instalação" }).click();
  await pa.waitForTimeout(300);
  ok((await pa.locator('aside[aria-label="Instalar o app"]').count()) === 0, "dispensar esconde o banner");
  await pa.reload({ waitUntil: "load" });
  await pa.waitForTimeout(700);
  await eventoInstalacao(pa);
  await pa.waitForTimeout(300);
  ok((await pa.locator('aside[aria-label="Instalar o app"]').count()) === 0, "banner dispensado nao volta (localStorage)");
  // mas o botao em /app/conta continua la
  await pa.getByRole("link", { name: /Apto 11A/ }).click();
  await pa.waitForURL(/\/app\/conta/, { timeout: 30_000 });
  await pa.waitForTimeout(500);
  ok((await pa.getByRole("button", { name: "Instalar", exact: true }).count()) === 1, "/app/conta continua oferecendo o botao Instalar");
  await ctxAnd.close();

  /* ---- instalacao: iPhone (Safari) ---- */
  const ctxIos = await novoContexto({
    storageState: estado,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  });
  const pi = await ctxIos.newPage();
  await pi.goto(`${BASE}/app/conta`, { waitUntil: "load", timeout: 120_000 });
  await pi.waitForTimeout(900);
  const textoIos = await pi.locator("body").innerText();
  ok(/Compartilhar/.test(textoIos) && /Adicionar à Tela de Início/.test(textoIos), "iPhone: passo a passo Compartilhar -> Adicionar a Tela de Inicio");
  ok(!/abra este endereço no Safari/.test(textoIos), "iPhone/Safari: sem aviso de outro navegador");
  const ios390 = await larguras(pi);
  ok(ios390.doc <= ios390.janela, "iPhone: conta sem rolagem lateral", JSON.stringify(ios390));
  await pi.goto(`${BASE}/app`, { waitUntil: "load" });
  await pi.waitForTimeout(900);
  ok((await pi.locator('aside[aria-label="Instalar o app"]').getByRole("link", { name: "Como instalar" }).count()) === 1, "iPhone: banner leva ao 'Como instalar'");
  await ctxIos.close();

  /* ---- instalado (standalone) ---- */
  const ctxApp = await novoContexto({ storageState: estado });
  await ctxApp.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
  });
  const pp = await ctxApp.newPage();
  await pp.goto(`${BASE}/app/conta`, { waitUntil: "load", timeout: 120_000 });
  await pp.waitForTimeout(900);
  ok(/Instalado ✓/.test(await pp.locator("body").innerText()), "app aberto como instalado mostra 'Instalado ✓'");
  await ctxApp.close();

  /* ---- manifest e service worker ---- */
  const sem = await request.newContext();
  const man = await sem.get(`${BASE}/manifest.webmanifest`, { maxRedirects: 0 });
  const mj = (await man.json().catch(() => null)) as Record<string, unknown> | null;
  ok(man.status() === 200 && !!mj, "manifest publico (sem login) = 200 JSON", String(man.status()));
  if (mj) {
    const icones = (mj.icons as { src: string; sizes: string; purpose?: string }[]) ?? [];
    ok(mj.short_name === "Encomendas" && mj.start_url === "/" && mj.display === "standalone", "manifest: short_name, start_url, display", JSON.stringify([mj.short_name, mj.start_url, mj.display]));
    ok(mj.theme_color === "#C47A2C" && String(mj.background_color).toUpperCase() === "#FAF8F3", "manifest: theme kraft, background paper");
    ok(icones.some((i) => i.sizes === "192x192") && icones.some((i) => i.sizes === "512x512") && icones.some((i) => i.purpose === "maskable"), "manifest: icones 192, 512 e maskable");
    for (const i of icones) {
      const r = await sem.get(`${BASE}${i.src}`, { maxRedirects: 0 });
      const dim = r.status() === 200 ? dimensaoPng(await r.body()) : null;
      const [w, hh] = i.sizes.split("x").map(Number);
      ok(!!dim && dim[0] === w && dim[1] === hh, `icone ${i.src} existe e tem ${i.sizes}`, `${r.status()} ${JSON.stringify(dim)}`);
    }
  }
  const sw = await sem.get(`${BASE}/sw.js`, { maxRedirects: 0 });
  ok(sw.status() === 200 && (sw.headers()["content-type"] ?? "").includes("javascript"), "/sw.js publico = 200 javascript", String(sw.status()));
  await sem.dispose();

  // registra o SW de verdade (em dev o RegistraSW nao registra) e confere o que ele guarda
  await visitar(page, "/app", false);
  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((res) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => res(), { once: true });
        setTimeout(res, 4000);
      });
    }
    const script = document.querySelector<HTMLScriptElement>('script[src*="/_next/static/"]');
    const idFoto = (document.querySelector('img[src^="/fotos/"]') as HTMLImageElement | null)?.getAttribute("src");
    await fetch("/icons/icon-192.png");
    if (script) await fetch(script.src);
    await fetch("/app/historico", { credentials: "same-origin" });
    await fetch("/app", { credentials: "same-origin" });
    if (idFoto) await fetch(idFoto, { credentials: "same-origin" });
    await new Promise((r) => setTimeout(r, 500));
    const nomes = await caches.keys();
    const urls: string[] = [];
    for (const n of nomes) {
      const c = await caches.open(n);
      for (const req of await c.keys()) urls.push(new URL(req.url).pathname);
    }
    const info = {
      estado: reg.active?.state ?? null,
      controlada: !!navigator.serviceWorker.controller,
      caches: nomes,
      urls,
    };
    await reg.unregister();
    for (const n of nomes) await caches.delete(n);
    return info;
  });
  ok(swInfo.estado === "activated", "service worker registra e ativa", JSON.stringify(swInfo.estado));
  ok(swInfo.urls.some((u) => u.startsWith("/icons/")), "SW guarda os icones", swInfo.urls.join(","));
  ok(swInfo.urls.length > 0 && swInfo.urls.every((u) => u.startsWith("/_next/static/") || u.startsWith("/icons/")), "SW guarda SOMENTE estaticos (nada de pagina, dado ou foto)", swInfo.urls.join(","));

  ok(errosConsole.filter((e) => !/Failed to load resource.*(404|401|403)/i.test(e)).length === 0, "sem erros de console nas telas do morador", errosConsole.join(" || ").slice(0, 400));

  /* ---- sair ---- */
  await visitar(page, "/app/conta", false);
  await Promise.all([page.waitForURL(/\/login/, { timeout: 30_000 }), page.getByRole("button", { name: "Sair" }).click()]);
  ok(new URL(page.url()).pathname === "/login", "Sair leva ao /login");
  const aposSair = await visitar(page, "/app", false);
  ok(aposSair.caminho === "/login", "depois de sair, /app volta ao login", aposSair.caminho);
  await ctx.close();

  /* ---- outro apto (21A): simetria ---- */
  const ctx21 = await novoContexto();
  const p21 = await ctx21.newPage();
  await entrar(p21, LOGIN_M21, senha);
  const i21 = await visitar(p21, "/app", false);
  ok(i21.html.includes(s.x1.codigo) && !i21.html.includes(s.k1.codigo) && !i21.html.includes(s.k2.codigo), "21A ve a sua encomenda e nenhuma do 11A");
  const cruzado = await visitar(p21, `/app/encomenda/${s.k1.codigo}`, false);
  ok(cruzado.status === 404, "21A abrindo codigo do 11A = 404", String(cruzado.status));
  const fotoCruzada = await ctx21.request.get(`${BASE}/fotos/${s.k1.fotoIds[0]}`, { maxRedirects: 0 });
  ok(fotoCruzada.status() === 404, "21A pedindo foto do 11A = 404", String(fotoCruzada.status()));
  const hist21 = await visitar(p21, "/app/historico?ano=tudo", false);
  ok(!hist21.html.includes(s.e1.codigo) && !hist21.html.includes(s.c1.codigo), "historico do 21A nao tem nada do 11A");
  await ctx21.close();

  /* ---- admin conferindo ---- */
  const ctxAdm = await novoContexto();
  const padm = await ctxAdm.newPage();
  await entrar(padm, LOGIN_ADM, senha);
  const a0 = await visitar(padm, "/app", false);
  ok(a0.status === 200 && /Qual apartamento\?/.test(a0.texto), "admin em /app sem ?apto= escolhe o apartamento");
  const a1 = await visitar(padm, "/app?apto=11A", false);
  ok(a1.html.includes(s.k1.codigo) && /Apto 11A/.test(a1.texto), "admin com ?apto=11A ve as encomendas do 11A");
  const a2 = await visitar(padm, `/app/encomenda/${s.x1.codigo}`, false);
  ok(a2.status === 200 && (await padm.locator(`svg[aria-label="QR code da encomenda ${s.x1.codigo}"]`).count()) === 1, "admin abre a encomenda de qualquer apto");
  ok(((await padm.locator("a:has-text('Voltar')").first().getAttribute("href")) ?? "").includes("apto=21A"), "admin: Voltar mantem o apto conferido");
  const a3 = await visitar(padm, "/app/historico?apto=11A", false);
  ok(a3.html.includes(s.e1.codigo), "admin ve o historico do apto escolhido");
  const a4 = await visitar(padm, "/app/conta", false);
  ok(a4.status === 200 && /Admin \(teste\)/.test(a4.texto), "admin em /app/conta ve o proprio acesso");
  await ctxAdm.close();
}

/* -------------------------------------------------------------------- main */

async function main() {
  const modo = process.argv[2];
  if (modo === "--limpar") {
    await limpar();
    console.log("limpo");
    return;
  }
  if (modo === "--semear") {
    const s = await semear();
    if (process.env.SENHA_DEMO) {
      if (process.env.SENHA_DEMO.length < 8) throw new Error("SENHA_DEMO muito curta (minimo 8)");
      await criarContas(process.env.SENHA_DEMO, s);
      console.log(`contas criadas: ${LOGIN_M11} (11A) | ${LOGIN_M21} (21A) | ${LOGIN_ADM} (admin)`);
    }
    console.log("semeado (mantido). Para remover: npx tsx scripts/teste-morador.ts --limpar");
    console.log(`11A aguardando: ${s.k1.codigo} (2h17, prateleira A3) | ${s.k2.codigo} (4 dias, 2 fotos)`);
    console.log(`11A entregues: ${s.e1.codigo} (morador) | ${s.e2.codigo} (terceiro) | ${s.e3.codigo} (${s.anoAnterior})`);
    console.log(`11A cancelada: ${s.c1.codigo} | 21A aguardando: ${s.x1.codigo}`);
    return;
  }

  const senha = randomBytes(12).toString("base64url");
  let browser: Browser | null = null;
  try {
    const s = await semear();
    await criarContas(senha, s);
    browser = await abrirNavegador();
    await testar(browser, s, senha);
  } catch (e) {
    falhas++;
    total++;
    console.log(`FAIL execucao interrompida -> ${ascii(e instanceof Error ? (e.stack ?? e.message) : String(e))}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await limpar().catch((e) => {
      falhas++;
      console.log(`FAIL limpeza -> ${ascii(String(e))}`);
    });
    const resto = await prisma.encomenda.count({ where: { observacao: MARCA } });
    const restoU = await prisma.usuario.count({ where: { login: { in: [LOGIN_M11, LOGIN_M21, LOGIN_ADM] } } });
    ok(resto === 0 && restoU === 0, "limpeza: nenhum registro de teste ficou no banco", `encomendas=${resto} usuarios=${restoU}`);
    await prisma.$disconnect();
  }
  console.log(`\n${total - falhas}/${total} verificacoes passaram`);
  if (falhas > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(ascii(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
});

