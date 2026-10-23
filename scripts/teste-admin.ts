/**
 * Teste da AREA ADMINISTRATIVA (23/10/2026) - auto-reversivel. Playwright contra o
 * servidor no ar + as ACTIONS chamadas em processo (guardas e regras, sem depender da UI).
 *
 *   npx tsx scripts/cria-usuarios-teste.ts <senha>        # antes: admin-teste, portaria-teste, morador-teste
 *   SENHA_TESTE=<senha> TESTE_BASE=http://localhost:3013 npx tsx scripts/teste-admin.ts [pasta-de-screenshots]
 *
 * ATENCAO: o servidor (TESTE_BASE) e este script PRECISAM usar o MESMO banco (mesmo DATABASE_URL).
 * Recomendado: servidor de teste com uma COPIA do banco. Cria e apaga porteiro, moradores,
 * usuarios, apartamento e encomendas de teste (marca "zz..." no nome) e os eventos do livro que
 * eles e as contas de teste geraram; ao final confere que as contagens voltaram as do inicio.
 * Parte 1: actions em processo (next/headers trocado por um stub e sessao = token HMAC real).
 * Parte 2: Playwright - rotas por papel, painel, cadastros, usuarios, exportacao, logs.
 * Saida em ASCII; exit code 1 se algo falhar.
 */
import Module from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type { Browser, BrowserContext, Page } from "playwright";
import { abrirNavegador } from "./_navegador";
import { versaoSenha } from "../src/lib/senha";
import { assinarSessao, COOKIE_SESSAO } from "../src/lib/sessao-token";
import { DIA_MS, diaLocalISO, formatarDataHoraCompleta, inicioDoDiaLocal, somarDiasLocal } from "../src/lib/datas";
import {
  celulaCsv,
  formatarDuracao,
  formatarTelefone,
  mascararTelefone,
  montarCsv,
  normalizarTelefone,
  resumirUserAgent,
} from "../src/lib/admin-formato";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const SENHA = process.env.SENHA_TESTE ?? "";
const PASTA = process.argv[2];
const MARCA = "zz" + Math.random().toString(36).slice(2, 7);

// ----------------------------------------------------------- stub do next/*
process.env.AUTH_SECRET = `teste-admin-${Math.random().toString(36).slice(2)}-segredo-longo-de-teste`;
let tokenAtual = "";
const revalidados: string[] = [];
const carregador = Module as unknown as { _load: (request: string, ...resto: unknown[]) => unknown };
const carregarOriginal = carregador._load;
carregador._load = function (request: string, ...resto: unknown[]) {
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (nome: string) => (tokenAtual && nome === COOKIE_SESSAO ? { name: nome, value: tokenAtual } : undefined),
      }),
      headers: async () => new Headers(),
    };
  }
  if (request === "next/navigation") {
    return {
      notFound: () => {
        throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
      },
      redirect: (u: string) => {
        throw new Error(`NEXT_REDIRECT;${u}`);
      },
    };
  }
  if (request === "next/cache") {
    return { revalidatePath: (p: string) => void revalidados.push(p), revalidateTag: () => undefined, updateTag: () => undefined };
  }
  return carregarOriginal.call(this, request, ...resto);
};

const prisma = new PrismaClient();

let total = 0;
let falhas = 0;
const problemasConsole: string[] = [];
const ascii = (s: string) => s.normalize("NFD").replace(/[^\x00-\x7f]/g, "");
function conferir(cond: boolean, msg: string, detalhe = "") {
  total++;
  if (cond) console.log(`  PASS ${msg}`);
  else {
    falhas++;
    console.log(`  FAIL ${msg}${detalhe ? ` -> ${ascii(detalhe).slice(0, 300)}` : ""}`);
  }
}
const secao = (t: string) => console.log(`\n[${t}]`);
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function esperar(fn: () => Promise<boolean>, ms = 15_000): Promise<boolean> {
  const ini = Date.now();
  while (Date.now() - ini < ms) {
    if (await fn()) return true;
    await dorme(200);
  }
  return false;
}

// ------------------------------------------------------------------ navegador
async function novaSessao(browser: Browser, largura = 1280, altura = 900): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", async (m) => {
    // 404/400 de rota negada de proposito aparecem como "Failed to load resource" - ruido esperado
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) {
      // %s do React: o texto cru nao traz a pilha; junta os argumentos para o diagnostico apontar a tela e a acao
      const args = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => "?")));
      problemasConsole.push(`${m.text()} | ${args.slice(1).map(String).join(" ").slice(0, 600)} | em ${new URL(page.url()).pathname}`);
    }
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

async function carregar(page: Page, rota: string) {
  await page.goto(`${BASE}${rota}`, { waitUntil: "load" });
  await page.waitForTimeout(900);
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

const caminho = (page: Page) => new URL(page.url()).pathname;
const dialogo = (page: Page) => page.getByRole("dialog");

/** Clica no botao do dialogo e espera ele fechar (sucesso) ou aparecer um alerta (erro). Devolve o texto do alerta, se houver. */
async function enviarDialogo(page: Page, botao: string | RegExp): Promise<string | null> {
  const dlg = dialogo(page);
  await dlg.getByRole("button", { name: botao }).click();
  // o clique limpa o alerta anterior (setErro(null)); sem esta pausa o alerta velho ainda conta como "erro novo"
  await page.waitForTimeout(150);
  const fechou = dlg.waitFor({ state: "detached", timeout: 15_000 }).then(() => "fechou", () => "timeout");
  const alerta = dlg.getByRole("alert").first().waitFor({ state: "visible", timeout: 15_000 }).then(() => "alerta", () => "timeout");
  const r = await Promise.race([fechou, alerta]);
  if (r === "alerta") return await dlg.getByRole("alert").first().innerText();
  if (r === "timeout") return "TIMEOUT sem fechar nem alertar";
  return null;
}

function parseCsv(texto: string): string[][] {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  const fecha = () => {
    linha.push(campo);
    campo = "";
    linhas.push(linha);
    linha = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\r" && t[i + 1] === "\n") {
      i++;
      fecha();
    } else if (c === "\n") fecha();
    else campo += c;
  }
  if (campo !== "" || linha.length > 0) fecha();
  return linhas;
}

const CABECALHO = "Código;Apto;Torre;Destinatário;Tipo;Transportadora;Recebida em;Recebida por;Entregue em;Entregue por;Retirada por;Status;Motivo cancelamento;Aviso WhatsApp em";

// ---------------------------------------------------------------- estado/limpeza
const criados = {
  encomendaIds: [] as number[],
  porteiroIds: [] as number[],
  turnoIds: [] as number[],
  usuarioIds: [] as number[],
  aptoIds: [] as number[],
  pastasTemp: [] as string[],
};

async function contagens() {
  const [usuarios, porteiros, moradores, encomendas, apartamentos, turnos, fotos] = await Promise.all([
    prisma.usuario.count(),
    prisma.porteiro.count(),
    prisma.morador.count(),
    prisma.encomenda.count(),
    prisma.apartamento.count(),
    prisma.turno.count(),
    prisma.fotoEncomenda.count(),
  ]);
  return { usuarios, porteiros, moradores, encomendas, apartamentos, turnos, fotos };
}

function codigoLivre(): Promise<string> {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const gerar = () => "ZZ" + alfabeto[Math.floor(Math.random() * 32)] + alfabeto[Math.floor(Math.random() * 32)];
  return (async () => {
    for (let i = 0; i < 50; i++) {
      const c = gerar();
      if (!(await prisma.encomenda.findUnique({ where: { codigo: c } }))) return c;
    }
    throw new Error("sem codigo livre");
  })();
}

async function criarEncomenda(d: {
  apartamentoId: number;
  porteiroId: number;
  destinatarioNome: string;
  status: "aguardando" | "entregue" | "cancelada";
  recebidaEm: Date;
  tipo?: string;
  extra?: Record<string, unknown>;
}) {
  const e = await prisma.encomenda.create({
    data: {
      codigo: await codigoLivre(),
      apartamentoId: d.apartamentoId,
      destinatarioNome: d.destinatarioNome,
      tipo: d.tipo ?? "caixa",
      transportadora: "Correios",
      status: d.status,
      recebidaEm: d.recebidaEm,
      recebidaPorPorteiroId: d.porteiroId,
      ...(d.extra ?? {}),
    },
  });
  criados.encomendaIds.push(e.id);
  return e;
}

/** Sessao em processo: token HMAC real do usuario (como o login emite). */
async function comoUsuario(login: string) {
  const u = await prisma.usuario.findUniqueOrThrow({ where: { login } });
  tokenAtual = await assinarSessao(
    {
      id: u.id,
      nome: u.nome,
      papel: u.papel as "admin" | "portaria" | "morador",
      exp: Date.now() + 3_600_000,
      sv: versaoSenha(u.senhaHash),
      apartamentoId: u.apartamentoId,
    },
    process.env.AUTH_SECRET!
  );
  return u;
}

// =====================================================================================
async function main() {
  if (SENHA.length < 8) throw new Error("defina SENHA_TESTE (a senha usada em cria-usuarios-teste.ts)");
  const inicio = inicioTeste;
  const dbfile = (await prisma.$queryRawUnsafe<{ file: string }[]>("PRAGMA database_list"))[0]?.file ?? "?";
  console.log(`Banco: ${path.basename(dbfile)} | servidor: ${BASE} | marca: ${MARCA}`);

  const admin = await prisma.usuario.findUnique({ where: { login: "admin-teste" } });
  const portariaT = await prisma.usuario.findUnique({ where: { login: "portaria-teste" } });
  const moradorT = await prisma.usuario.findUnique({ where: { login: "morador-teste" } });
  if (!admin || !portariaT || !moradorT) throw new Error("rode antes: npx tsx scripts/cria-usuarios-teste.ts <senha>");
  const apto11A = await prisma.apartamento.findUniqueOrThrow({ where: { numero: "11A" } });
  const apto11B = await prisma.apartamento.findUniqueOrThrow({ where: { numero: "11B" } });
  const apto21A = await prisma.apartamento.findUniqueOrThrow({ where: { numero: "21A" } });

  // ============================================================ funcoes puras
  secao("funcoes puras (admin-formato)");
  conferir(mascararTelefone("11943006682") === "(11) 9****-6682", "mascara de celular: (11) 9****-6682");
  conferir(mascararTelefone("1132226682") === "(11) ****-6682", "mascara de fixo de 10 digitos");
  conferir(mascararTelefone(null) === "" && mascararTelefone("") === "", "sem telefone -> vazio");
  conferir(formatarTelefone("11943006682") === "(11) 94300-6682", "formata para editar: (11) 94300-6682");
  const n1 = normalizarTelefone("+55 (11) 94300-6682");
  conferir(n1.ok && n1.telefone === "11943006682", "normaliza +55 (11) 94300-6682 -> 11943006682");
  conferir(normalizarTelefone("  ").ok === true && (normalizarTelefone("") as { telefone: null }).telefone === null, "telefone vazio vira null");
  conferir(normalizarTelefone("123").ok === false && normalizarTelefone("abc").ok === false, "telefone curto ou sem digitos e erro");
  conferir(normalizarTelefone("0119430066").ok === false, "telefone iniciado em 0 e erro");
  conferir(celulaCsv("=1+1") === "'=1+1" && celulaCsv("+1") === "'+1" && celulaCsv("-1") === "'-1" && celulaCsv("@x") === "'@x", "CSV: formula (= + - @) vira texto literal");
  conferir(celulaCsv("a;b") === '"a;b"' && celulaCsv('diz "oi"') === '"diz ""oi"""' && celulaCsv("a\nb") === '"a\nb"', "CSV: aspas e quebra de linha");
  conferir(celulaCsv(5) === "5" && celulaCsv(null) === "" && celulaCsv("Jose") === "Jose", "CSV: numero, nulo e texto simples");
  const csvMini = montarCsv(["A", "B"], [["x", null]]);
  conferir(csvMini.charCodeAt(0) === 0xfeff && csvMini.endsWith("x;\r\n") && csvMini.includes("A;B\r\n"), "CSV: BOM + CRLF");
  conferir(formatarDuracao(3 * 3600e3) === "3 h 0 min" && formatarDuracao(42 * 60e3) === "42 min" && formatarDuracao(28 * 3600e3) === "1 d 4 h" && formatarDuracao(null) === "—", "duracao legivel (3 h 0 min, 42 min, 1 d 4 h, -)");
  conferir(
    resumirUserAgent("ua: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36") === "Chrome 156 · Windows" &&
      resumirUserAgent("outra coisa") === null,
    "resumo do user-agent"
  );

  // ======================================================== ACTIONS EM PROCESSO
  secao("actions: guarda de papel (portaria, morador e sem sessao nao fazem nada)");
  const acCad = await import("../src/actions/admin-cadastros");
  const acUsu = await import("../src/actions/admin-usuarios");
  const base = await contagens();

  const entradasProibidas: [string, () => Promise<{ ok: boolean; erro?: string }>][] = [
    ["criarMorador", () => acCad.criarMorador({ apartamentoId: apto11A.id, nome: `Nao ${MARCA}` })],
    ["editarMorador", () => acCad.editarMorador({ id: 1, apartamentoId: apto11A.id, nome: `Nao ${MARCA}` })],
    ["desativarMorador", () => acCad.desativarMorador({ id: 1 })],
    ["reativarMorador", () => acCad.reativarMorador({ id: 1 })],
    ["criarPorteiro", () => acCad.criarPorteiro({ nome: `Nao ${MARCA}` })],
    ["renomearPorteiro", () => acCad.renomearPorteiro({ id: 1, nome: `Nao ${MARCA}` })],
    ["desativarPorteiro", () => acCad.desativarPorteiro({ id: 1 })],
    ["reativarPorteiro", () => acCad.reativarPorteiro({ id: 1 })],
    ["criarUsuario", () => acUsu.criarUsuario({ login: `nao-${MARCA}`, nome: "Nao", papel: "admin" })],
    ["editarUsuario", () => acUsu.editarUsuario({ id: admin.id, nome: "Nao", papel: "morador", apartamentoId: apto11A.id })],
    ["redefinirSenha", () => acUsu.redefinirSenha({ id: moradorT.id })],
    ["desativarUsuario", () => acUsu.desativarUsuario({ id: moradorT.id })],
    ["reativarUsuario", () => acUsu.reativarUsuario({ id: moradorT.id })],
    ["excluirUsuario", () => acUsu.excluirUsuario({ id: moradorT.id })],
    ["gerarLoginsFaltantes", () => acUsu.gerarLoginsFaltantes()],
  ];
  const hashMoradorAntes = (await prisma.usuario.findUniqueOrThrow({ where: { id: moradorT.id } })).senhaHash;
  for (const [quem, login] of [["portaria", "portaria-teste"], ["morador", "morador-teste"], ["sem sessao", ""]] as const) {
    if (login) await comoUsuario(login);
    else tokenAtual = "";
    let todasNegadas = true;
    const falhou: string[] = [];
    for (const [nome, chamada] of entradasProibidas) {
      const r = await chamada();
      const msgCerta = login ? /administrador/i.test(r.erro ?? "") : /Sess/.test(r.erro ?? "");
      if (r.ok || !msgCerta) {
        todasNegadas = false;
        falhou.push(`${nome}:${r.ok ? "PASSOU" : r.erro}`);
      }
    }
    conferir(todasNegadas, `${quem}: as ${entradasProibidas.length} actions recusam (so administrador)`, falhou.join(" | "));
  }
  const depoisProibidas = await contagens();
  const hashMoradorDepois = (await prisma.usuario.findUniqueOrThrow({ where: { id: moradorT.id } })).senhaHash;
  conferir(JSON.stringify(depoisProibidas) === JSON.stringify(base) && hashMoradorAntes === hashMoradorDepois, "nada foi gravado pelas tentativas negadas");
  conferir((await prisma.usuario.findUniqueOrThrow({ where: { id: moradorT.id } })).ativo === true, "morador-teste continua ativo");

  // sessao de admin valida a partir daqui
  secao("actions: validacao de entrada (zod) nao lanca excecao");
  await comoUsuario("admin-teste");
  const lixo: [string, () => Promise<{ ok: boolean; erro?: string }>][] = [
    ["criarMorador(null)", () => acCad.criarMorador(null as never)],
    ["criarMorador(apto inexistente)", () => acCad.criarMorador({ apartamentoId: 99_999_999, nome: `Lixo ${MARCA}` })],
    ["criarMorador(nome 1 letra)", () => acCad.criarMorador({ apartamentoId: apto11A.id, nome: "a" })],
    ["criarMorador(id texto)", () => acCad.criarMorador({ apartamentoId: "1" as never, nome: `Lixo ${MARCA}` })],
    ["criarMorador(nome com controle)", () => acCad.criarMorador({ apartamentoId: apto11A.id, nome: `Lixo\u0007${MARCA}` })],
    ["editarMorador(id 0)", () => acCad.editarMorador({ id: 0, apartamentoId: apto11A.id, nome: "Lixo Lixo" })],
    ["criarPorteiro(vazio)", () => acCad.criarPorteiro({ nome: "   " })],
    ["criarPorteiro(longo)", () => acCad.criarPorteiro({ nome: "x".repeat(300) })],
    ["criarUsuario(login maiusculo/simbolo)", () => acUsu.criarUsuario({ login: "Ab!", nome: "Lixo", papel: "admin" })],
    ["criarUsuario(papel invalido)", () => acUsu.criarUsuario({ login: `lixo-${MARCA}`, nome: "Lixo", papel: "root" as never })],
    ["criarUsuario(morador sem apto)", () => acUsu.criarUsuario({ login: `lixo-${MARCA}`, nome: "Lixo", papel: "morador" })],
    ["editarUsuario(inexistente)", () => acUsu.editarUsuario({ id: 99_999_999, nome: "Lixo", papel: "portaria" })],
    ["redefinirSenha(texto)", () => acUsu.redefinirSenha({ id: "x" as never })],
  ];
  for (const [nome, chamada] of lixo) {
    let r: { ok: boolean; erro?: string } | null = null;
    let lancou = "";
    try {
      r = await chamada();
    } catch (e) {
      lancou = e instanceof Error ? e.message : String(e);
    }
    conferir(!lancou && r !== null && r.ok === false && !!r.erro, `${nome} -> erro amigavel`, lancou || JSON.stringify(r));
  }
  conferir(JSON.stringify(await contagens()) === JSON.stringify(base), "entradas invalidas nao gravaram nada");

  // ----------------------------------------------------------- porteiros
  secao("actions: porteiros");
  const nomePorteiro = `Teste Porteiro ${MARCA}`;
  const rP = await acCad.criarPorteiro({ nome: `  ${nomePorteiro}  ` });
  conferir(rP.ok === true && !!rP.id, "criarPorteiro (espacos aparados)");
  const porteiro = await prisma.porteiro.findFirstOrThrow({ where: { nome: nomePorteiro } });
  criados.porteiroIds.push(porteiro.id);
  conferir(porteiro.ativo === true, "porteiro nasce ativo");
  const dupP = await acCad.criarPorteiro({ nome: `TESTE PORTEIRO ${MARCA.toUpperCase()}` });
  conferir(!dupP.ok && /já existe/i.test(dupP.erro ?? ""), "nome repetido (outra caixa) e recusado", JSON.stringify(dupP));
  const semAcentoP = await acCad.criarPorteiro({ nome: `Jose ${MARCA}` });
  if (semAcentoP.ok && semAcentoP.id) criados.porteiroIds.push(semAcentoP.id);
  const acentoP = await acCad.criarPorteiro({ nome: `José ${MARCA}` });
  if (acentoP.ok && acentoP.id) criados.porteiroIds.push(acentoP.id);
  conferir(semAcentoP.ok === true && !acentoP.ok && /já existe/i.test(acentoP.erro ?? ""), "comparacao de nomes ignora acento (Jose = José)", JSON.stringify(acentoP));
  const nomeRenomeado = `Teste Porteiro Renomeado ${MARCA}`;
  conferir((await acCad.renomearPorteiro({ id: porteiro.id, nome: nomeRenomeado })).ok === true, "renomearPorteiro");
  conferir((await prisma.porteiro.findUniqueOrThrow({ where: { id: porteiro.id } })).nome === nomeRenomeado, "nome novo gravado");
  const mesmoNome = await acCad.renomearPorteiro({ id: porteiro.id, nome: nomeRenomeado });
  conferir(mesmoNome.ok === true && "aviso" in mesmoNome && mesmoNome.aviso === "Nada mudou", "renomear para o mesmo nome = nada mudou");
  const turnoTeste = await prisma.turno.create({ data: { porteiroId: porteiro.id } });
  criados.turnoIds.push(turnoTeste.id);
  const negaTurno = await acCad.desativarPorteiro({ id: porteiro.id });
  conferir(!negaTurno.ok && /de turno/i.test(negaTurno.erro ?? ""), "nao desativa porteiro que esta de turno", JSON.stringify(negaTurno));
  await prisma.turno.update({ where: { id: turnoTeste.id }, data: { fim: new Date() } });
  conferir((await acCad.desativarPorteiro({ id: porteiro.id })).ok === true, "desativarPorteiro (turno encerrado)");
  conferir((await prisma.porteiro.findUniqueOrThrow({ where: { id: porteiro.id } })).ativo === false, "porteiro desativado (nao apagado)");
  const jaDes = await acCad.desativarPorteiro({ id: porteiro.id });
  conferir(jaDes.ok === true && "aviso" in jaDes && /já estava/.test(jaDes.aviso ?? ""), "desativar de novo e idempotente");
  conferir((await acCad.reativarPorteiro({ id: porteiro.id })).ok === true && (await prisma.porteiro.findUniqueOrThrow({ where: { id: porteiro.id } })).ativo === true, "reativarPorteiro");
  const dupInativo = await (async () => {
    await acCad.desativarPorteiro({ id: porteiro.id });
    const r = await acCad.criarPorteiro({ nome: nomeRenomeado });
    await acCad.reativarPorteiro({ id: porteiro.id });
    return r;
  })();
  conferir(!dupInativo.ok && /desativado/i.test(dupInativo.erro ?? ""), "nome de porteiro inativo orienta a reativar", JSON.stringify(dupInativo));

  // ----------------------------------------------------------- moradores
  secao("actions: moradores");
  const nomeMorador = `Teste Morador ${MARCA}`;
  const rM = await acCad.criarMorador({ apartamentoId: apto11A.id, nome: nomeMorador, telefone: "(11) 91234-5678" });
  conferir(rM.ok === true && !!rM.id, "criarMorador");
  const morador = await prisma.morador.findFirstOrThrow({ where: { nome: nomeMorador } });
  conferir(morador.telefone === "11912345678" && morador.ativo === true && morador.apartamentoId === apto11A.id, "telefone normalizado (so digitos), ativo, apto certo");
  const dupM = await acCad.criarMorador({ apartamentoId: apto11A.id, nome: nomeMorador.toUpperCase() });
  conferir(!dupM.ok && /já existe/i.test(dupM.erro ?? ""), "homonimo (outra caixa) no mesmo apto e recusado", JSON.stringify(dupM));
  const mesmoOutroApto = await acCad.criarMorador({ apartamentoId: apto11B.id, nome: nomeMorador });
  conferir(mesmoOutroApto.ok === true, "o mesmo nome em OUTRO apto e permitido");
  await prisma.morador.deleteMany({ where: { nome: nomeMorador, apartamentoId: apto11B.id } });
  const telRuim = await acCad.criarMorador({ apartamentoId: apto11A.id, nome: `Telefone Ruim ${MARCA}`, telefone: "123" });
  conferir(!telRuim.ok && /telefone/i.test(telRuim.erro ?? ""), "telefone invalido e recusado", JSON.stringify(telRuim));
  const semTel = await acCad.criarMorador({ apartamentoId: apto11A.id, nome: `Sem Telefone ${MARCA}`, telefone: "" });
  conferir(semTel.ok === true && (await prisma.morador.findFirstOrThrow({ where: { nome: `Sem Telefone ${MARCA}` } })).telefone === null, "telefone vazio = sem telefone (null)");
  const ed1 = await acCad.editarMorador({ id: morador.id, apartamentoId: apto11A.id, nome: `${nomeMorador} Jr`, telefone: "11 98888-7777" });
  const m2 = await prisma.morador.findUniqueOrThrow({ where: { id: morador.id } });
  conferir(ed1.ok === true && m2.nome === `${nomeMorador} Jr` && m2.telefone === "11988887777", "editarMorador (nome e telefone)");
  const ed2 = await acCad.editarMorador({ id: morador.id, apartamentoId: apto21A.id, nome: m2.nome, telefone: "11 98888-7777" });
  conferir(ed2.ok === true && (await prisma.morador.findUniqueOrThrow({ where: { id: morador.id } })).apartamentoId === apto21A.id, "editarMorador muda o apartamento");
  const edSem = await acCad.editarMorador({ id: morador.id, apartamentoId: apto21A.id, nome: m2.nome, telefone: null });
  conferir(edSem.ok === true && (await prisma.morador.findUniqueOrThrow({ where: { id: morador.id } })).telefone === null, "editarMorador remove o telefone");
  const aptoTemp = await prisma.apartamento.create({ data: { numero: "991A", torre: "A", andar: 99, ativo: false } });
  criados.aptoIds.push(aptoTemp.id);
  const paraInativo = await acCad.editarMorador({ id: morador.id, apartamentoId: aptoTemp.id, nome: m2.nome });
  conferir(!paraInativo.ok && /inativo/i.test(paraInativo.erro ?? ""), "nao move morador para apartamento inativo", JSON.stringify(paraInativo));
  const novoEmInativo = await acCad.criarMorador({ apartamentoId: aptoTemp.id, nome: `Em Inativo ${MARCA}` });
  conferir(!novoEmInativo.ok && /inativo/i.test(novoEmInativo.erro ?? ""), "nao cria morador em apartamento inativo", JSON.stringify(novoEmInativo));
  await acCad.editarMorador({ id: morador.id, apartamentoId: apto11A.id, nome: m2.nome, telefone: "11988887777" });
  conferir((await acCad.desativarMorador({ id: morador.id })).ok === true && (await prisma.morador.findUniqueOrThrow({ where: { id: morador.id } })).ativo === false, "desativarMorador (nao apaga)");
  // reativar ao lado de homonimo ativo = duplicata
  const clone = await acCad.criarMorador({ apartamentoId: apto11A.id, nome: m2.nome });
  conferir(!clone.ok, "criar homonimo de um morador INATIVO tambem e recusado (orienta reativar)", JSON.stringify(clone));
  conferir((await acCad.reativarMorador({ id: morador.id })).ok === true && (await prisma.morador.findUniqueOrThrow({ where: { id: morador.id } })).ativo === true, "reativarMorador");

  // ------------------------------------------------------------- usuarios
  secao("actions: usuarios (criar, editar, senha, desativar, excluir)");
  const loginA = `teste-${MARCA}`;
  const rU = await acUsu.criarUsuario({ login: `  ${loginA.toUpperCase()} `, nome: `Usuario ${MARCA}`, papel: "morador", apartamentoId: apto11A.id });
  conferir(rU.ok === true, "criarUsuario (login normalizado para minusculas)", JSON.stringify(rU));
  const senhasGeradas: string[] = [];
  let usuarioA = await prisma.usuario.findUniqueOrThrow({ where: { login: loginA } });
  criados.usuarioIds.push(usuarioA.id);
  if (rU.ok) senhasGeradas.push(rU.emitida.senha);
  conferir(rU.ok && /^[a-hj-km-np-z2-9]{10}$/.test(rU.emitida.senha), "senha gerada: 10 caracteres legiveis, sem ambiguos (i l o 0 1)");
  conferir(usuarioA.precisaTrocarSenha === true && usuarioA.papel === "morador" && usuarioA.apartamentoId === apto11A.id && usuarioA.ativo === true, "usuario nasce ativo, morador do apto e com troca obrigatoria");
  conferir(rU.ok && !usuarioA.senhaHash.includes(rU.emitida.senha) && !usuarioA.senhaSalt.includes(rU.emitida.senha), "so o hash vai ao banco");
  const dupU = await acUsu.criarUsuario({ login: loginA, nome: "Outro", papel: "portaria" });
  conferir(!dupU.ok && /já existe/i.test(dupU.erro ?? ""), "login repetido e recusado", JSON.stringify(dupU));
  const aptoInativoU = await acUsu.criarUsuario({ login: `inat-${MARCA}`, nome: "Inat", papel: "morador", apartamentoId: aptoTemp.id });
  conferir(!aptoInativoU.ok && /inativo/i.test(aptoInativoU.erro ?? ""), "morador em apartamento inativo e recusado", JSON.stringify(aptoInativoU));
  const loginAdm2 = `teste-adm-${MARCA}`;
  const rAdm = await acUsu.criarUsuario({ login: loginAdm2, nome: `Admin2 ${MARCA}`, papel: "admin", apartamentoId: apto11A.id });
  const adm2 = await prisma.usuario.findUnique({ where: { login: loginAdm2 } });
  if (adm2) criados.usuarioIds.push(adm2.id);
  if (rAdm.ok) senhasGeradas.push(rAdm.emitida.senha);
  conferir(rAdm.ok === true && adm2?.apartamentoId === null, "admin criado ignora o apartamento enviado (null)");

  const nomeNovo = `Usuario Editado ${MARCA}`;
  conferir((await acUsu.editarUsuario({ id: usuarioA.id, nome: nomeNovo, papel: "morador", apartamentoId: apto21A.id })).ok === true, "editarUsuario (nome e apto)");
  usuarioA = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioA.id } });
  conferir(usuarioA.nome === nomeNovo && usuarioA.apartamentoId === apto21A.id, "edicao gravada");
  const semApto = await acUsu.editarUsuario({ id: usuarioA.id, nome: nomeNovo, papel: "morador", apartamentoId: null });
  conferir(!semApto.ok && /apartamento/i.test(semApto.erro ?? ""), "morador sem apto na edicao e recusado", JSON.stringify(semApto));
  conferir((await acUsu.editarUsuario({ id: usuarioA.id, nome: nomeNovo, papel: "portaria" })).ok === true && (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioA.id } })).apartamentoId === null, "morador -> portaria limpa o apartamento");
  conferir((await acUsu.editarUsuario({ id: usuarioA.id, nome: nomeNovo, papel: "morador", apartamentoId: apto11A.id })).ok === true, "portaria -> morador exige e grava o apartamento");

  secao("actions: protecoes (auto-desativar, auto-rebaixar, auto-excluir, auto-reset, ultimo admin)");
  const adminAntes = await prisma.usuario.findUniqueOrThrow({ where: { id: admin.id } });
  const rDes = await acUsu.desativarUsuario({ id: admin.id });
  conferir(!rDes.ok && /a si mesmo/i.test(rDes.erro ?? ""), "admin nao se desativa", JSON.stringify(rDes));
  const rReb = await acUsu.editarUsuario({ id: admin.id, nome: admin.nome, papel: "morador", apartamentoId: apto11A.id });
  conferir(!rReb.ok && /próprio acesso de administrador/i.test(rReb.erro ?? ""), "admin nao se rebaixa", JSON.stringify(rReb));
  const rRes = await acUsu.redefinirSenha({ id: admin.id });
  conferir(!rRes.ok && /própria senha/i.test(rRes.erro ?? ""), "admin nao redefine a propria senha por aqui", JSON.stringify(rRes));
  const rExc = await acUsu.excluirUsuario({ id: admin.id });
  conferir(!rExc.ok && /a si mesmo/i.test(rExc.erro ?? ""), "admin nao se exclui", JSON.stringify(rExc));
  const adminDepois = await prisma.usuario.findUniqueOrThrow({ where: { id: admin.id } });
  conferir(adminDepois.ativo && adminDepois.papel === "admin" && adminDepois.senhaHash === adminAntes.senhaHash, "admin-teste intacto apos as 4 tentativas");
  const edSoNome = await acUsu.editarUsuario({ id: admin.id, nome: admin.nome, papel: "admin" });
  conferir(edSoNome.ok === true, "admin pode editar a si mesmo mantendo o papel (nada mudou)");
  // dois admins ativos: um pode desativar o outro (sempre sobra quem agiu); o ultimo admin ativo nunca fica sem acesso
  const ativosAdmin = await prisma.usuario.count({ where: { papel: "admin", ativo: true } });
  conferir(ativosAdmin >= 2, `ha pelo menos 2 admins ativos durante o teste (${ativosAdmin})`);
  conferir((await acUsu.editarUsuario({ id: adm2!.id, nome: `Admin2 ${MARCA}`, papel: "portaria" })).ok === true && (await prisma.usuario.findUniqueOrThrow({ where: { id: adm2!.id } })).papel === "portaria", "um admin rebaixa OUTRO admin (sobra quem agiu)");
  await acUsu.editarUsuario({ id: adm2!.id, nome: `Admin2 ${MARCA}`, papel: "admin" });
  conferir((await acUsu.desativarUsuario({ id: adm2!.id })).ok === true && (await prisma.usuario.findUniqueOrThrow({ where: { id: adm2!.id } })).ativo === false, "um admin desativa OUTRO admin (sobra quem agiu)");
  conferir((await prisma.usuario.count({ where: { papel: "admin", ativo: true } })) >= 1, "sempre resta ao menos 1 admin ativo");

  secao("actions: senha, desativar/reativar e excluir");
  const hashAntes = (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioA.id } })).senhaHash;
  await prisma.usuario.update({ where: { id: usuarioA.id }, data: { precisaTrocarSenha: false } });
  const rSenha = await acUsu.redefinirSenha({ id: usuarioA.id });
  const uSenha = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioA.id } });
  if (rSenha.ok) senhasGeradas.push(rSenha.emitida.senha);
  conferir(rSenha.ok === true && uSenha.senhaHash !== hashAntes && uSenha.precisaTrocarSenha === true, "redefinirSenha: hash novo e troca obrigatoria de volta");
  conferir(rSenha.ok && versaoSenha(uSenha.senhaHash) !== versaoSenha(hashAntes), "a marca da sessao (sv) muda -> sessoes antigas caem");
  conferir(rSenha.ok && rU.ok && rSenha.emitida.senha !== rU.emitida.senha, "a senha nova e outra");
  conferir((await acUsu.desativarUsuario({ id: usuarioA.id })).ok === true && (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioA.id } })).ativo === false, "desativarUsuario");
  conferir((await acUsu.reativarUsuario({ id: usuarioA.id })).ok === true && (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioA.id } })).ativo === true, "reativarUsuario");

  // excluir: usuario SEM eventos
  const loginB = `teste-b-${MARCA}`;
  const rB = await acUsu.criarUsuario({ login: loginB, nome: `Eventless ${MARCA}`, papel: "portaria" });
  const userB = await prisma.usuario.findUniqueOrThrow({ where: { login: loginB } });
  criados.usuarioIds.push(userB.id);
  if (rB.ok) senhasGeradas.push(rB.emitida.senha);
  const exAtivo = await acUsu.excluirUsuario({ id: userB.id });
  conferir(exAtivo.ok === true && "excluido" in exAtivo && exAtivo.excluido === false && exAtivo.desativado === true, "excluir ATIVO so desativa", JSON.stringify(exAtivo));
  conferir((await prisma.usuario.findUnique({ where: { id: userB.id } }))?.ativo === false, "usuario ativo continua existindo, agora desativado");
  const exOk = await acUsu.excluirUsuario({ id: userB.id });
  conferir(exOk.ok === true && "excluido" in exOk && exOk.excluido === true, "excluir DESATIVADO e sem eventos apaga de vez", JSON.stringify(exOk));
  conferir((await prisma.usuario.findUnique({ where: { id: userB.id } })) === null, "linha removida do banco");
  // excluir: usuario COM eventos (login) so fica desativado
  await prisma.logEvento.create({ data: { usuarioId: usuarioA.id, usuarioNome: usuarioA.nome, papel: "morador", tipo: "login", rota: "/login", detalhe: `evento de teste ${MARCA}` } });
  await acUsu.desativarUsuario({ id: usuarioA.id });
  const exEv = await acUsu.excluirUsuario({ id: usuarioA.id });
  conferir(exEv.ok === true && "excluido" in exEv && exEv.excluido === false && exEv.desativado === false && /evento/i.test(exEv.aviso), "desativado COM eventos nao e excluido (preserva a trilha)", JSON.stringify(exEv));
  conferir((await prisma.usuario.findUnique({ where: { id: usuarioA.id } }))?.ativo === false, "continua existindo e desativado");
  await acUsu.reativarUsuario({ id: usuarioA.id });

  secao("actions: gerar logins faltantes");
  await prisma.apartamento.update({ where: { id: aptoTemp.id }, data: { ativo: true } });
  const faltando = await prisma.apartamento.findMany({ where: { ativo: true } });
  const usuariosAntes = await prisma.usuario.findMany({ select: { login: true } });
  const logins = new Set(usuariosAntes.map((u) => u.login));
  const esperados = faltando.filter((a) => !logins.has(`ap${a.numero.toLowerCase()}`)).map((a) => `ap${a.numero.toLowerCase()}`);
  const rG = await acUsu.gerarLoginsFaltantes();
  conferir(rG.ok === true && "emitidas" in rG && rG.emitidas.length === esperados.length && esperados.includes("ap991a"), `gera exatamente os logins que faltam (${esperados.join(",")})`, JSON.stringify(rG).slice(0, 200));
  if (rG.ok) for (const e of rG.emitidas) senhasGeradas.push(e.senha);
  const novos = await prisma.usuario.findMany({ where: { login: { in: esperados } } });
  for (const u of novos) criados.usuarioIds.push(u.id);
  conferir(novos.length === esperados.length && novos.every((u) => u.papel === "morador" && u.precisaTrocarSenha && u.ativo && u.apartamentoId !== null), "todos morador, ativos, com apto e troca obrigatoria");
  const rG2 = await acUsu.gerarLoginsFaltantes();
  conferir(rG2.ok === true && "emitidas" in rG2 && rG2.emitidas.length === 0, "segunda chamada nao cria nada (idempotente)", JSON.stringify(rG2));

  secao("actions: livro de eventos");
  const eventosAdmin = await prisma.logEvento.findMany({ where: { usuarioId: admin.id, criadoEm: { gte: inicio } }, orderBy: { id: "asc" } });
  const tipos = new Set(eventosAdmin.map((e) => e.tipo));
  conferir(tipos.has("usuario") && tipos.has("cadastro"), "toda escrita virou evento (tipos usuario e cadastro)");
  conferir(eventosAdmin.some((e) => e.tipo === "usuario" && (e.detalhe ?? "").includes(`Criou o usuário "${loginA}"`)), "evento de criacao do usuario com o login");
  conferir(eventosAdmin.some((e) => e.tipo === "cadastro" && (e.detalhe ?? "").includes("apto 11A → 21A")), "evento de edicao do morador registra apto de -> para");
  conferir(eventosAdmin.every((e) => e.rota.startsWith("/admin/")), "todos os eventos levam a rota /admin/...");
  let vazou = 0;
  for (const s of senhasGeradas) vazou += await prisma.logEvento.count({ where: { detalhe: { contains: s } } });
  conferir(senhasGeradas.length >= 5 && vazou === 0, `nenhuma das ${senhasGeradas.length} senhas geradas aparece no livro`);
  conferir(!eventosAdmin.some((e) => /9?1234-?5678|11912345678|11988887777/.test(e.detalhe ?? "")), "telefone completo nunca vai para o livro");
  conferir(revalidados.includes("/admin/usuarios") && revalidados.includes("/admin/moradores") && revalidados.includes("/admin/porteiros"), "revalidatePath das telas afetadas");
  tokenAtual = "";

  // ======================================================== DADOS DE TESTE (painel/CSV)
  const agora = Date.now();
  const e1 = await criarEncomenda({
    apartamentoId: apto11A.id, porteiroId: porteiro.id, destinatarioNome: `=1+1; "Sicrano"`, status: "aguardando",
    recebidaEm: new Date(agora - 5 * DIA_MS - 3_600_000),
  });
  // "recente" = 1 h atras, mas sempre HOJE no relogio de Sao Paulo (o teste de hoje..hoje nao pode virar ontem a 00:30)
  const recenteEm = Math.min(agora, Math.max(agora - 3_600_000, inicioDoDiaLocal().getTime() + 60_000));
  const e2 = await criarEncomenda({
    apartamentoId: apto11B.id, porteiroId: porteiro.id, destinatarioNome: `Teste Recente ${MARCA}`, status: "aguardando",
    recebidaEm: new Date(recenteEm), tipo: "envelope",
  });
  const e3 = await criarEncomenda({
    apartamentoId: apto11A.id, porteiroId: porteiro.id, destinatarioNome: `Teste Entregue ${MARCA}`, status: "entregue",
    recebidaEm: new Date(agora - 2 * DIA_MS - 5 * 3_600_000),
    extra: { entregueEm: new Date(agora - 2 * DIA_MS), entreguePorPorteiroId: porteiro.id, retiradaTerceiroNome: "Terceiro Teste", retiradaTerceiroDoc: "98765432100" },
  });
  const e4 = await criarEncomenda({
    apartamentoId: apto11A.id, porteiroId: porteiro.id, destinatarioNome: `Teste Cancelada ${MARCA}`, status: "cancelada",
    recebidaEm: new Date(agora - 3 * 3_600_000),
    extra: { canceladaEm: new Date(agora - 2 * 3_600_000), canceladaMotivo: "erro; de\nregistro" },
  });

  const browser = await abrirNavegador();
  try {
    // ============================================================ papeis
    secao("rotas por papel (allowlist + guarda do route handler)");
    {
      const { ctx, page } = await novaSessao(browser);
      const r = await ctx.request.get(`${BASE}/admin/exportar/csv`, { maxRedirects: 0 });
      conferir([301, 302, 303, 307, 308].includes(r.status()) && (r.headers()["location"] ?? "").includes("/login"), `sem sessao: CSV manda para /login (${r.status()})`);
      await page.goto(`${BASE}/admin`, { waitUntil: "load" });
      conferir(caminho(page) === "/login", "sem sessao: /admin vai para /login");
      await ctx.close();
    }
    for (const [login, rotulo] of [["portaria-teste", "portaria"], ["morador-teste", "morador"]] as const) {
      const { ctx, page } = await novaSessao(browser, 390, 844);
      await entrar(page, login, SENHA);
      for (const rota of ["/admin", "/admin/moradores", "/admin/porteiros", "/admin/usuarios", "/admin/exportar", "/admin/logs"]) {
        conferir((await status(page, rota)) === 404, `${rotulo}: ${rota} = 404`);
      }
      for (const rota of ["/admin/exportar/csv", "/admin/exportar/csv?de=2026-01-01&ate=2026-12-31", "/admin/exportar/csv?de=lixo"]) {
        const r = await ctx.request.get(`${BASE}${rota}`);
        conferir(r.status() === 404, `${rotulo}: ${rota} = 404 (nunca 200 nem 400)`);
      }
      await ctx.close();
    }

    // ============================================================ admin
    const { ctx: ctxAdm, page } = await novaSessao(browser);
    await entrar(page, "admin-teste", SENHA);
    conferir(caminho(page) === "/admin", `admin-teste: login leva a /admin (${caminho(page)})`);

    secao("painel /admin");
    await carregar(page, "/admin");
    for (const t of ["Painel", "Moradores", "Porteiros", "Usuários", "Exportar", "Logs", "Ir para a portaria", "Sair"]) {
      conferir((await page.locator("header").getByText(t, { exact: true }).count()) > 0, `barra: "${t}"`);
    }
    for (const t of ["Aguardando agora", "Paradas há 3 dias ou mais", "Entregues", "Tempo médio para retirar", "Encomendas paradas", "Por porteiro (30 dias)", "Últimos eventos", "Turno aberto"]) {
      conferir((await page.getByText(t, { exact: true }).count()) > 0, `painel tem "${t}"`);
    }
    const lerPainel = async () => ({
      aguardando: Number((await page.getByTestId("aguardando-total").innerText()).trim()),
      paradas: Number((await page.getByTestId("paradas-total").innerText()).trim()),
      tempo: (await page.getByTestId("tempo-medio").innerText()).trim(),
    });
    const esperadoPainel = async () => {
      const ini30 = somarDiasLocal(new Date(), -29);
      const ent = await prisma.encomenda.findMany({ where: { status: "entregue", entregueEm: { gte: ini30 } }, select: { recebidaEm: true, entregueEm: true } });
      const ms = ent.map((e) => e.entregueEm!.getTime() - e.recebidaEm.getTime());
      return {
        aguardando: await prisma.encomenda.count({ where: { status: "aguardando" } }),
        paradas: await prisma.encomenda.count({ where: { status: "aguardando", recebidaEm: { lte: new Date(Date.now() - 3 * DIA_MS) } } }),
        tempo: formatarDuracao(ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null),
        entreguesHoje: await prisma.encomenda.count({ where: { status: "entregue", entregueEm: { gte: inicioDoDiaLocal() } } }),
        entregues30: ent.length,
      };
    };
    let ok = false;
    let lido = await lerPainel();
    let esp = await esperadoPainel();
    for (let tentativa = 0; tentativa < 3 && !ok; tentativa++) {
      await carregar(page, "/admin");
      lido = await lerPainel();
      esp = await esperadoPainel();
      ok = lido.aguardando === esp.aguardando && lido.paradas === esp.paradas && lido.tempo === esp.tempo;
    }
    conferir(lido.aguardando === esp.aguardando && lido.aguardando >= 2, `Aguardando agora = banco (${lido.aguardando} = ${esp.aguardando})`);
    conferir(lido.paradas === esp.paradas && lido.paradas >= 1, `Paradas = banco (${lido.paradas} = ${esp.paradas})`);
    conferir(lido.tempo === esp.tempo, `Tempo medio = banco (${lido.tempo} = ${esp.tempo})`);
    const linkParada = page.locator(`a[href="/portaria/encomenda/${e1.id}"]`);
    conferir((await linkParada.count()) === 1 && (await linkParada.innerText()).trim() === e1.codigo, "lista de paradas: link /portaria/encomenda/[id] com o codigo");
    conferir((await page.locator(`a[href="/portaria/encomenda/${e2.id}"]`).count()) === 0, "encomenda recente nao entra em paradas");
    conferir(await page.getByText(/^5 dias$/).first().isVisible(), "parada ha 5 dias aparece como '5 dias'");
    conferir((await page.getByText(nomePorteiro.replace("Teste Porteiro", "Teste Porteiro Renomeado"), { exact: false }).count()) > 0, "tabela 'Por porteiro' lista o porteiro de teste");
    conferir((await page.getByText("Abrir a portaria").count()) === 1, "ha o atalho para a portaria no painel");
    await foto(page, "painel-com-dados");
    await Promise.all([page.waitForURL(/\/portaria/), page.getByRole("link", { name: "Ir para a portaria" }).click()]);
    conferir(caminho(page) === "/portaria", "Ir para a portaria abre /portaria (admin opera o balcao)");

    // ---------------------------------------------------------- porteiros (UI)
    secao("UI: porteiros");
    const nomeUi = `Teste UI ${MARCA}`;
    await carregar(page, "/admin/porteiros");
    await page.getByRole("button", { name: "Novo porteiro" }).click();
    await dialogo(page).getByLabel("Nome").fill(nomeUi);
    conferir((await enviarDialogo(page, "Salvar")) === null, "Novo porteiro: salva e fecha");
    conferir(await esperar(async () => (await prisma.porteiro.count({ where: { nome: nomeUi } })) === 1), "porteiro gravado");
    const pUi = await prisma.porteiro.findFirstOrThrow({ where: { nome: nomeUi } });
    criados.porteiroIds.push(pUi.id);
    conferir(await esperar(async () => await page.getByText(nomeUi, { exact: true }).isVisible()), "porteiro aparece na lista");
    await page.getByRole("button", { name: "Novo porteiro" }).click();
    await dialogo(page).getByLabel("Nome").fill(nomeUi.toLowerCase());
    const erroDup = await enviarDialogo(page, "Salvar");
    conferir(!!erroDup && /já existe/i.test(erroDup), "nome repetido mostra erro dentro do dialogo", erroDup ?? "");
    await dialogo(page).getByRole("button", { name: "Cancelar" }).click();
    await dialogo(page).waitFor({ state: "detached" });
    await page.getByRole("button", { name: `Renomear ${nomeUi}` }).click();
    conferir((await dialogo(page).getByLabel("Nome").inputValue()) === nomeUi, "Renomear abre com o nome atual");
    await dialogo(page).getByLabel("Nome").fill(`${nomeUi} 2`);
    conferir((await enviarDialogo(page, "Salvar")) === null, "Renomear: salva e fecha");
    conferir(await esperar(async () => (await prisma.porteiro.findUnique({ where: { id: pUi.id } }))?.nome === `${nomeUi} 2`), "novo nome gravado");
    await page.getByRole("button", { name: `Desativar ${nomeUi} 2` }).click();
    conferir((await enviarDialogo(page, "Desativar porteiro")) === null, "Desativar: confirma e fecha");
    conferir(await esperar(async () => (await prisma.porteiro.findUnique({ where: { id: pUi.id } }))?.ativo === false), "porteiro desativado no banco");
    conferir(await esperar(async () => (await page.locator("tr", { hasText: `${nomeUi} 2` }).getByText("Inativo").count()) === 1), "linha mostra 'Inativo'");
    await page.getByRole("button", { name: `Reativar ${nomeUi} 2` }).click();
    conferir((await enviarDialogo(page, "Reativar porteiro")) === null, "Reativar: confirma e fecha");
    conferir(await esperar(async () => (await prisma.porteiro.findUnique({ where: { id: pUi.id } }))?.ativo === true), "porteiro reativado");
    const tUi = await prisma.turno.create({ data: { porteiroId: pUi.id } });
    criados.turnoIds.push(tUi.id);
    await carregar(page, "/admin/porteiros");
    conferir(await page.locator("tr", { hasText: `${nomeUi} 2` }).getByText("De turno agora").isVisible(), "porteiro de turno aparece marcado");
    await page.getByRole("button", { name: `Desativar ${nomeUi} 2` }).click();
    const erroTurno = await enviarDialogo(page, "Desativar porteiro");
    conferir(!!erroTurno && /de turno/i.test(erroTurno), "porteiro de turno nao desativa (erro no dialogo)", erroTurno ?? "");
    await dialogo(page).getByRole("button", { name: "Cancelar" }).click();
    await prisma.turno.update({ where: { id: tUi.id }, data: { fim: new Date() } });

    // ---------------------------------------------------------- moradores (UI)
    secao("UI: moradores");
    await carregar(page, "/admin/moradores?q=11a");
    const corpoMor = await page.locator("main").innerText();
    conferir((await page.locator("article[aria-label^='Apartamento']").count()) === 1, "busca '11a' = so o apto 11A");
    conferir(/\(\d{2}\) \d\*{4}-\d{4}/.test(corpoMor) && !/\(\d{2}\) \d{4,5}-\d{4}/.test(corpoMor), "telefones mascarados na lista (nenhum completo)");
    await foto(page, "moradores-11a");
    const nomeUiM = `UI Morador ${MARCA}`;
    await page.getByRole("button", { name: "Novo morador no apto 11A" }).click();
    await dialogo(page).getByLabel("Nome").fill(nomeUiM);
    await dialogo(page).getByLabel(/Telefone/).fill("123");
    const erroTel = await enviarDialogo(page, "Salvar");
    conferir(!!erroTel && /telefone inválido/i.test(erroTel), "telefone invalido mostra erro no dialogo", erroTel ?? "");
    await dialogo(page).getByLabel(/Telefone/).fill("(11) 97766-5544");
    conferir((await enviarDialogo(page, "Salvar")) === null, "Novo morador: salva e fecha");
    const mUi = await prisma.morador.findFirst({ where: { nome: nomeUiM } });
    conferir(mUi?.telefone === "11977665544" && mUi.apartamentoId === apto11A.id && mUi.ativo, "morador gravado (telefone so digitos, apto 11A)");
    // o aviso verde de sucesso tambem cita o nome: espera pelo TELEFONE MASCARADO, que so existe na lista ja atualizada
    await esperar(async () => (await page.locator("main").innerText()).includes("(11) 9****-5544"));
    const corpoMor2 = await page.locator("main").innerText();
    conferir(corpoMor2.includes(nomeUiM) && corpoMor2.includes("(11) 9****-5544") && !corpoMor2.includes("97766-5544"), "lista mostra o novo morador com telefone mascarado", corpoMor2.slice(0, 400));
    await page.getByRole("button", { name: `Editar ${nomeUiM}` }).click();
    conferir((await dialogo(page).getByLabel(/Telefone/).inputValue()) === "(11) 97766-5544", "Editar mostra o telefone COMPLETO");
    await dialogo(page).getByLabel("Apartamento").selectOption({ label: "21A" });
    await dialogo(page).getByLabel("Nome").fill(`${nomeUiM} Jr`);
    conferir((await enviarDialogo(page, "Salvar")) === null, "Editar: salva e fecha");
    const mUi2 = await prisma.morador.findUnique({ where: { id: mUi!.id } });
    conferir(mUi2?.nome === `${nomeUiM} Jr` && mUi2.apartamentoId === apto21A.id, "edicao gravada (nome e apto 21A)");
    await carregar(page, `/admin/moradores?q=${encodeURIComponent(MARCA)}`);
    conferir((await page.locator("article[aria-label='Apartamento 21A']").count()) === 1, "busca pelo nome acha o apto onde ele esta agora");
    await page.getByRole("button", { name: `Desativar ${nomeUiM} Jr` }).click();
    conferir((await enviarDialogo(page, "Desativar morador")) === null, "Desativar: confirma e fecha");
    conferir(await esperar(async () => (await prisma.morador.findUnique({ where: { id: mUi!.id } }))?.ativo === false), "morador desativado (nao apagado)");
    conferir(await esperar(async () => await page.getByRole("button", { name: `Reativar ${nomeUiM} Jr` }).isVisible()), "botao vira Reativar");
    await page.getByRole("button", { name: `Reativar ${nomeUiM} Jr` }).click();
    conferir((await enviarDialogo(page, "Reativar morador")) === null, "Reativar: confirma e fecha");
    await carregar(page, "/admin/moradores?torre=B");
    conferir((await page.getByRole("heading", { name: "Torre A" }).count()) === 0 && (await page.getByRole("heading", { name: "Torre B" }).count()) === 1, "filtro torre=B mostra so a Torre B");
    await carregar(page, "/admin/moradores?q=11");
    conferir((await page.locator("article[aria-label^='Apartamento']").count()) === 2, "busca '11' = 11A e 11B (nunca 111A)");
    await carregar(page, "/admin/moradores?q=zzzzzz-nao-existe");
    conferir(await page.getByText(/Nenhum apartamento ou morador encontrado/).isVisible(), "busca sem resultado mostra estado vazio");

    // ---------------------------------------------------------- usuarios (UI)
    secao("UI: usuarios");
    await carregar(page, "/admin/usuarios?papel=admin");
    const selosPapel = await page.locator("tbody tr td:nth-child(3)").allInnerTexts();
    conferir(selosPapel.length >= 2 && selosPapel.every((t) => t.trim() === "Administrador"), `filtro papel=admin lista so administradores (${selosPapel.length})`);
    await carregar(page, "/admin/usuarios?q=admin-teste");
    const linhaEu = page.locator('tr[data-login="admin-teste"]');
    conferir((await linhaEu.count()) === 1 && (await linhaEu.getByText("(você)").count()) === 1, "linha propria marcada '(você)'");
    conferir(await linhaEu.getByRole("button", { name: "Desativar admin-teste" }).isDisabled(), "botao Desativar da propria linha vem desabilitado");
    conferir((await linhaEu.getByRole("link", { name: "Trocar minha senha" }).getAttribute("href")) === "/conta/senha", "propria linha: 'Trocar minha senha' leva a /conta/senha");
    conferir((await linhaEu.getByRole("button", { name: /Redefinir senha/ }).count()) === 0, "propria linha nao oferece redefinir por aqui");
    await carregar(page, "/admin/usuarios");
    const faltantesBtn = page.getByRole("button", { name: /Gerar logins faltantes/ });
    conferir(await faltantesBtn.isDisabled(), "Gerar logins faltantes desabilitado quando todos os aptos ativos tem login");

    const loginUi = `ui-${MARCA}`;
    await page.getByRole("button", { name: "Novo usuário" }).click();
    await dialogo(page).getByLabel("Apartamento").selectOption({ label: "21A" });
    conferir((await dialogo(page).getByLabel("Login").inputValue()) === "ap21a" && (await dialogo(page).getByLabel("Nome").inputValue()) === "Apto 21A", "escolher o apto sugere login ap21a e nome 'Apto 21A'");
    await dialogo(page).getByLabel("Login").fill("Ab!");
    const erroLogin = await enviarDialogo(page, "Criar e gerar senha");
    conferir(!!erroLogin && /login inválido/i.test(erroLogin), "login invalido mostra erro no dialogo", erroLogin ?? "");
    await dialogo(page).getByLabel("Login").fill(loginUi);
    await dialogo(page).getByLabel("Nome").fill(`Usuario UI ${MARCA}`);
    await dialogo(page).getByRole("button", { name: "Criar e gerar senha" }).click();
    await page.getByTestId("senha-emitida").waitFor({ timeout: 15_000 });
    const senhaUi = (await page.getByTestId("senha-emitida").innerText()).trim();
    conferir((await page.getByTestId("login-emitido").innerText()).trim() === loginUi, "resultado mostra o login criado");
    conferir(/^[a-hj-km-np-z2-9]{10}$/.test(senhaUi), "resultado mostra a senha gerada (10 caracteres legiveis)");
    conferir(await page.getByText("esta é a única vez").isVisible(), "aviso: a senha aparece uma unica vez");
    await foto(page, "usuarios-senha-gerada");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    conferir(await page.getByTestId("senha-emitida").isVisible(), "Esc nao descarta a senha (so o botao fecha)");
    await page.mouse.click(5, 5);
    await page.waitForTimeout(400);
    conferir(await page.getByTestId("senha-emitida").isVisible(), "clique fora nao descarta a senha");
    await page.getByRole("button", { name: "Já anotei — fechar" }).click();
    await dialogo(page).waitFor({ state: "detached" });
    conferir(!(await page.content()).includes(senhaUi), "depois de fechar a senha nao esta mais na pagina");
    const uUi = await prisma.usuario.findUniqueOrThrow({ where: { login: loginUi } });
    criados.usuarioIds.push(uUi.id);
    conferir(uUi.precisaTrocarSenha && uUi.papel === "morador" && uUi.apartamentoId === apto21A.id, "usuario gravado: morador do 21A com troca obrigatoria");
    conferir((await prisma.logEvento.count({ where: { detalhe: { contains: senhaUi } } })) === 0, "a senha nao esta em nenhum log");
    conferir(await esperar(async () => await page.locator(`tr[data-login="${loginUi}"]`).getByText("Troca pendente").isVisible()), "linha mostra 'Troca pendente'");

    // o usuario novo entra, cai na troca de senha; reset derruba a sessao dele
    const { ctx: ctxNovo, page: pgNovo } = await novaSessao(browser, 390, 844);
    await entrar(pgNovo, loginUi, senhaUi);
    conferir(caminho(pgNovo) === "/conta/senha", `usuario novo cai em /conta/senha (${caminho(pgNovo)})`);
    conferir(await pgNovo.getByText("É o seu primeiro acesso").isVisible(), "tela de primeiro acesso");
    await page.getByRole("button", { name: `Redefinir senha de ${loginUi}` }).click();
    await dialogo(page).getByRole("button", { name: "Gerar nova senha" }).click();
    await page.getByTestId("senha-emitida").waitFor({ timeout: 15_000 });
    const senhaUi2 = (await page.getByTestId("senha-emitida").innerText()).trim();
    conferir(senhaUi2 !== senhaUi && /^[a-hj-km-np-z2-9]{10}$/.test(senhaUi2), "redefinir mostra outra senha");
    await page.getByRole("button", { name: "Já anotei — fechar" }).click();
    await dialogo(page).waitFor({ state: "detached" });
    await pgNovo.goto(`${BASE}/conta/senha`, { waitUntil: "load" });
    await pgNovo.waitForTimeout(500);
    conferir(await pgNovo.getByRole("heading", { name: "Sessão encerrada" }).isVisible(), "redefinir senha derruba a sessao aberta ('Sessão encerrada')");
    await pgNovo.getByRole("button", { name: "Ir para o login" }).click();
    await pgNovo.waitForURL(/\/login/);
    await entrar(pgNovo, loginUi, senhaUi);
    conferir(new URL(pgNovo.url()).searchParams.get("erro") === "1", "a senha antiga nao entra mais");
    await entrar(pgNovo, loginUi, senhaUi2);
    conferir(caminho(pgNovo) === "/conta/senha", "a senha nova entra (e pede a troca)");
    await page.getByRole("button", { name: `Desativar ${loginUi}` }).click();
    conferir((await enviarDialogo(page, "Desativar acesso")) === null, "Desativar usuario: confirma e fecha");
    await pgNovo.goto(`${BASE}/conta/senha`, { waitUntil: "load" });
    conferir(await pgNovo.getByRole("heading", { name: "Acesso desativado" }).isVisible(), "usuario desativado cai na proxima tela ('Acesso desativado')");
    await page.getByRole("button", { name: `Reativar ${loginUi}` }).click();
    conferir((await enviarDialogo(page, "Reativar acesso")) === null, "Reativar usuario: confirma e fecha");
    await pgNovo.goto(`${BASE}/conta/senha`, { waitUntil: "load" });
    conferir(await pgNovo.getByText("É o seu primeiro acesso").isVisible(), "reativado volta a abrir");
    conferir((await page.getByRole("button", { name: `Excluir ${loginUi}` }).count()) === 0, "usuario com eventos nao oferece Excluir");
    await ctxNovo.close();

    // editar pela UI
    await page.getByRole("button", { name: `Editar ${loginUi}` }).click();
    conferir((await dialogo(page).getByLabel("Login").getAttribute("readonly")) !== null, "Editar: login somente leitura");
    await dialogo(page).getByLabel("Nome").fill(`UI Editado ${MARCA}`);
    await dialogo(page).getByLabel("Papel").selectOption("portaria");
    conferir((await dialogo(page).getByLabel("Apartamento").count()) === 0, "papel diferente de morador esconde o apartamento");
    conferir((await enviarDialogo(page, "Salvar")) === null, "Editar usuario: salva e fecha");
    const uEd = await prisma.usuario.findUniqueOrThrow({ where: { id: uUi.id } });
    conferir(uEd.nome === `UI Editado ${MARCA}` && uEd.papel === "portaria" && uEd.apartamentoId === null, "edicao gravada (papel portaria, sem apto)");
    await page.getByRole("button", { name: `Editar ${loginUi}` }).click();
    conferir(await dialogo(page).getByLabel("Papel").isEnabled(), "papel destravado para outro usuario");
    await dialogo(page).getByRole("button", { name: "Cancelar" }).click();
    await carregar(page, "/admin/usuarios?q=admin-teste");
    await page.getByRole("button", { name: "Editar admin-teste" }).click();
    conferir(await dialogo(page).getByLabel("Papel").isDisabled(), "Editar a propria conta: papel travado");
    await dialogo(page).getByRole("button", { name: "Cancelar" }).click();

    // excluir pela UI: usuario sem eventos
    await carregar(page, "/admin/usuarios");
    const loginC = `ui-c-${MARCA}`;
    await page.getByRole("button", { name: "Novo usuário" }).click();
    await dialogo(page).getByLabel("Papel").selectOption("portaria");
    await dialogo(page).getByLabel("Login").fill(loginC);
    await dialogo(page).getByLabel("Nome").fill(`UI C ${MARCA}`);
    await dialogo(page).getByRole("button", { name: "Criar e gerar senha" }).click();
    await page.getByTestId("senha-emitida").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Já anotei — fechar" }).click();
    await dialogo(page).waitFor({ state: "detached" });
    const uC = await prisma.usuario.findUniqueOrThrow({ where: { login: loginC } });
    criados.usuarioIds.push(uC.id);
    conferir((await page.getByRole("button", { name: `Excluir ${loginC}` }).count()) === 0, "usuario ativo nao oferece Excluir");
    await page.getByRole("button", { name: `Desativar ${loginC}` }).click();
    await enviarDialogo(page, "Desativar acesso");
    await page.getByRole("button", { name: `Excluir ${loginC}` }).waitFor({ timeout: 15_000 });
    conferir(true, "desativado e sem eventos oferece Excluir");
    await page.getByRole("button", { name: `Excluir ${loginC}` }).click();
    conferir((await enviarDialogo(page, "Excluir definitivamente")) === null, "Excluir: confirma e fecha");
    conferir(await esperar(async () => (await prisma.usuario.findUnique({ where: { id: uC.id } })) === null), "usuario removido do banco");

    // gerar logins faltantes pela UI (apto 991A ativo e sem login -> 1)
    await prisma.usuario.deleteMany({ where: { login: "ap991a" } });
    await prisma.apartamento.update({ where: { id: aptoTemp.id }, data: { ativo: true } });
    await carregar(page, "/admin/usuarios");
    const btnF = page.getByRole("button", { name: /Gerar logins faltantes/ });
    conferir(!(await btnF.isDisabled()) && /1/.test(await btnF.innerText()), "Gerar logins faltantes habilita e mostra a contagem (1)");
    await btnF.click();
    conferir(await esperar(async () => await dialogo(page).getByText("991A").isVisible()), "confirmacao lista o apartamento sem login");
    await dialogo(page).getByRole("button", { name: /Criar 1 login/ }).click();
    await page.getByTestId("senha-emitida").waitFor({ timeout: 15_000 });
    const linhaG = page.locator('tr[data-login="ap991a"]');
    conferir((await page.getByTestId("senha-emitida").count()) === 1 && (await page.getByRole("dialog").innerText()).includes("ap991a"), "resultado lista ap991a com a senha");
    await page.getByRole("button", { name: "Já anotei — fechar" }).click();
    await dialogo(page).waitFor({ state: "detached" });
    const uG = await prisma.usuario.findUnique({ where: { login: "ap991a" } });
    if (uG) criados.usuarioIds.push(uG.id);
    conferir(!!uG && uG.precisaTrocarSenha && uG.papel === "morador", "ap991a criado como morador com troca obrigatoria");
    conferir(await esperar(async () => (await linhaG.count()) === 1), "lista atualizada com a linha ap991a");
    conferir(await esperar(async () => await btnF.isDisabled()), "botao volta a desabilitar (nao falta mais nenhum login)");

    // ---------------------------------------------------------- exportacao
    secao("exportacao CSV");
    await carregar(page, "/admin/exportar");
    conferir(caminho(page) === "/admin/exportar", "/admin/exportar abre");
    conferir((await page.getByRole("button", { name: "Baixar CSV" }).count()) === 1 && (await page.getByRole("button", { name: "Atualizar prévia" }).count()) === 1, "botoes Baixar CSV e Atualizar previa");
    const hoje = diaLocalISO(new Date());
    const de30 = diaLocalISO(somarDiasLocal(new Date(), -29));
    conferir((await page.locator("#exp-de").inputValue()) === de30 && (await page.locator("#exp-ate").inputValue()) === hoje, "padrao: ultimos 30 dias");
    const total30 = await prisma.encomenda.count({
      where: { recebidaEm: { gte: inicioDoDiaLocal(somarDiasLocal(new Date(), -29)), lt: somarDiasLocal(new Date(), 1) } },
    });
    conferir(Number((await page.getByTestId("total-exportacao").innerText()).trim()) === total30 && total30 >= 4, `previa conta ${total30} encomendas no recorte`);
    await foto(page, "exportar-com-dados");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), page.getByRole("button", { name: "Baixar CSV" }).click()]);
    conferir(download.suggestedFilename() === `encomendas-${de30}-${hoje}.csv`, `download: ${download.suggestedFilename()}`);

    const baixar = async (qs: string) => ctxAdm.request.get(`${BASE}/admin/exportar/csv${qs}`);
    const dia = (d: Date | number) => diaLocalISO(d);
    const r = await baixar(`?de=${de30}&ate=${hoje}`);
    const bytes = await r.body();
    conferir(r.status() === 200, "CSV: HTTP 200");
    conferir((r.headers()["content-type"] ?? "").startsWith("text/csv") && (r.headers()["content-type"] ?? "").includes("utf-8"), "CSV: content-type text/csv; charset=utf-8");
    conferir((r.headers()["content-disposition"] ?? "").includes(`filename="encomendas-${de30}-${hoje}.csv"`), "CSV: nome encomendas-<de>-<ate>.csv");
    conferir(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, "CSV: comeca com BOM UTF-8 (EF BB BF)");
    conferir((r.headers()["cache-control"] ?? "").includes("no-store"), "CSV: cache-control no-store");
    const texto = bytes.toString("utf8");
    const registros = parseCsv(texto).filter((l) => !(l.length === 1 && l[0] === ""));
    conferir(registros[0]?.join(";") === CABECALHO, "CSV: cabecalho com as 14 colunas pedidas", registros[0]?.join(";"));
    conferir(registros.length - 1 === total30 && registros.slice(1).every((l) => l.length === 14), `CSV: ${total30} linhas, todas com 14 campos (aspas e quebras de linha intactas)`, `${registros.length - 1} linhas`);
    const por = (codigo: string) => registros.find((l) => l[0] === codigo);
    const l1 = por(e1.codigo);
    conferir(l1?.[3] === `'=1+1; "Sicrano"`, "CSV: destinatario que comeca com '=' vira texto literal e aspas/; ficam intactos", l1?.[3]);
    conferir(texto.includes(`"'=1+1; ""Sicrano"""`), "CSV: celula escapada como \"'=1+1; \"\"Sicrano\"\"\"");
    conferir(l1?.[1] === "11A" && l1?.[2] === "A" && l1?.[4] === "Caixa" && l1?.[5] === "Correios" && l1?.[11] === "Aguardando", "CSV: apto, torre, tipo, transportadora e status em portugues");
    conferir(l1?.[6] === formatarDataHoraCompleta(e1.recebidaEm) && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(l1?.[6] ?? ""), "CSV: data dd/MM/aaaa HH:mm (horario de Brasilia)");
    conferir(l1?.[7] === nomeRenomeado && l1?.[8] === "" && l1?.[9] === "" && l1?.[10] === "", "CSV: recebida por o porteiro; entrega e retirada vazias");
    const l3 = por(e3.codigo);
    conferir(l3?.[11] === "Entregue" && l3?.[8] === formatarDataHoraCompleta(e3.entregueEm!) && l3?.[9] === nomeRenomeado, "CSV: entregue em / entregue por");
    conferir(l3?.[10] === "Terceiro Teste (terceiro)", "CSV: retirada por terceiro marcada '(terceiro)'", l3?.[10]);
    conferir(!texto.includes("98765432100"), "CSV: documento do terceiro nao e exportado");
    const l4 = por(e4.codigo);
    conferir(l4?.[11] === "Cancelada" && l4?.[12] === "erro; de\nregistro", "CSV: motivo do cancelamento com ; e quebra de linha numa celula so", JSON.stringify(l4?.[12]));
    const l2 = por(e2.codigo);
    conferir(l2?.[1] === "11B" && l2?.[2] === "B" && l2?.[4] === "Envelope", "CSV: torre B e tipo Envelope");

    const codigos = async (qs: string) => {
      const rr = await baixar(qs);
      return { status: rr.status(), regs: parseCsv((await rr.body()).toString("utf8")).slice(1).filter((l) => l.length > 1).map((l) => l[0]) };
    };
    let f = await codigos(`?de=${de30}&ate=${hoje}&torre=B`);
    conferir(f.regs.includes(e2.codigo) && !f.regs.includes(e1.codigo) && !f.regs.includes(e3.codigo), "filtro torre=B: so a torre B");
    f = await codigos(`?de=${de30}&ate=${hoje}&torre=a`);
    conferir(f.regs.includes(e1.codigo) && !f.regs.includes(e2.codigo), "filtro torre=a (minuscula) aceito: torre A");
    f = await codigos(`?de=${de30}&ate=${hoje}&status=entregue`);
    conferir(f.regs.includes(e3.codigo) && !f.regs.includes(e1.codigo) && !f.regs.includes(e4.codigo), "filtro status=entregue");
    f = await codigos(`?de=${de30}&ate=${hoje}&status=cancelada`);
    conferir(f.regs.includes(e4.codigo) && f.regs.length === (await prisma.encomenda.count({ where: { status: "cancelada", recebidaEm: { gte: inicioDoDiaLocal(somarDiasLocal(new Date(), -29)), lt: somarDiasLocal(new Date(), 1) } } })), "filtro status=cancelada (contagem bate com o banco)");
    const diaE1 = dia(e1.recebidaEm);
    f = await codigos(`?de=${diaE1}&ate=${diaE1}`);
    conferir(f.regs.includes(e1.codigo) && !f.regs.includes(e2.codigo), `periodo de um dia so (${diaE1}): ambas as pontas inclusivas`);
    f = await codigos(`?de=${dia(e1.recebidaEm.getTime() + 2 * DIA_MS)}&ate=${hoje}`);
    conferir(!f.regs.includes(e1.codigo) && f.regs.includes(e2.codigo), "de= depois do dia da encomenda a exclui");
    f = await codigos(`?de=${de30}&ate=${dia(e1.recebidaEm.getTime() - DIA_MS)}`);
    conferir(!f.regs.includes(e1.codigo) && !f.regs.includes(e2.codigo), "ate= antes do dia da encomenda a exclui");
    f = await codigos(`?de=${hoje}&ate=${hoje}`);
    conferir(f.regs.includes(e2.codigo) && !f.regs.includes(e1.codigo), "hoje..hoje traz a de agora e nao a de 5 dias atras");
    const rSem = await baixar("");
    const semFiltro = parseCsv((await rSem.body()).toString("utf8")).slice(1).filter((l) => l.length > 1);
    conferir(rSem.status() === 200 && semFiltro.length === (await prisma.encomenda.count()) && /filename="encomendas-inicio-\d{4}-\d{2}-\d{2}\.csv"/.test(rSem.headers()["content-disposition"] ?? ""), "sem filtro: todas as encomendas; nome encomendas-inicio-<hoje>.csv");
    for (const qs of ["?de=2026-13-45", "?de=abc", "?ate=2026-02-30", "?de=2026-10-10&ate=2026-10-01", "?torre=C", "?status=xyz"]) {
      const rr = await baixar(qs);
      conferir(rr.status() === 400, `parametro invalido ${qs} = 400 (nao exporta tudo em silencio)`, `${rr.status()}`);
    }
    const ev = await prisma.logEvento.findMany({ where: { tipo: "exportacao", usuarioId: admin.id, criadoEm: { gte: inicio } } });
    conferir(ev.length >= 10 && ev.every((x) => x.rota === "/admin/exportar/csv" && /encomenda\(s\) em CSV/.test(x.detalhe ?? "")), `cada exportacao valida vira evento 'exportacao' (${ev.length})`);
    conferir(!ev.some((x) => /Sicrano|Terceiro|98765432100/.test(x.detalhe ?? "")), "o evento de exportacao nao leva dado pessoal");

    // ---------------------------------------------------------- logs
    secao("logs /admin/logs");
    await carregar(page, "/admin/logs");
    const linhasLog = await page.locator("tbody tr").count();
    conferir(linhasLog >= 5 && linhasLog <= 500, `lista os ultimos eventos (${linhasLog}, maximo 500)`);
    conferir((await page.locator("tbody tr").first().innerText()).includes("Admin Teste"), "o evento mais recente e do admin-teste");
    await carregar(page, "/admin/logs?tipo=usuario");
    const tiposUsu = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
    conferir(tiposUsu.length > 0 && tiposUsu.every((t) => t.trim() === "Usuário"), `filtro tipo=usuario (${tiposUsu.length} linhas, todas 'Usuário')`);
    await carregar(page, "/admin/logs?tipo=exportacao");
    const tiposExp = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
    conferir(tiposExp.length >= 10 && tiposExp.every((t) => t.trim() === "Exportação"), "filtro tipo=exportacao");
    await carregar(page, `/admin/logs?q=${encodeURIComponent(MARCA)}`);
    const corposLog = await page.locator("tbody tr").allInnerTexts();
    conferir(corposLog.length >= 5 && corposLog.every((t) => t.includes(MARCA) || t.toLowerCase().includes(MARCA)), `busca q=${MARCA} so traz eventos que a mencionam (${corposLog.length})`);
    await carregar(page, "/admin/logs?usuario=admin-teste&tipo=cadastro");
    const corposCad = await page.locator("tbody tr").allInnerTexts();
    conferir(corposCad.length > 0 && corposCad.every((t) => t.includes("Admin Teste") && t.includes("Cadastro")), `filtro usuario=admin-teste + tipo=cadastro (${corposCad.length})`);
    await carregar(page, "/admin/logs?usuario=nao-existe-xyz");
    conferir(await page.getByText("Nenhum evento com esses filtros.").isVisible(), "filtro sem resultado mostra estado vazio");
    await carregar(page, `/admin/logs?q=${encodeURIComponent(MARCA)}`);
    const textoLogs = await page.locator("main").innerText();
    conferir(![senhaUi, senhaUi2, ...senhasGeradas].some((s) => textoLogs.includes(s)), "nenhuma senha gerada aparece na tela de logs");
    conferir(textoLogs.includes(`Criou o usuário "${loginUi}"`) && textoLogs.includes("Redefiniu a senha"), "logs mostram criacao e redefinicao de senha (sem a senha)");
    await foto(page, "logs-com-dados");

    // ---------------------------------------------------------- layout
    secao("layout: sem rolagem lateral (390 e 768 px) e alvos de toque >= 44 px");
    const ROTAS_ADMIN = ["/admin", "/admin/moradores", "/admin/porteiros", "/admin/usuarios", "/admin/exportar", "/admin/logs"];
    for (const [largura, altura] of [[390, 844], [768, 1024]] as const) {
      const s = await novaSessao(browser, largura, altura);
      await entrar(s.page, "admin-teste", SENHA);
      for (const rota of ROTAS_ADMIN) {
        await carregar(s.page, rota);
        const med = await s.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        conferir(med.sw <= med.cw + 1, `${largura}px ${rota}: a pagina nao rola de lado (${med.sw} <= ${med.cw})`);
        if (largura === 390) {
          // chips de filtro (rounded-full) tem 36 px visuais e area de toque de 44 pelo pseudo-elemento: fora da medida
          const pequenos = await s.page.evaluate(() =>
            Array.from(document.querySelectorAll("header a, header button, main a[href], main button, main select, main input:not([type=hidden])"))
              .filter((el) => {
                const r = el.getBoundingClientRect();
                const e = el as HTMLElement;
                if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === "hidden") return false;
                if (String(e.className).includes("rounded-full")) return false;
                return r.height < 43.5;
              })
              .map((el) => ((el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 40)))
          );
          conferir(pequenos.length === 0, `${rota}: todo botao, link, campo e select tem 44 px ou mais de altura`, pequenos.join(" | "));
        }
      }
      if (largura === 390) {
        await carregar(s.page, "/admin/usuarios");
        await s.page.getByRole("button", { name: "Novo usuário" }).click();
        const caixa = await dialogo(s.page).boundingBox();
        conferir(!!caixa && caixa.x >= 0 && caixa.x + caixa.width <= 390.5, "dialogo de usuario cabe na tela de 390 px");
        const botoes = await dialogo(s.page).locator("button, select, input").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        conferir(botoes.length > 0 && botoes.every((h) => h >= 43.5), "dialogo: botoes e campos com 44 px ou mais");
        await foto(s.page, "usuarios-dialogo-390");
      }
      await s.ctx.close();
    }

    // ---------------------------------------------------------- backup
    secao("backup diario (script)");
    const pastaBk = fs.mkdtempSync(path.join(os.tmpdir(), `backup-${MARCA}-`));
    criados.pastasTemp.push(pastaBk);
    const bk = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "backup-diario.ts"), pastaBk], { encoding: "utf8", env: process.env, timeout: 120_000 });
    const nomeBk = `encomendas-${diaLocalISO(new Date())}.db`;
    conferir(bk.status === 0 && /Backup OK/.test(bk.stdout) && /Integridade: ok/.test(bk.stdout), "backup-diario.ts: exit 0, 'Backup OK' e 'Integridade: ok'", bk.stdout + bk.stderr);
    conferir(fs.existsSync(path.join(pastaBk, nomeBk)) && fs.statSync(path.join(pastaBk, nomeBk)).size > 10_000 && !fs.readdirSync(pastaBk).some((n) => n.endsWith(".tmp")), `gerou ${nomeBk} sem .tmp sobrando`);
    const m = /usuarios=(\d+) encomendas=(\d+)/.exec(bk.stdout);
    conferir(!!m && Number(m[1]) === (await prisma.usuario.count()) && Number(m[2]) === (await prisma.encomenda.count()), "contagens impressas batem com o banco");
    fs.writeFileSync(path.join(pastaBk, "encomendas-2020-01-01.db"), "antigo");
    fs.writeFileSync(path.join(pastaBk, "nao-mexer.txt"), "x");
    const bk2 = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "backup-diario.ts"), pastaBk], { encoding: "utf8", env: process.env, timeout: 120_000 });
    conferir(bk2.status === 0 && !fs.existsSync(path.join(pastaBk, "encomendas-2020-01-01.db")) && fs.existsSync(path.join(pastaBk, "nao-mexer.txt")) && fs.existsSync(path.join(pastaBk, nomeBk)), "retencao: apaga so copias do padrao com mais de 30 dias; repetir no dia substitui", bk2.stdout + bk2.stderr);

    await ctxAdm.close();
  } finally {
    await browser.close();
  }
}

// ======================================================================== limpeza
async function limpar(antes: Awaited<ReturnType<typeof contagens>> | null, inicio: Date) {
  secao("limpeza (tudo que o teste criou)");
  try {
    await prisma.encomenda.deleteMany({ where: { id: { in: criados.encomendaIds } } });
    await prisma.turno.deleteMany({ where: { id: { in: criados.turnoIds } } });
    await prisma.turno.deleteMany({ where: { porteiroId: { in: criados.porteiroIds } } });
    const porteiros = await prisma.porteiro.findMany({ where: { nome: { contains: MARCA } } });
    await prisma.porteiro.deleteMany({ where: { id: { in: [...criados.porteiroIds, ...porteiros.map((p) => p.id)] } } });
    await prisma.morador.deleteMany({ where: { nome: { contains: MARCA } } });
    const contas = await prisma.usuario.findMany({
      where: { OR: [{ id: { in: criados.usuarioIds } }, { login: { contains: MARCA } }, { login: "ap991a" }] },
      select: { id: true },
    });
    const idsContas = contas.map((c) => c.id);
    const testes = await prisma.usuario.findMany({ where: { login: { in: ["admin-teste", "portaria-teste", "morador-teste"] } }, select: { id: true } });
    // eventos gerados pelos usuarios temporarios e pelas contas de teste dentro da janela do teste, e os que citam a marca
    await prisma.logEvento.deleteMany({
      where: {
        OR: [
          { usuarioId: { in: idsContas } },
          { usuarioId: { in: testes.map((t) => t.id) }, criadoEm: { gte: inicio } },
          { detalhe: { contains: MARCA } },
        ],
      },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: idsContas } } });
    await prisma.apartamento.deleteMany({ where: { id: { in: criados.aptoIds } } });
    await prisma.apartamento.deleteMany({ where: { numero: "991A" } });
    for (const p of criados.pastasTemp) fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    console.log("  FALHA na limpeza:", e instanceof Error ? e.message : e);
    falhas++;
  }
  if (antes) {
    const depois = await contagens();
    conferir(JSON.stringify(depois) === JSON.stringify(antes), "contagens (usuarios, porteiros, moradores, encomendas, aptos, turnos, fotos) voltaram as do inicio", `${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`);
  }
}

const inicioTeste = new Date();
let contagemInicial: Awaited<ReturnType<typeof contagens>> | null = null;
contagens()
  .then(async (c) => {
    contagemInicial = c;
    await main();
  })
  .catch((e) => {
    falhas++;
    console.error(e instanceof Error ? e.stack ?? e.message : e);
  })
  .finally(async () => {
    await limpar(contagemInicial, inicioTeste);
    if (problemasConsole.length) {
      console.log("\nERROS DE CONSOLE:");
      for (const p of new Set(problemasConsole)) console.log("  - " + ascii(p));
      falhas++;
    }
    console.log(falhas === 0 ? `\nPASS - ${total} verificacoes` : `\nFAIL - ${falhas} falha(s) em ${total} verificacoes`);
    await prisma.$disconnect();
    if (falhas > 0) process.exitCode = 1;
  });
