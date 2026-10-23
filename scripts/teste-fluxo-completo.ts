/**
 * FLUXO INTEGRADO de ponta a ponta (23/10/2026) - Playwright, 4 sessoes reais, auto-reversivel.
 *
 *   1. portaria abre o turno (se nao ha) e registra uma encomenda para o 11A com FOTO real;
 *   2. morador-teste (11A, celular 390x844) ve o card em "Na portaria", abre o codigo/QR e a foto
 *      carrega (200, image/*, Cache-Control private, no-store);
 *   3. morador de OUTRO apto (zz-morador-21a, criado aqui) nao ve nada: lista vazia, codigo = 404,
 *      foto = 404 - conferido ENQUANTO aguarda e de novo DEPOIS de entregue;
 *   4. admin-teste ve a encomenda no painel (contador + ultimos eventos), no historico do 11A e no
 *      CSV (`apto=11A` traz so ela; `apto=21B` e o periodo inteiro mostram o contraste);
 *   5. portaria confirma a retirada PELO CODIGO (campo digitado) para um morador do apto;
 *   6. morador ve "retirada por ..." no historico e a encomenda sai de "Na portaria";
 *   7. admin ve os eventos (registro + retirada) em /admin/logs.
 * Ao final apaga TUDO que criou: encomendas (com fotos + arquivos), conta zz-morador-21a, eventos
 * do livro gerados pelo roteiro e o turno que ele mesmo abriu.
 *
 * Como rodar (servidor de TESTE com banco COPIADO; servidor e script no MESMO banco e na MESMA pasta,
 * porque a foto fica em uploads/ relativo ao cwd):
 *   npx tsx scripts/cria-usuarios-teste.ts <senha>      # admin-teste, portaria-teste, morador-teste (11A)
 *   DATABASE_URL=file:<abs>/prisma/dev.db TESTE_BASE=http://localhost:3090 SENHA_TESTE=<senha> \
 *     [FOTO=<png/jpg>] [PASTA=<pasta de screenshots>] npx tsx scripts/teste-fluxo-completo.ts
 * Nunca fala com o WhatsApp de verdade (wa.me abortado). Saida em ASCII; exit 1 se algum passo falhar.
 */
import fs from "node:fs";
import path from "node:path";
import { unlink } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright";
import { prisma } from "../src/lib/db";
import { diaLocalISO } from "../src/lib/datas";
import { caminhoFoto } from "../src/lib/fotos";
import { gerarHashSenha } from "../src/lib/senha";
import { abrirNavegador } from "./_navegador";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const SENHA = process.env.SENHA_TESTE ?? "";
const FOTO = process.env.FOTO ?? path.join(process.cwd(), "public", "icons", "icon-512.png");
const PASTA = process.env.PASTA ?? "";
const MARCA = "[TESTE-FLUXO]";
const LOGIN_21A = "zz-morador-21a";
const LOGINS = ["portaria-teste", "morador-teste", "admin-teste", LOGIN_21A];

let total = 0;
let falhas = 0;
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
async function passo(nome: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    console.log(`PASS ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`FAIL ${nome} -> ${ascii(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
}
function esperar(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
async function foto(page: Page, nome: string) {
  if (!PASTA) return;
  fs.mkdirSync(PASTA, { recursive: true });
  await page
    .waitForFunction(() => Array.from(document.images).every((i) => i.complete), undefined, { timeout: 8000 })
    .catch(() => undefined);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(PASTA, `${nome}.png`), fullPage: true });
}

async function entrar(page: Page, login: string) {
  await page.goto(`${BASE}/login`);
  await page.fill("#login", login);
  await page.fill("#senha", SENHA);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }), page.click("button[type=submit]")]);
}

/** Todas as <img> da pagina que apontam para /fotos/... terminaram de carregar com largura > 0. */
async function fotosCarregaram(page: Page): Promise<number> {
  await page
    .waitForFunction(() => Array.from(document.images).filter((i) => i.src.includes("/fotos/")).every((i) => i.complete), undefined, { timeout: 10_000 })
    .catch(() => undefined);
  return page.evaluate(() => Array.from(document.images).filter((i) => i.src.includes("/fotos/") && i.complete && i.naturalWidth > 0).length);
}

async function apagarDoTeste() {
  const encs = await prisma.encomenda.findMany({ where: { observacao: MARCA }, select: { id: true } });
  const ids = encs.map((e) => e.id);
  const fotos = await prisma.fotoEncomenda.findMany({ where: { encomendaId: { in: ids } } });
  for (const f of fotos) await unlink(caminhoFoto(f)).catch(() => undefined);
  await prisma.fotoEncomenda.deleteMany({ where: { encomendaId: { in: ids } } });
  await prisma.encomenda.deleteMany({ where: { id: { in: ids } } });
}
async function remover21A() {
  const u = await prisma.usuario.findUnique({ where: { login: LOGIN_21A }, select: { id: true } });
  if (!u) return;
  await prisma.logEvento.deleteMany({ where: { usuarioId: u.id } });
  await prisma.pushInscricao.deleteMany({ where: { usuarioId: u.id } });
  await prisma.usuario.delete({ where: { id: u.id } });
}

async function main() {
  if (SENHA.length < 8) throw new Error("defina SENHA_TESTE (a senha de cria-usuarios-teste.ts, >= 8 caracteres)");
  for (const login of ["admin-teste", "portaria-teste", "morador-teste"]) {
    const u = await prisma.usuario.findUnique({ where: { login }, select: { ativo: true } });
    if (!u?.ativo) throw new Error(`conta ${login} ausente/inativa - rode: npx tsx scripts/cria-usuarios-teste.ts <senha>`);
  }
  const t0 = new Date();
  const antes = {
    enc: await prisma.encomenda.count(),
    fotos: await prisma.fotoEncomenda.count(),
    usu: await prisma.usuario.count(),
    turnosIds: new Set((await prisma.turno.findMany({ select: { id: true } })).map((t) => t.id)),
    turnoAberto: await prisma.turno.findFirst({ where: { fim: null }, select: { id: true } }),
  };
  await apagarDoTeste();
  await remover21A();
  const apto21 = await prisma.apartamento.findUnique({ where: { numero: "21A" }, select: { id: true } });
  const apto11 = await prisma.apartamento.findUnique({ where: { numero: "11A" }, select: { id: true } });
  const apto21B = await prisma.apartamento.findUnique({ where: { numero: "21B" }, select: { id: true } });
  if (!apto21 || !apto11 || !apto21B) throw new Error("aptos 11A/21A/21B nao existem no banco de teste");
  const { hash, salt } = gerarHashSenha(SENHA);
  await prisma.usuario.create({
    data: { login: LOGIN_21A, nome: "Apto 21A (teste fluxo)", papel: "morador", apartamentoId: apto21.id, senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: false, ativo: true },
  });

  const browser = await abrirNavegador();
  const erros: string[] = [];
  const observar = (page: Page, quem: string) => {
    page.on("console", (m) => {
      if (m.type() === "error" && !/status of 404|Failed to load resource/.test(m.text())) erros.push(`${quem}: ${m.text()}`);
    });
    page.on("pageerror", (e) => erros.push(`${quem} pageerror: ${e.message}`));
    page.on("dialog", (d) => d.dismiss().catch(() => undefined));
  };
  const abrir = async (largura: number, altura: number, quem: string): Promise<{ ctx: BrowserContext; page: Page }> => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
    await ctx.route(/^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//, (r) => r.abort());
    const page = await ctx.newPage();
    observar(page, quem);
    return { ctx, page };
  };

  const portaria = await abrir(1180, 820, "portaria");
  const morador = await abrir(390, 844, "morador11A");
  const outro = await abrir(390, 844, "morador21A");
  const admin = await abrir(1280, 900, "admin");

  let codigo = "";
  let fotoId = 0;
  let turnoAbertoPeloTeste = false;
  let aguardandoAntes = 0;
  const hoje = diaLocalISO(new Date());

  try {
    await passo("login real das 4 sessoes (portaria, morador 11A, morador 21A, admin)", async () => {
      await entrar(portaria.page, "portaria-teste");
      await entrar(morador.page, "morador-teste");
      await entrar(outro.page, LOGIN_21A);
      await entrar(admin.page, "admin-teste");
      esperar(portaria.page.url().endsWith("/portaria"), `portaria caiu em ${portaria.page.url()}`);
      esperar(morador.page.url().endsWith("/app"), `morador caiu em ${morador.page.url()}`);
      esperar(outro.page.url().endsWith("/app"), `morador 21A caiu em ${outro.page.url()}`);
      esperar(admin.page.url().endsWith("/admin"), `admin caiu em ${admin.page.url()}`);
    });

    await passo("portaria: abre o turno quando nao ha turno aberto", async () => {
      const p = portaria.page;
      await p.goto(`${BASE}/portaria`);
      const faixa = p.getByText("Abra o turno para registrar e entregar");
      if ((await faixa.count()) === 0) {
        console.log("  (ja havia turno aberto - usando o existente)");
        return;
      }
      await p.getByRole("button", { name: "Abrir turno" }).first().click();
      await p.getByRole("button", { name: /^Marcos|^José/ }).first().click();
      await faixa.waitFor({ state: "detached", timeout: 15_000 });
      turnoAbertoPeloTeste = true;
      esperar((await prisma.turno.count({ where: { fim: null } })) === 1, "turno nao ficou aberto no banco");
    });

    // contraste para o filtro apto= do CSV (outro apto, mesmo periodo; nao e o 21A, que precisa ficar vazio)
    await prisma.encomenda.create({
      data: {
        codigo: "ZZ8Z",
        apartamentoId: apto21B.id,
        destinatarioNome: "Contraste CSV",
        tipo: "caixa",
        transportadora: "Amazon",
        observacao: MARCA,
        recebidaPorPorteiroId: (await prisma.porteiro.findFirstOrThrow({ select: { id: true } })).id,
      },
    }).catch(() => undefined);

    await passo("portaria: registra encomenda para o 11A com foto real e gera o codigo", async () => {
      aguardandoAntes = await prisma.encomenda.count({ where: { status: "aguardando" } });
      const p = portaria.page;
      await p.goto(`${BASE}/portaria/registrar`);
      await p.setInputFiles('input[type="file"]', FOTO);
      await p.waitForSelector('img[alt="Foto 1 da encomenda"]', { timeout: 15_000 });
      await p.getByRole("radio", { name: "Torre A" }).click();
      await p.fill("#numero-apto", "11");
      await p.locator("#campo-dest button[aria-pressed]").first().click();
      await p.locator("#campo-tipo").getByRole("button", { name: "Caixa" }).click();
      await p.getByRole("button", { name: "Mercado Livre", exact: true }).click();
      await p.fill("#local-guardado", "Prateleira A3 (fluxo)");
      await p.fill("#observacao-encomenda", MARCA);
      await p.getByRole("button", { name: "Salvar e gerar código" }).click();
      await p.waitForSelector('section[aria-label="Código da encomenda"]', { timeout: 30_000 });
      const t = (await p.locator('section[aria-label="Código da encomenda"] span[aria-hidden="true"]').first().innerText()).trim();
      esperar(/^[A-Z2-9]{4}$/.test(t), `codigo invalido na tela: ${t}`);
      codigo = t;
      const reg = await prisma.encomenda.findUnique({ where: { codigo }, include: { fotos: true, apartamento: true } });
      esperar(!!reg && reg.apartamento.numero === "11A" && reg.status === "aguardando" && reg.fotos.length === 1, "registro no banco incompleto");
      fotoId = reg!.fotos[0].id;
      await foto(p, "fluxo-1-codigo-gerado");
    });

    await passo("morador 11A: ve o card em 'Na portaria' com a foto carregada", async () => {
      const p = morador.page;
      await p.goto(`${BASE}/app`);
      const card = p.locator(`article[aria-label="Encomenda ${codigo}"]`);
      await card.waitFor({ timeout: 15_000 });
      await p.getByText(/\d+ encomendas? na portaria/).first().waitFor();
      esperar(/Mercado Livre/.test(await card.innerText()), "card sem a transportadora");
      esperar((await fotosCarregaram(p)) >= 1, "foto do card nao carregou");
      await foto(p, "fluxo-2-morador-na-portaria");
    });

    await passo("morador 11A: abre o codigo, ve o QR e a foto ampliavel carrega (200, image, private no-store)", async () => {
      const p = morador.page;
      await p.locator(`article[aria-label="Encomenda ${codigo}"]`).getByRole("link", { name: /Mostrar ao porteiro/ }).click();
      await p.waitForURL(new RegExp(`/app/encomenda/${codigo}$`), { timeout: 15_000 });
      await p.locator(`svg[role="img"][aria-label="QR code da encomenda ${codigo}"]`).waitFor({ timeout: 10_000 });
      esperar((await p.getByText(codigo).count()) >= 1, "codigo nao aparece na tela");
      esperar((await fotosCarregaram(p)) >= 1, "foto da tela do codigo nao carregou");
      const r = await morador.ctx.request.get(`${BASE}/fotos/${fotoId}`);
      esperar(r.status() === 200 && /^image\//.test(r.headers()["content-type"] ?? ""), `foto: status ${r.status()} ${r.headers()["content-type"]}`);
      esperar(r.headers()["cache-control"] === "private, no-store", `cache-control ${r.headers()["cache-control"]}`);
      await foto(p, "fluxo-3-morador-codigo-qr");
    });

    const isolamento = async (fase: string) => {
      const p = outro.page;
      await p.goto(`${BASE}/app`);
      await p.getByText("Nenhuma encomenda na portaria").waitFor({ timeout: 15_000 });
      esperar((await p.getByText(codigo).count()) === 0, `${fase}: o codigo apareceu em /app do 21A`);
      esperar((await p.locator(`article[aria-label^="Encomenda"]`).count()) === 0, `${fase}: card de encomenda no 21A`);
      await p.goto(`${BASE}/app/historico`);
      await p.waitForLoadState("networkidle").catch(() => undefined);
      esperar((await p.getByText(codigo).count()) === 0, `${fase}: o codigo apareceu no historico do 21A`);
      const rp = await outro.ctx.request.get(`${BASE}/app/encomenda/${codigo}`);
      esperar(rp.status() === 404, `${fase}: /app/encomenda/${codigo} = ${rp.status()} (esperado 404)`);
      esperar(!(await rp.text()).includes("Mercado Livre"), `${fase}: corpo do 404 traz dado da encomenda`);
      const rf = await outro.ctx.request.get(`${BASE}/fotos/${fotoId}`);
      esperar(rf.status() === 404, `${fase}: /fotos/${fotoId} = ${rf.status()} (esperado 404)`);
      esperar(!/^image\//.test(rf.headers()["content-type"] ?? ""), `${fase}: foto vazou com content-type de imagem`);
    };
    await passo("morador de OUTRO apto (21A) enquanto AGUARDA: lista vazia, codigo = 404, foto = 404", () => isolamento("aguardando"));

    await passo("admin: ve a encomenda no painel (contador sobe e o evento de registro aparece)", async () => {
      const p = admin.page;
      await p.goto(`${BASE}/admin`);
      await p.getByTestId("aguardando-total").waitFor();
      const n = Number((await p.getByTestId("aguardando-total").innerText()).trim());
      const noBanco = await prisma.encomenda.count({ where: { status: "aguardando" } });
      esperar(n === noBanco && n >= aguardandoAntes + 1, `contador ${n}, banco ${noBanco}, antes ${aguardandoAntes}`);
      await p.getByText(new RegExp(`Registrada ${codigo} · 11A`)).first().waitFor({ timeout: 10_000 });
      await foto(p, "fluxo-4-admin-painel");
    });

    await passo("admin: ve a encomenda no historico do 11A (portaria/historico/11A)", async () => {
      const p = admin.page;
      await p.goto(`${BASE}/portaria/historico/11A`);
      await p.getByRole("heading", { name: /Apto 11A/ }).waitFor();
      await p.getByText(codigo).first().waitFor({ timeout: 10_000 });
    });

    await passo("admin: CSV com apto=11A traz so a encomenda do 11A (e o periodo inteiro traz tambem a do 21B)", async () => {
      const csvDe = async (qs: string) => {
        const r = await admin.ctx.request.get(`${BASE}/admin/exportar/csv?de=${hoje}&ate=${hoje}${qs}`);
        esperar(r.status() === 200 && /^text\/csv/.test(r.headers()["content-type"] ?? ""), `csv ${qs}: status ${r.status()} ${r.headers()["content-type"]}`);
        const linhas = (await r.text()).replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, "")));
        esperar(linhas[0][0] === "Código" && linhas[0][1] === "Apto", `cabecalho inesperado: ${linhas[0].slice(0, 3).join("|")}`);
        return linhas.slice(1);
      };
      const so11A = await csvDe("&apto=11A");
      esperar(so11A.length >= 1 && so11A.every((l) => l[1] === "11A"), `apto=11A trouxe aptos: ${[...new Set(so11A.map((l) => l[1]))].join(",")}`);
      esperar(so11A.some((l) => l[0] === codigo), "a encomenda registrada nao esta no CSV do 11A");
      const esperadas = await prisma.encomenda.count({ where: { apartamentoId: apto11.id, recebidaEm: { gte: new Date(`${hoje}T00:00:00-03:00`), lt: new Date(Date.parse(`${hoje}T00:00:00-03:00`) + 86_400_000) } } });
      esperar(so11A.length === esperadas, `linhas ${so11A.length} != encomendas do 11A hoje no banco ${esperadas}`);
      const so21A = await csvDe("&apto=21A");
      esperar(!so21A.some((l) => l[0] === codigo), "CSV do 21A trouxe a encomenda do 11A");
      const todas = await csvDe("");
      esperar(todas.some((l) => l[0] === codigo) && todas.some((l) => l[1] === "21B"), "CSV sem filtro nao trouxe 11A e 21B");
    });

    await passo("portaria: confirma a retirada pelo CODIGO digitado (morador do apto)", async () => {
      const p = portaria.page;
      await p.goto(`${BASE}/portaria/retirada`);
      await p.fill("#codigo-retirada", codigo);
      await p.getByText("Quem está retirando?").waitFor({ timeout: 15_000 });
      await p.locator("#quem-retira button[aria-pressed]").first().click();
      await foto(p, "fluxo-5-portaria-retirada");
      await p.getByRole("button", { name: "Confirmar entrega" }).click();
      await p.getByRole("heading", { name: "Entregue" }).waitFor({ timeout: 20_000 });
      const reg = await prisma.encomenda.findUnique({ where: { codigo }, include: { retiradaPorMorador: true, entreguePorPorteiro: true } });
      esperar(reg?.status === "entregue" && !!reg.retiradaPorMorador && !!reg.entreguePorPorteiro && !!reg.entregueEm, "entrega nao gravada como esperado");
    });

    let nomeRetirou = "";
    await passo("morador 11A: nao ve mais em 'Na portaria' e o historico diz 'retirada por ...'", async () => {
      const reg = await prisma.encomenda.findUnique({ where: { codigo }, include: { retiradaPorMorador: true } });
      nomeRetirou = reg!.retiradaPorMorador!.nome;
      const p = morador.page;
      await p.goto(`${BASE}/app`);
      await p.getByText("Nenhuma encomenda na portaria").waitFor({ timeout: 15_000 });
      esperar((await p.locator(`article[aria-label="Encomenda ${codigo}"]`).count()) === 0, "o card continua em Na portaria");
      await p.goto(`${BASE}/app/historico`);
      const item = p.locator(`a[href="/app/encomenda/${codigo}"]`);
      await item.waitFor({ timeout: 10_000 });
      const txt = await item.innerText();
      esperar(/retirada por/i.test(txt), `item do historico sem 'retirada por': ${txt.replace(/\s+/g, " ")}`);
      esperar(txt.toLowerCase().includes(nomeRetirou.split(" ")[0].toLowerCase()), `item nao cita ${nomeRetirou}: ${txt.replace(/\s+/g, " ")}`);
      await foto(p, "fluxo-6-morador-historico-retirada");
      await p.goto(`${BASE}/app/encomenda/${codigo}`);
      await p.getByText(/já foi entregue/).first().waitFor({ timeout: 10_000 });
    });

    await passo("morador de OUTRO apto (21A) DEPOIS de entregue: continua sem ver nada (lista, codigo e foto)", () => isolamento("entregue"));

    await passo("admin: /admin/logs mostra o registro e a retirada da encomenda", async () => {
      const p = admin.page;
      await p.goto(`${BASE}/admin/logs?q=${codigo}`);
      await p.getByText(new RegExp(`Registrada ${codigo} · 11A`)).first().waitFor({ timeout: 10_000 });
      await p.getByText(new RegExp(`Retirada ${codigo} · 11A · retirou`)).first().waitFor({ timeout: 10_000 });
      await foto(p, "fluxo-7-admin-logs");
      const ev = await prisma.logEvento.findMany({ where: { detalhe: { contains: codigo } }, select: { tipo: true } });
      esperar(ev.some((e) => e.tipo === "encomenda") && ev.some((e) => e.tipo === "retirada"), `tipos no banco: ${ev.map((e) => e.tipo).join(",")}`);
    });

    await passo("sem erros de console/pagina nas 4 sessoes durante o fluxo", async () => {
      esperar(erros.length === 0, erros.slice(0, 3).join(" || "));
    });
  } finally {
    await browser.close();
    // ---- limpeza: tudo que o roteiro criou
    await apagarDoTeste();
    await remover21A();
    const novosUsuarios = await prisma.usuario.findMany({ where: { login: { in: LOGINS } }, select: { id: true } });
    await prisma.logEvento.deleteMany({ where: { usuarioId: { in: novosUsuarios.map((u) => u.id) }, criadoEm: { gte: t0 } } });
    const turnosNovos = (await prisma.turno.findMany({ select: { id: true } })).filter((t) => !antes.turnosIds.has(t.id));
    if (turnoAbertoPeloTeste || turnosNovos.length) await prisma.turno.deleteMany({ where: { id: { in: turnosNovos.map((t) => t.id) } } });
    await passo("limpeza: contagens (encomendas, fotos, usuarios, turnos) voltaram as do inicio", async () => {
      const dep = {
        enc: await prisma.encomenda.count(),
        fotos: await prisma.fotoEncomenda.count(),
        usu: await prisma.usuario.count(),
        turnoAberto: await prisma.turno.findFirst({ where: { fim: null }, select: { id: true } }),
      };
      esperar(dep.enc === antes.enc && dep.fotos === antes.fotos && dep.usu === antes.usu && (dep.turnoAberto?.id ?? 0) === (antes.turnoAberto?.id ?? 0), JSON.stringify({ antes: { enc: antes.enc, fotos: antes.fotos, usu: antes.usu }, dep }));
    });
  }

  console.log(`\nCodigo usado: ${codigo || "-"}${turnoAbertoPeloTeste ? " (turno aberto e removido por este roteiro)" : ""}`);
  console.log(`${total - falhas}/${total} passos ok`);
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(ascii(e instanceof Error ? e.message : String(e)));
  await prisma.$disconnect();
  process.exit(1);
});
