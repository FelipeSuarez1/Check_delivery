/**
 * Teste NO NAVEGADOR (Playwright) da reducao de fotos e do componente
 * FotoCaptura (22/10/2026). Empacota o codigo real com esbuild, abre uma pagina
 * em branco e exercita: reducao (lado maior 1280, JPEG), rotacao EXIF, nao
 * ampliar, arquivo invalido, e o componente (miniaturas, limite de 3, remover).
 * Os bytes que saem do navegador passam pelo validador do SERVIDOR.
 * Nao precisa do site no ar. Saida ASCII; exit 1 se falhar.
 *   npx tsx scripts/teste-captura.ts
 */
import path from "node:path";
import { build } from "esbuild";
import type { Page } from "playwright";
import { abrirNavegador } from "./_navegador";
import { validarFoto } from "../src/lib/fotos";

const RAIZ = path.resolve(__dirname, "..");
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

async function empacotar(entrada: { entryPoints?: string[]; stdin?: { contents: string; resolveDir: string; loader: "tsx" } }, globalName?: string) {
  const r = await build({
    ...entrada,
    bundle: true,
    write: false,
    format: "iife",
    globalName,
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    tsconfig: path.join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    logLevel: "silent",
  });
  return r.outputFiles[0].text;
}

/** Roda dentro do navegador: fabrica imagens de teste. */
const AJUDANTES = `
window.fazerImagem = async function (w, h, tipo, qualidade) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#c47a2c"); g.addColorStop(1, "#1f1d1a");
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = "#ffffff"; x.fillRect(Math.floor(w * 0.1), Math.floor(h * 0.1), Math.floor(w * 0.2), Math.floor(h * 0.1));
  for (let i = 0; i < 4000; i++) { x.fillStyle = "rgba(" + (i % 255) + "," + ((i * 7) % 255) + "," + ((i * 13) % 255) + ",0.6)"; x.fillRect((i * 97) % w, (i * 57) % h, 6, 6); }
  const blob = await new Promise((r) => c.toBlob(r, tipo, qualidade));
  return blob;
};
window.comExifOrientacao6 = async function (blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  const tiff = [0x4d,0x4d,0x00,0x2a,0,0,0,8, 0,1, 0x01,0x12,0,3,0,0,0,1,0,6,0,0, 0,0,0,0];
  const seg = [0xff,0xe1,0x00,0x22, 0x45,0x78,0x69,0x66,0,0].concat(tiff);
  const out = new Uint8Array(b.length + seg.length);
  out.set(b.slice(0, 2), 0); out.set(seg, 2); out.set(b.slice(2), 2 + seg.length);
  return new Blob([out], { type: "image/jpeg" });
};
window.paraB64 = async function (file) {
  const b = new Uint8Array(await file.arrayBuffer());
  let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return btoa(s);
};
`;

type Saida = { ok: boolean; name?: string; type?: string; size?: number; largura?: number; altura?: number; b64?: string; erro?: string; origem?: number };

const CASO = (corpo: string) => `(async () => {
  try {
    ${corpo}
    const r = await window.Reduzir.reduzirImagem(arquivo);
    return { ok: true, name: r.file.name, type: r.file.type, size: r.file.size, largura: r.largura, altura: r.altura, b64: await window.paraB64(r.file), origem: arquivo.size };
  } catch (e) { return { ok: false, erro: String(e && e.message || e), origem: 0 }; }
})()`;

async function testesReducao(page: Page): Promise<void> {
  console.log("--- reducao de foto (navegador)");
  const lib = await empacotar({ entryPoints: [path.join(RAIZ, "src/lib/reduzir-imagem.ts")] }, "Reduzir");
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: lib });
  await page.addScriptTag({ content: AJUDANTES });

  const grande = (await page.evaluate(CASO(`const blob = await window.fazerImagem(3200, 2400, "image/png"); const arquivo = new File([blob], "grande.png", { type: "image/png" });`))) as Saida;
  ok(grande.ok && grande.type === "image/jpeg" && grande.largura === 1280 && grande.altura === 960, "3200x2400 PNG vira 1280x960 JPEG", JSON.stringify({ ...grande, b64: "" }));
  ok(grande.ok && (grande.size as number) < (grande.origem as number) / 4, "arquivo reduzido fica muito menor que o original", `${grande.origem} -> ${grande.size}`);
  ok(/^foto-.+\.jpg$/.test(grande.name ?? ""), "nome gerado foto-*.jpg");
  const v = await validarFoto(new File([new Uint8Array(Buffer.from(grande.b64 ?? "", "base64"))], grande.name ?? "x.jpg", { type: grande.type ?? "" }));
  ok(v.ok && v.ext === "jpg", "bytes do navegador passam no validador do SERVIDOR");

  const pequena = (await page.evaluate(CASO(`const blob = await window.fazerImagem(300, 200, "image/png"); const arquivo = new File([blob], "p.png", { type: "image/png" });`))) as Saida;
  ok(pequena.ok && pequena.largura === 300 && pequena.altura === 200, "imagem pequena nao e ampliada");

  const vertical = (await page.evaluate(CASO(`const blob = await window.fazerImagem(1500, 3000, "image/jpeg", 0.9); const arquivo = new File([blob], "v.jpg", { type: "image/jpeg" });`))) as Saida;
  ok(vertical.ok && vertical.largura === 640 && vertical.altura === 1280, "retrato 1500x3000: lado maior 1280, proporcao mantida");

  const exif = (await page.evaluate(CASO(`const base = await window.fazerImagem(2000, 1500, "image/jpeg", 0.9); const blob = await window.comExifOrientacao6(base); const arquivo = new File([blob], "celular.jpg", { type: "image/jpeg" });`))) as Saida;
  ok(exif.ok && exif.largura === 960 && exif.altura === 1280, "JPEG 2000x1500 com EXIF orientacao 6 sai em pe (960x1280)", JSON.stringify({ ...exif, b64: "" }));

  const texto = (await page.evaluate(CASO(`const arquivo = new File(["isto nao e imagem"], "x.txt", { type: "text/plain" });`))) as Saida;
  ok(!texto.ok && ascii(texto.erro ?? "").includes("Escolha uma foto"), "arquivo que nao e imagem e recusado com mensagem");
  const quebrada = (await page.evaluate(CASO(`const arquivo = new File([new Uint8Array([255, 216, 255, 0, 1, 2, 3])], "q.jpg", { type: "image/jpeg" });`))) as Saida;
  ok(!quebrada.ok && ascii(quebrada.erro ?? "").includes("Nao foi possivel ler"), "imagem corrompida e recusada com mensagem");
}

const adicionar = (n: number, w = 1600, h = 1200) => `(async () => {
  const dt = new DataTransfer();
  for (let i = 0; i < ${n}; i++) {
    const b = await window.fazerImagem(${w}, ${h}, "image/jpeg", 0.9);
    dt.items.add(new File([b], "f" + i + ".jpg", { type: "image/jpeg" }));
  }
  const input = document.querySelector("input[type=file]");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
})()`;

async function testesComponente(page: Page, erros: string[]): Promise<void> {
  console.log("--- componente FotoCaptura (navegador)");
  const entrada = [
    'import { createElement, useState } from "react";',
    'import { createRoot } from "react-dom/client";',
    'import { FotoCaptura } from "@/components/encomenda/foto-captura-client";',
    "function App() {",
    "  const [v, setV] = useState([]);",
    "  window.__fotos = v;",
    "  return createElement(FotoCaptura, { value: v, onChange: setV });",
    "}",
    'createRoot(document.getElementById("raiz")).render(createElement(App));',
  ].join("\n");
  const bundle = await empacotar({ stdin: { contents: entrada, resolveDir: RAIZ, loader: "tsx" } });
  await page.setContent('<!doctype html><html><body><div id="raiz"></div></body></html>');
  await page.addScriptTag({ content: AJUDANTES });
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("text=Tirar foto da etiqueta");

  const n = () => page.evaluate("window.__fotos.length") as Promise<number>;
  const legenda = () => page.locator("figcaption").first().innerText();
  const esperaN = (k: number) => page.waitForFunction(`window.__fotos.length === ${k}`, undefined, { timeout: 15000 });

  const attrs = await page.evaluate(`(() => { const i = document.querySelector("input[type=file]"); return { capture: i.getAttribute("capture"), accept: i.getAttribute("accept") }; })()`) as { capture: string; accept: string };
  ok(attrs.capture === "environment" && attrs.accept === "image/*", "input escondido com capture=environment e accept=image/*");

  await page.evaluate(adicionar(1, 3000, 2250));
  await esperaN(1);
  const f0 = (await page.evaluate(`(() => { const f = window.__fotos[0]; return { type: f.type, size: f.size }; })()`)) as { type: string; size: number };
  ok(f0.type === "image/jpeg" && f0.size > 0, "foto entra reduzida como JPEG");
  ok((await legenda()).includes("Foto 1 de 1") && /KB|MB/.test(await legenda()) && (await legenda()).includes("1280×960"), "legenda mostra tamanho e dimensoes resultantes", await legenda());
  ok((await page.locator('button[aria-label="Remover foto 1"]').count()) === 1 && (await page.locator('button[aria-label="Adicionar outra foto"]').count()) === 1, "miniatura com remover e botao de adicionar");
  ok((await page.locator("figure img").count()) === 1 && (await page.locator("figure img").first().evaluate((el) => (el as HTMLImageElement).naturalWidth)) > 0, "pre-visualizacao grande carrega a imagem");

  await page.evaluate(adicionar(2));
  await esperaN(3);
  ok((await legenda()).includes("Foto 3 de 3"), "ao adicionar, a ultima foto fica selecionada");
  ok((await page.locator('button[aria-label="Adicionar outra foto"]').count()) === 0, "com 3 fotos o botao de adicionar some");
  await page.evaluate(adicionar(1));
  await page.waitForSelector("text=No máximo 3 fotos");
  ok((await n()) === 3, "tentativa de 4a foto e recusada com mensagem");

  await page.locator('button[aria-label="Ver foto 1"]').click();
  ok((await legenda()).includes("Foto 1 de 3"), "clicar na miniatura troca a foto grande");
  await page.locator('button[aria-label="Remover foto 2"]').click();
  await esperaN(2);
  ok((await legenda()).includes("Foto 1 de 2"), "remover a foto 2 mantem a selecao na 1");
  await page.locator('button[aria-label="Remover foto 1"]').click();
  await esperaN(1);
  ok((await legenda()).includes("Foto 1 de 1"), "remover a 1a deixa a restante selecionada");
  await page.locator('button[aria-label="Remover foto 1"]').click();
  await esperaN(0);
  ok((await page.locator("text=Tirar foto da etiqueta").count()) === 1, "sem fotos volta o botao grande");
  ok(erros.length === 0, "nenhum erro de console/pagina durante o componente", erros.join(" | "));
}

async function main(): Promise<void> {
  const navegador = await abrirNavegador();
  try {
    const page = await navegador.newPage();
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") erros.push(`console.error: ${m.text()}`);
    });
    await testesReducao(page);
    await testesComponente(page, erros);
  } finally {
    await navegador.close();
  }
}

main()
  .catch((e) => {
    falhas++;
    console.log(`FAIL excecao nao tratada -> ${ascii(e instanceof Error ? (e.stack ?? e.message) : String(e))}`);
  })
  .finally(() => {
    console.log(`\n${total - falhas}/${total} verificacoes passaram${falhas ? ` - ${falhas} FALHA(S)` : " - TUDO PASS"}`);
    process.exit(falhas > 0 ? 1 : 0);
  });
