/**
 * Abre um navegador para os scripts de Playwright, sem exigir `npx playwright install`.
 * Ordem: chromium baixado pelo proprio Playwright -> Google Chrome / Edge instalados
 * -> chromium de outra revisao ja presente em %LOCALAPPDATA%\ms-playwright.
 * (A versao do pacote `playwright` costuma andar na frente do navegador baixado.)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";

export async function abrirNavegador(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    /* tenta o proximo */
  }
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* tenta o proximo */
    }
  }
  const base = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (fs.existsSync(base)) {
    const revisoes = fs
      .readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const rev of revisoes) {
      const exe = path.join(base, rev, "chrome-win64", "chrome.exe");
      if (!fs.existsSync(exe)) continue;
      try {
        return await chromium.launch({ executablePath: exe });
      } catch {
        /* tenta a anterior */
      }
    }
  }
  throw new Error("nenhum navegador disponivel - rode: npx playwright install chromium");
}
