/**
 * Validacao visual: screenshot de cada rota e relatorio de erros de console.
 *
 *   LOGIN_USUARIO=portaria-teste LOGIN_SENHA=... npx tsx scripts/screenshot.ts <pasta> [rota1 rota2 ...]
 *
 * Variaveis de ambiente:
 *   TESTE_BASE     base do servidor (padrao http://localhost:3001)
 *   LOGIN_USUARIO / LOGIN_SENHA   credenciais (o app exige login; sem elas so a tela de login abre)
 *   VIEWPORT       LARGURAxALTURA (padrao 1180x820 = tablet da portaria; 390x844 = celular)
 * Crie contas de teste com scripts/cria-usuarios-teste.ts. Saida em ASCII.
 */
import fs from "node:fs";
import path from "node:path";
import { abrirNavegador } from "./_navegador";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");

function lerViewport(): { width: number; height: number } {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(process.env.VIEWPORT ?? "1180x820");
  if (!m) throw new Error('VIEWPORT invalido - use LARGURAxALTURA, ex.: 1180x820 ou 390x844');
  return { width: Number(m[1]), height: Number(m[2]) };
}

async function esperarServidor(timeoutMs = 120_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      /* servidor ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Servidor nao respondeu em 120s (${BASE})`);
}

async function main() {
  const [destino, ...rotas] = process.argv.slice(2);
  if (!destino) throw new Error("informe a pasta de destino: screenshot.ts <pasta> [rotas...]");
  const paginas = rotas.length ? rotas : ["/"];
  fs.mkdirSync(destino, { recursive: true });
  const viewport = lerViewport();

  await esperarServidor();
  const browser = await abrirNavegador();
  const contexto = await browser.newContext({
    viewport,
    // celular: toque e user-agent de mobile para os layouts que dependem disso
    ...(viewport.width < 768 ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
  });
  const page = await contexto.newPage();

  const problemas: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problemas.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problemas.push(`pageerror: ${err.message}`));

  const usuario = process.env.LOGIN_USUARIO;
  const senha = process.env.LOGIN_SENHA;
  if (usuario && senha) {
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.fill("#login", usuario);
    await page.fill("#senha", senha);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
      page.click("button[type=submit]"),
    ]);
  }

  for (const rota of paginas) {
    const resp = await page.goto(`${BASE}${rota}`, { waitUntil: "load", timeout: 60_000 });
    // "networkidle" puro trava em producao (prefetch de rotas) - espera curta e segue
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(300);
    const nome =
      rota === "/" ? "home" : rota.replace(/^\//, "").replace(/[\/?&=]+/g, "-").replace(/-+$/, "") || "home";
    const arquivo = path.join(destino, `${nome}-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: arquivo, fullPage: true });
    console.log(`${rota} -> HTTP ${resp?.status()} (chegou em ${new URL(page.url()).pathname}) -> ${arquivo}`);
  }

  await browser.close();
  if (problemas.length) {
    console.log("\nPROBLEMAS DETECTADOS:");
    for (const p of problemas) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log("\nSem erros de console.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
