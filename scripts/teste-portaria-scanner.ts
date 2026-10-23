/**
 * Teste do leitor de QR da retirada (23/10/2026) com CAMERA FALSA do Chrome: gera um
 * video .y4m com o QR do codigo e abre o Chrome com --use-file-for-fake-video-capture.
 * Prova o caminho de verdade (getUserMedia -> leitor -> conferencia da encomenda),
 * sem celular. Precisa do Google Chrome instalado (a camera falsa e do Chrome).
 *
 *   LOGIN_USUARIO=<portaria|admin> LOGIN_SENHA=... [TESTE_BASE=http://localhost:3001] [PASTA=<screenshots>]
 *   npx tsx scripts/teste-portaria-scanner.ts
 *
 * Cria uma encomenda de teste "[TESTE-PORTARIA]" (limpe com scripts/limpa-teste-portaria.ts).
 * Saida ASCII; exit 1 se algum passo falhar.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { PrismaClient } from "@prisma/client";
import { chromium, type Browser } from "playwright";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const USUARIO = process.env.LOGIN_USUARIO;
const SENHA = process.env.LOGIN_SENHA;
const PASTA = process.env.PASTA ?? path.join(process.cwd(), "validacao-portaria");
const prisma = new PrismaClient();
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

let total = 0;
let falhas = 0;
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

/** y4m 640x480, 30 quadros: QR preto sobre branco, centralizado, com zona de silencio. */
function gerarY4m(texto: string, arquivo: string) {
  const W = 640;
  const H = 480;
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 4;
  const modulo = Math.floor(400 / (n + quiet * 2));
  const lado = modulo * (n + quiet * 2);
  const x0 = Math.floor((W - lado) / 2);
  const y0 = Math.floor((H - lado) / 2);
  const Y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < modulo; dy++) {
        for (let dx = 0; dx < modulo; dx++) {
          Y[(y0 + (r + quiet) * modulo + dy) * W + (x0 + (c + quiet) * modulo + dx)] = 16;
        }
      }
    }
  }
  const crominancia = Buffer.alloc((W / 2) * (H / 2), 128);
  const quadro = Buffer.concat([Buffer.from("FRAME\n"), Y, crominancia, crominancia]);
  const partes = [Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < 30; i++) partes.push(quadro);
  fs.writeFileSync(arquivo, Buffer.concat(partes));
}

async function abrirChrome(video: string): Promise<Browser> {
  const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`];
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel, args });
    } catch {
      /* tenta o proximo */
    }
  }
  return chromium.launch({ args });
}

async function sessao(browser: Browser) {
  const contexto = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ["camera"] });
  const page = await contexto.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#login", USUARIO!);
  await page.fill("#senha", SENHA!);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  return page;
}

async function main() {
  if (!USUARIO || !SENHA) throw new Error("defina LOGIN_USUARIO e LOGIN_SENHA");
  fs.mkdirSync(PASTA, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qr-portaria-"));

  const apto = await prisma.apartamento.findUnique({ where: { numero: "31A" } });
  const porteiro = await prisma.porteiro.findFirst({ where: { ativo: true } });
  if (!apto || !porteiro) throw new Error("sem apto 31A ou porteiro");
  const codigo = "QR7K";
  await prisma.encomenda.deleteMany({ where: { codigo } });
  await prisma.encomenda.create({
    data: {
      codigo,
      apartamentoId: apto.id,
      destinatarioNome: "Leitor de QR Teste",
      tipo: "envelope",
      transportadora: "Correios",
      observacao: "[TESTE-PORTARIA]",
      recebidaPorPorteiroId: porteiro.id,
    },
  });

  // 1) QR valido: o codigo
  const v1 = path.join(tmp, "valido.y4m");
  gerarY4m(codigo, v1);
  const b1 = await abrirChrome(v1);
  await passo("QR com o codigo: a camera abre, le e mostra a encomenda sozinha", async () => {
    const page = await sessao(b1);
    page.on("console", (m) => {
      if (m.type() === "error") console.log(`  [console.error] ${ascii(m.text()).slice(0, 200)}`);
    });
    page.on("pageerror", (e) => console.log(`  [pageerror] ${ascii(e.message).slice(0, 200)}`));
    await page.goto(`${BASE}/portaria/retirada`);
    await page.getByRole("button", { name: "Escanear o QR do celular" }).click();
    await page.getByRole("dialog").getByText("Escanear o QR do celular").waitFor();
    await page.screenshot({ path: path.join(PASTA, "20-scanner-aberto.png") });
    await page
      .getByText("Quem está retirando?")
      .waitFor({ timeout: 25000 })
      .catch(async (e) => {
        await page.screenshot({ path: path.join(PASTA, "20b-scanner-falhou.png"), fullPage: true });
        throw e;
      });
    const campo = await page.locator("#codigo-retirada").inputValue();
    if (campo !== codigo) throw new Error(`campo do codigo = ${campo}`);
    // o dialogo some com uma animacao de saida: da um instante para sair do DOM
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 4000 }).catch(() => {
      throw new Error("o dialogo da camera nao fechou");
    });
    // e a camera foi desligada (nenhuma trilha de video ativa)
    const trilhas = await page.evaluate(() => Array.from(document.querySelectorAll("video")).length);
    if (trilhas !== 0) throw new Error("ficou um <video> montado depois de fechar");
    await page.screenshot({ path: path.join(PASTA, "21-scanner-leu-e-conferiu.png"), fullPage: true });
  });
  await b1.close();

  // 2) QR de outra coisa: mensagem, sem abrir encomenda nenhuma
  const v2 = path.join(tmp, "estranho.y4m");
  gerarY4m("https://exemplo.com/qualquer-coisa", v2);
  const b2 = await abrirChrome(v2);
  await passo("QR que nao e de encomenda: avisa e continua procurando", async () => {
    const page = await sessao(b2);
    await page.goto(`${BASE}/portaria/retirada`);
    await page.getByRole("button", { name: "Escanear o QR do celular" }).click();
    await page.getByText(/não é de uma encomenda/).waitFor({ timeout: 25000 });
    if ((await page.getByText("Quem está retirando?").count()) !== 0) throw new Error("abriu encomenda com QR estranho");
    await page.screenshot({ path: path.join(PASTA, "22-scanner-qr-estranho.png") });
    await page.getByRole("button", { name: "Digitar o código" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5000 });
  });
  await b2.close();

  // 3) sem camera/permissao: mensagem clara
  const b3 = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  await passo("camera indisponivel/negada: mensagem clara e da para digitar", async () => {
    const contexto = await b3.newContext({ viewport: { width: 1180, height: 820 } });
    const page = await contexto.newPage();
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("negado", "NotAllowedError"));
    });
    await page.goto(`${BASE}/login`);
    await page.fill("#login", USUARIO!);
    await page.fill("#senha", SENHA!);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
    await page.goto(`${BASE}/portaria/retirada`);
    await page.getByRole("button", { name: "Escanear o QR do celular" }).click();
    await page.getByText(/A câmera está bloqueada/).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(PASTA, "23-scanner-camera-negada.png") });
  });
  await b3.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${total - falhas}/${total} passos ok`);
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(ascii(e instanceof Error ? e.message : String(e)));
  await prisma.$disconnect();
  process.exit(1);
});
