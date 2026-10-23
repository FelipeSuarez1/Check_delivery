/**
 * Teste de fumaca da BASE (login, troca obrigatoria de senha, allowlist por papel,
 * cascas de cada area, turno). Roda contra o servidor ja no ar (dev ou start).
 *
 *   npx tsx scripts/cria-usuarios-teste.ts <senha>      # antes: admin-teste, portaria-teste, morador-teste
 *   SENHA_TESTE=<senha> npx tsx scripts/teste-base.ts [pasta-de-screenshots]
 *
 * TESTE_BASE (padrao http://localhost:3001). Exige ao menos 2 porteiros ativos
 * (scripts/cria-porteiros.ts). Cria e remove um usuario temporario (troca-teste).
 * Saida em ASCII; exit code 1 se algo falhar.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { Browser, BrowserContext, Page } from "playwright";
import { gerarHashSenha } from "../src/lib/senha";
import { abrirNavegador } from "./_navegador";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const SENHA = process.env.SENHA_TESTE ?? "";
const PASTA = process.argv[2];
const prisma = new PrismaClient();

let falhas = 0;
const problemasConsole: string[] = [];
function conferir(cond: boolean, msg: string) {
  if (cond) console.log(`  ok     ${msg}`);
  else {
    falhas++;
    console.log(`  FALHA  ${msg}`);
  }
}

async function novaSessao(browser: Browser, largura = 1180, altura = 820): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    // 404 de rota negada de proposito aparecem como "Failed to load resource" — ruido esperado
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problemasConsole.push(m.text());
  });
  page.on("pageerror", (e) => problemasConsole.push(`pageerror: ${e.message}`));
  return { ctx, page };
}

async function entrar(page: Page, login: string, senha: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.fill("#login", login);
  await page.fill("#senha", senha);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login") || u.searchParams.has("erro"), { timeout: 30_000 }),
    page.click("button[type=submit]"),
  ]);
  await page.waitForLoadState("load");
  await page.waitForTimeout(800); // hidratacao do React antes de interagir
}

/** Abre a rota e espera a hidratacao (o prefetch de rota inexistente impede o "networkidle" em producao). */
async function carregar(page: Page, rota: string) {
  await page.goto(`${BASE}${rota}`, { waitUntil: "load" });
  await page.waitForTimeout(800);
}

async function status(page: Page, rota: string): Promise<number> {
  const r = await page.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded" });
  return r?.status() ?? 0;
}

async function foto(page: Page, nome: string) {
  if (!PASTA) return;
  fs.mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: path.join(PASTA, `${nome}.png`), fullPage: true });
}

async function main() {
  if (SENHA.length < 8) throw new Error("defina SENHA_TESTE (a senha usada em cria-usuarios-teste.ts)");
  // parte sempre de "sem turno aberto" (so use contra o banco de desenvolvimento)
  await prisma.turno.updateMany({ where: { fim: null }, data: { fim: new Date() } });
  const browser = await abrirNavegador();

  // ---------------------------------------------------------------- sem sessao
  console.log("\n[sem sessao]");
  {
    const { ctx, page } = await novaSessao(browser);
    const r = await page.goto(`${BASE}/portaria`, { waitUntil: "load" });
    conferir(new URL(page.url()).pathname === "/login", `/portaria sem sessao vai para /login (${page.url()})`);
    conferir(r?.status() === 200, "tela de login responde 200");
    conferir((await page.locator("#login").count()) === 1 && (await page.locator("#senha").count()) === 1, "campos #login e #senha");
    conferir((await page.getByRole("heading", { name: /Encomendas · Espaço Tangará/ }).count()) === 1, "titulo da direcao");
    await foto(page, "login-1180");

    await entrar(page, "portaria-teste", SENHA + "x");
    conferir(new URL(page.url()).searchParams.get("erro") === "1", "senha errada volta com erro=1");
    conferir(await page.getByText("Usuário ou senha incorretos.").isVisible(), "mensagem de erro visivel");
    conferir((await page.locator("#login").inputValue()) === "portaria-teste", "login digitado preservado");
    conferir(!page.url().includes(SENHA), "senha nunca aparece na URL");
    await foto(page, "login-erro-1180");

    conferir((await status(page, "/sw.js")) === 200, "/sw.js publico");
    conferir((await status(page, "/manifest.webmanifest")) === 200, "/manifest.webmanifest publico");
    conferir((await status(page, "/icons/icon-192.png")) === 200, "/icons/icon-192.png publico");
    const m = await (await ctx.request.get(`${BASE}/manifest.webmanifest`)).json();
    conferir(m.display === "standalone" && m.start_url === "/" && m.icons.length === 3, "manifest standalone, start_url=/, 3 icones");
    await ctx.close();
  }

  // ------------------------------------------------------------------- portaria
  console.log("\n[portaria-teste]");
  {
    const { ctx, page } = await novaSessao(browser);
    await entrar(page, "portaria-teste", SENHA);
    conferir(new URL(page.url()).pathname === "/portaria", `login leva a /portaria (${new URL(page.url()).pathname})`);
    conferir((await page.locator("header").count()) >= 1, "cabecalho presente");
    for (const t of ["Aguardando", "Entregues hoje", "Histórico", "Espaço Tangará"]) {
      conferir((await page.locator("header").getByText(t, { exact: false }).count()) > 0, `cabecalho tem "${t}"`);
    }
    conferir(
      (await page.locator("header a[aria-current=page]").innerText()).startsWith("Aguardando"),
      "aba Aguardando ativa em /portaria"
    );
    await foto(page, "portaria-sem-turno-1180");

    // turno
    const chip = page.getByRole("button", { name: /Sem turno|Turno:/ });
    conferir(((await chip.innerText()) || "").includes("Sem turno"), "chip pede o porteiro quando nao ha turno");
    await chip.click();
    await page.getByRole("dialog").waitFor();
    await foto(page, "portaria-turno-dialog-1180");
    await page.getByRole("dialog").getByRole("button", { name: /^José/ }).click();
    await page.getByRole("button", { name: /Turno:/ }).waitFor({ timeout: 15_000 });
    const txt = await page.getByRole("button", { name: /Turno:/ }).innerText();
    conferir(/José/.test(txt) && /desde \d{2}:\d{2}/.test(txt), `chip mostra o turno (${txt.replace(/\s+/g, " ")})`);
    await foto(page, "portaria-com-turno-1180");

    // trocar de porteiro
    await page.getByRole("button", { name: /Turno:/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Marcos/ }).click();
    await page.getByRole("button", { name: /Turno:.*Marcos/ }).waitFor({ timeout: 15_000 });
    conferir(true, "troca de turno para Marcos");

    // abas
    await page.getByRole("link", { name: /Entregues hoje/ }).click();
    await page.waitForURL(/aba=hoje/);
    conferir((await page.locator("header a[aria-current=page]").innerText()).startsWith("Entregues hoje"), "aba Entregues hoje ativa");
    // (a tela /portaria/historico e construida na onda seguinte: aqui so o link)
    conferir(
      (await page.getByRole("link", { name: /Histórico/ }).getAttribute("href")) === "/portaria/historico",
      "aba Histórico aponta para /portaria/historico"
    );

    // encerra o turno
    await carregar(page, "/portaria");
    await page.getByRole("button", { name: /Turno:/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Encerrar turno" }).click();
    await page.getByRole("button", { name: /Sem turno/ }).waitFor({ timeout: 15_000 });
    conferir(true, "turno encerrado");

    // allowlist
    for (const rota of ["/admin", "/admin/logs", "/app", "/app/historico", "/app/conta"]) {
      conferir((await status(page, rota)) === 404, `${rota} = 404 para a portaria`);
    }
    conferir((await status(page, "/sw.jsx")) === 404, "/sw.jsx nao escapa do porteiro (404 para papel logado)");

    // sair
    await carregar(page, "/portaria");
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL(/\/login/);
    conferir(new URL(page.url()).pathname === "/login", "Sair volta ao /login");
    await page.goto(`${BASE}/portaria`, { waitUntil: "domcontentloaded" });
    conferir(new URL(page.url()).pathname === "/login", "depois de sair /portaria volta ao login");
    await ctx.close();
  }

  // -------------------------------------------------------------------- morador
  console.log("\n[morador-teste]");
  {
    const { ctx, page } = await novaSessao(browser, 390, 844);
    await entrar(page, "morador-teste", SENHA);
    conferir(new URL(page.url()).pathname === "/app", `login leva a /app (${new URL(page.url()).pathname})`);
    const nav = page.locator("nav[aria-label='Navegação do morador']");
    conferir((await nav.getByText("Na portaria").count()) === 1, "nav: Na portaria");
    conferir((await nav.getByText("Histórico").count()) === 1, "nav: Histórico");
    conferir((await nav.getByText("Apto 11A").count()) === 1, "nav: Apto 11A");
    conferir((await nav.locator("a[aria-current=page]").innerText()).includes("Na portaria"), "item ativo = Na portaria");
    const caixa = await nav.boundingBox();
    conferir(!!caixa && caixa.width <= 391, `nav com largura util de 390 (${caixa?.width})`);
    await foto(page, "morador-390");
    for (const rota of ["/portaria", "/portaria/registrar", "/admin", "/admin/usuarios", "/etiqueta/ABCD"]) {
      conferir((await status(page, rota)) === 404, `${rota} = 404 para o morador`);
    }
    await carregar(page, "/app");
    await page.locator("nav[aria-label='Navegação do morador']").getByText("Apto 11A").click();
    await page.waitForURL(/\/app\/conta/);
    conferir(true, "item Apto 11A leva a /app/conta");
    await ctx.close();
  }

  // ---------------------------------------------------------------------- admin
  console.log("\n[admin-teste]");
  {
    const { ctx, page } = await novaSessao(browser);
    await entrar(page, "admin-teste", SENHA);
    conferir(new URL(page.url()).pathname === "/admin", `login leva a /admin (${new URL(page.url()).pathname})`);
    for (const t of ["Painel", "Moradores", "Porteiros", "Usuários", "Exportar", "Logs", "Ir para a portaria", "Sair"]) {
      conferir((await page.locator("header").getByText(t, { exact: true }).count()) > 0, `barra admin tem "${t}"`);
    }
    await foto(page, "admin-1180");
    conferir((await status(page, "/portaria")) === 200, "/portaria = 200 para o admin");
    conferir((await status(page, "/app")) === 200, "/app = 200 para o admin");
    await ctx.close();
  }

  // ------------------------------------------------------------ login: seguranca
  console.log("\n[login: limite de tentativas e ?next=]");
  {
    const { ctx, page } = await novaSessao(browser);
    // 5 erros seguidos do mesmo login+origem -> bloqueio de 1 min (erro=2)
    let ultimo = "";
    for (let i = 0; i < 7; i++) {
      await entrar(page, "limite-teste", "senha-errada-" + i);
      ultimo = new URL(page.url()).searchParams.get("erro") ?? "";
    }
    conferir(ultimo === "2", `apos varias falhas o login e bloqueado (erro=${ultimo})`);
    // o bloqueio e por login+origem: outro login da mesma origem segue livre
    await entrar(page, "portaria-teste", SENHA);
    conferir(new URL(page.url()).pathname === "/portaria", "outro login nao e afetado pelo bloqueio");
    await ctx.close();

    // ?next= so aceita caminho interno do proprio papel
    for (const [next, esperado] of [
      ["//evil.example.com", "/portaria"],
      ["/\\evil.example.com", "/portaria"],
      ["https://evil.example.com/x", "/portaria"],
      ["/admin", "/portaria"], // papel sem acesso -> tela inicial do papel
    ] as const) {
      const s = await novaSessao(browser);
      await s.page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`, { waitUntil: "load" });
      await s.page.fill("#login", "portaria-teste");
      await s.page.fill("#senha", SENHA);
      await Promise.all([
        s.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
        s.page.click("button[type=submit]"),
      ]);
      const u = new URL(s.page.url());
      conferir(u.origin === BASE && u.pathname === esperado, `next=${next} -> ${u.origin}${u.pathname}`);
      await s.ctx.close();
    }
    // destino legitimo e preservado
    {
      const s = await novaSessao(browser);
      await s.page.goto(`${BASE}/portaria/historico`, { waitUntil: "load" });
      conferir(new URL(s.page.url()).searchParams.get("next") === "/portaria/historico", "sem sessao guarda o destino em ?next=");
      await s.page.fill("#login", "portaria-teste");
      await s.page.fill("#senha", SENHA);
      await Promise.all([
        s.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
        s.page.click("button[type=submit]"),
      ]);
      conferir(new URL(s.page.url()).pathname === "/portaria/historico", "depois do login volta ao destino guardado");
      await s.ctx.close();
    }
  }

  // -------------------------------------------------- sessao derrubada no banco
  console.log("\n[sessao derrubada: desativada / senha trocada]");
  {
    const login = "morador-teste";
    const { ctx, page } = await novaSessao(browser, 390, 844);
    await entrar(page, login, SENHA);
    conferir(new URL(page.url()).pathname === "/app", "sessao do morador aberta");
    try {
      await prisma.usuario.update({ where: { login }, data: { ativo: false } });
      await carregar(page, "/app");
      conferir(await page.getByRole("heading", { name: "Acesso desativado" }).isVisible(), "conta desativada -> 'Acesso desativado'");
      conferir((await page.locator("nav[aria-label='Navegação do morador']").count()) === 0, "sem casca do morador na tela de desativado");
      await foto(page, "acesso-desativado-390");
      await prisma.usuario.update({ where: { login }, data: { ativo: true } });
      await carregar(page, "/app");
      conferir(await page.locator("nav[aria-label='Navegação do morador']").isVisible(), "reativada: volta a abrir");

      // senha trocada por fora (ex.: admin redefiniu) derruba as sessoes abertas
      const { hash, salt } = gerarHashSenha(SENHA);
      await prisma.usuario.update({ where: { login }, data: { senhaHash: hash, senhaSalt: salt } });
      await carregar(page, "/app");
      conferir(await page.getByRole("heading", { name: "Sessão encerrada" }).isVisible(), "senha trocada -> 'Sessão encerrada'");
      await page.getByRole("button", { name: "Ir para o login" }).click();
      await page.waitForURL(/\/login/);
      conferir(new URL(page.url()).pathname === "/login", "botao leva ao login (cookie removido)");
    } finally {
      await prisma.usuario.update({ where: { login }, data: { ativo: true } });
    }
    await ctx.close();
  }

  // ------------------------------------------- sessao some com a tela aberta
  console.log("\n[sessao expirada com a tela aberta]");
  {
    const { ctx, page } = await novaSessao(browser);
    await entrar(page, "portaria-teste", SENHA);
    await page.getByRole("button", { name: /Sem turno|Turno:/ }).click();
    await page.getByRole("dialog").waitFor();
    await ctx.clearCookies(); // como se o cookie de 30 dias tivesse vencido
    await page.getByRole("dialog").getByRole("button", { name: /^José/ }).click();
    await page.waitForTimeout(2500);
    const msg = await page.getByRole("alert").first().innerText().catch(() => "");
    const noLogin = new URL(page.url()).pathname === "/login";
    conferir(
      /sess[aã]o pode ter expirado/.test(msg) || noLogin,
      `action sem sessao nao quebra a tela (alerta="${msg.slice(0, 50)}", url=${new URL(page.url()).pathname})`
    );
    const abertos = await prisma.turno.count({ where: { fim: null } });
    conferir(abertos === 0, "nenhum turno foi aberto sem sessao");
    await ctx.close();
  }

  // ------------------------------------------------- primeiro acesso (troca forcada)
  console.log("\n[primeiro acesso]");
  {
    const login = "troca-teste";
    const inicial = "inicial" + Math.floor(Math.random() * 1e6);
    const nova = "nova-" + Math.random().toString(36).slice(2, 10);
    const apto = await prisma.apartamento.findUnique({ where: { numero: "11A" } });
    if (!apto) throw new Error("apartamento 11A nao existe");
    const { hash, salt } = gerarHashSenha(inicial);
    await prisma.usuario.upsert({
      where: { login },
      create: { login, nome: "Troca Teste", papel: "morador", apartamentoId: apto.id, senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: true },
      update: { senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: true, ativo: true },
    });
    try {
      const { ctx, page } = await novaSessao(browser, 390, 844);
      await entrar(page, login, inicial);
      conferir(new URL(page.url()).pathname === "/conta/senha", `login cai em /conta/senha (${new URL(page.url()).pathname})`);
      conferir(await page.getByText("É o seu primeiro acesso").isVisible(), "aviso de primeiro acesso");
      await foto(page, "troca-senha-390");
      // tentar fugir da tela
      await carregar(page, "/app");
      conferir(new URL(page.url()).pathname === "/conta/senha", "/app redireciona de volta para /conta/senha");

      // senha atual errada
      await page.fill("#atual", inicial + "x");
      await page.fill("#nova", nova);
      await page.fill("#confirmacao", nova);
      await page.getByRole("button", { name: "Salvar nova senha" }).click();
      await page.getByText("Senha atual incorreta").waitFor({ timeout: 15_000 });
      conferir(true, "senha atual errada e recusada");

      // nova curta / obvia
      await page.fill("#atual", inicial);
      await page.fill("#nova", "curta");
      await page.fill("#confirmacao", "curta");
      await page.getByRole("button", { name: "Salvar nova senha" }).click();
      conferir(await page.getByText("pelo menos 8 caracteres").isVisible(), "senha curta e recusada");
      await page.fill("#nova", "12345678");
      await page.fill("#confirmacao", "12345678");
      await page.getByRole("button", { name: "Salvar nova senha" }).click();
      await page.getByText("menos óbvia").waitFor({ timeout: 15_000 });
      conferir(true, "senha obvia e recusada");

      // sucesso
      await page.fill("#nova", nova);
      await page.fill("#confirmacao", nova);
      await Promise.all([
        page.waitForURL((u) => u.pathname === "/app", { timeout: 30_000 }),
        page.getByRole("button", { name: "Salvar nova senha" }).click(),
      ]);
      conferir(new URL(page.url()).pathname === "/app", "troca concluida leva a /app");
      const u = await prisma.usuario.findUnique({ where: { login } });
      conferir(u?.precisaTrocarSenha === false, "precisaTrocarSenha=false no banco");
      conferir((await status(page, "/app")) === 200, "sessao segue valida apos a troca (cookie reemitido)");
      await ctx.close();

      // a senha antiga nao serve mais; a nova serve
      const outro = await novaSessao(browser, 390, 844);
      await entrar(outro.page, login, inicial);
      conferir(new URL(outro.page.url()).searchParams.get("erro") === "1", "senha inicial deixou de valer");
      await entrar(outro.page, login, nova);
      conferir(new URL(outro.page.url()).pathname === "/app", "senha nova entra direto em /app");
      await outro.ctx.close();
    } finally {
      const u = await prisma.usuario.findUnique({ where: { login } });
      if (u) {
        await prisma.logEvento.updateMany({ where: { usuarioId: u.id }, data: { usuarioId: null } });
        await prisma.usuario.delete({ where: { id: u.id } });
      }
    }
  }

  await browser.close();
  if (problemasConsole.length) {
    console.log("\nERROS DE CONSOLE:");
    for (const p of new Set(problemasConsole)) console.log("  - " + p);
  }
  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  if (falhas > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
