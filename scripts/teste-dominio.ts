/**
 * Teste de dominio AUTO-REVERSIVEL (22/10/2026) contra prisma/dev.db.
 * Chama as libs diretamente (as actions precisam de sessao/cookie). Cria seus
 * proprios registros (aptos 991A/992B/995A, porteiros "ZZTESTE ...") e, ao final,
 * APAGA tudo - inclusive os arquivos de foto - e restaura o turno que estava
 * aberto antes. Saida ASCII; exit 1 se algo falhar.
 * Inclui a bateria da recusa de aviso por WhatsApp (LGPD, 23/10/2026, apto 995A) e a prova de que
 * scripts/importa-cadastro.ts nao mexe em Morador.avisoWhatsApp (roda sobre uma COPIA do banco em pasta temporaria).
 *   npx tsx scripts/teste-dominio.ts
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import QRCode from "qrcode";
import { prisma } from "../src/lib/db";
import { ALFABETO, codigoValido, gerarCodigoCandidato, normalizarCodigo, validarCodigo } from "../src/lib/codigo";
import {
  diaLocalISO,
  diasEntre,
  formatarDataHora,
  formatarRelativo,
  inicioDoDiaLocal,
  periodoDeDias,
} from "../src/lib/datas";
import { PARADA_DIAS, TIPOS, diasParada } from "../src/lib/encomenda-constantes";
import * as enc from "../src/lib/encomendas";
import {
  cancelarEncomendaDominio,
  marcarAvisoWhatsAppDominio,
  registrarEncomendaDominio,
  retirarEncomendaDominio,
} from "../src/lib/encomendas-escrita";
import { ErroDominio } from "../src/lib/erro-dominio";
import { DIR_FOTOS, apagarFotosAntigas, caminhoFoto, tipoMimeFoto, validarFoto } from "../src/lib/fotos";
import { abrirTurno, buscarTurnoAberto, fecharTurno } from "../src/lib/turno";
import { linkWhatsApp, mensagemWhatsApp, telefoneParaWhatsApp } from "../src/lib/whatsapp";

const MARCA = "ZZTESTE";
const APTO_A = "991A";
const APTO_B = "992B";
/** apto da bateria de recusa de WhatsApp (LGPD, 23/10/2026) */
const APTO_C = "995A";
const DIA = 86_400_000;

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

/** Espera ErroDominio cuja mensagem (sem acento, minuscula) contem `trecho`. */
async function esperaErro(nome: string, fn: () => Promise<unknown>, trecho: string): Promise<void> {
  try {
    await fn();
    ok(false, nome, "nao lancou erro");
  } catch (e) {
    const msg = e instanceof Error ? ascii(e.message).toLowerCase() : String(e);
    ok(e instanceof ErroDominio && msg.includes(ascii(trecho).toLowerCase()), nome, `mensagem="${msg}"`);
  }
}

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

/** PNG 1x1 valido gerado em memoria. */
function pngMinimo(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 2; // RGB
  const linha = Buffer.from([0, 0xc4, 0x7a, 0x2c]); // filtro 0 + pixel kraft
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", deflateSync(linha)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

const foto = (nome = "etiqueta.png") => new File([new Uint8Array(pngMinimo())], nome, { type: "image/png" });

async function limparTestes(): Promise<void> {
  const aptos = await prisma.apartamento.findMany({ where: { numero: { in: [APTO_A, APTO_B, APTO_C] } }, select: { id: true } });
  const aptoIds = aptos.map((a) => a.id);
  const fotos = await prisma.fotoEncomenda.findMany({ where: { encomenda: { apartamentoId: { in: aptoIds } } } });
  for (const f of fotos) {
    try {
      await unlink(caminhoFoto(f));
    } catch {
      /* ja removido */
    }
  }
  await prisma.fotoEncomenda.deleteMany({ where: { encomenda: { apartamentoId: { in: aptoIds } } } });
  await prisma.encomenda.deleteMany({ where: { apartamentoId: { in: aptoIds } } });
  await prisma.morador.deleteMany({ where: { apartamentoId: { in: aptoIds } } });
  // rede de seguranca do teste de importacao: se o DATABASE_URL da copia nao valesse, estes nomes cairiam aqui
  await prisma.morador.deleteMany({ where: { nome: { startsWith: "ZZTESTE Import" } } });
  await prisma.apartamento.deleteMany({ where: { id: { in: aptoIds } } });
  const porteiros = await prisma.porteiro.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } });
  const pIds = porteiros.map((p) => p.id);
  await prisma.turno.deleteMany({ where: { porteiroId: { in: pIds } } });
  await prisma.porteiro.deleteMany({ where: { id: { in: pIds } } });
}

async function arquivosEmUploads(): Promise<string[]> {
  try {
    return (await readdir(DIR_FOTOS)).sort();
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ unidades puras */

async function testesPuros(): Promise<void> {
  console.log("--- codigo");
  ok(ALFABETO.length === 32 && !/[01OI]/.test(ALFABETO), "alfabeto: 32 simbolos, sem 0/O/1/I");
  let todosValidos = true;
  const vistos = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const c = gerarCodigoCandidato();
    if (!codigoValido(c)) todosValidos = false;
    vistos.add(c);
  }
  ok(todosValidos, "5000 candidatos: todos no formato (4 chars do alfabeto)");
  ok(vistos.size > 4500, "candidatos variados", `distintos=${vistos.size}`);
  ok(normalizarCodigo("k7m3") === "K7M3", "normaliza minuscula");
  ok(normalizarCodigo(" k7-m3 ") === "K7M3", "normaliza espaco e hifen");
  ok(!validarCodigo("K0M3").ok && /nunca usam/.test(ascii((validarCodigo("K0M3") as { erro: string }).erro)), "rejeita 0 com mensagem clara");
  ok(!validarCodigo("KOM3").ok && !validarCodigo("K1M3").ok && !validarCodigo("KIM3").ok, "rejeita O, 1 e I (sem converter)");
  ok(!validarCodigo("K7M").ok && !validarCodigo("K7M35").ok, "rejeita tamanho diferente de 4");
  ok(!validarCodigo("K7M@").ok && !validarCodigo("").ok, "rejeita simbolo e vazio");
  ok(!codigoValido("k7m3") && codigoValido("K7M3"), "codigoValido e estrito (so maiuscula normalizada)");

  console.log("--- datas");
  const agora = new Date("2026-10-22T19:48:00Z"); // quinta 22/10 16:48 em Sao Paulo
  ok(formatarDataHora("2026-10-22T19:48:00Z") === "22/10 16:48", "formatarDataHora 22/10 16:48");
  ok(formatarRelativo("2026-10-22T17:32:00Z", agora) === "hoje 14:32", "relativo: hoje");
  ok(formatarRelativo("2026-10-21T12:12:00Z", agora) === "ontem 09:12", "relativo: ontem");
  ok(formatarRelativo("2026-10-18T14:05:00Z", agora) === "dom 18/10 11:05", "relativo: dia da semana + data");
  ok(formatarRelativo("2026-10-23T01:30:00Z", agora) === "hoje 22:30", "relativo: noite em UTC do dia seguinte ainda e hoje em SP");
  ok(formatarRelativo("2025-10-18T14:05:00Z", agora) === "sáb 18/10/2025 11:05", "relativo: outro ano mostra o ano");
  ok(diasEntre("2026-10-18T15:00:00Z", agora) === 4, "diasEntre: dias completos");
  ok(diasEntre("2026-10-19T20:00:00Z", agora) === 2, "diasEntre: 2d23h = 2 (nao arredonda para cima)");
  ok(diasEntre(agora, "2026-10-01T00:00:00Z") === 0, "diasEntre nunca negativo");
  ok(inicioDoDiaLocal("2026-10-22T19:48:00Z").toISOString() === "2026-10-22T03:00:00.000Z", "inicioDoDiaLocal");
  ok(inicioDoDiaLocal("2026-10-22T02:00:00Z").toISOString() === "2026-10-21T03:00:00.000Z", "inicioDoDiaLocal: 23h de ontem em SP");
  const per = periodoDeDias("2026-10-01", "2026-10-22");
  ok(
    new Date(per.de as Date).toISOString() === "2026-10-01T03:00:00.000Z" &&
      new Date(per.ate as Date).toISOString() === "2026-10-23T03:00:00.000Z",
    "periodoDeDias: ate inclusivo vira limite exclusivo"
  );
  ok(periodoDeDias("lixo", "2026-02-30").de == null && periodoDeDias("lixo", "2026-02-30").ate == null, "periodoDeDias: datas invalidas = aberto");

  console.log("--- whatsapp");
  ok(telefoneParaWhatsApp("(11) 99100-1288") === "5511991001288", "telefone BR com mascara ganha 55");
  ok(telefoneParaWhatsApp("+55 11 99100-1288") === "5511991001288", "telefone com DDI nao duplica");
  ok(telefoneParaWhatsApp("011 99100-1288") === "5511991001288", "zero de tronco e removido");
  ok(telefoneParaWhatsApp("55 99123-4567") === "5555991234567", "DDD 55 (RS) tem 11 digitos: ganha 55");
  ok(telefoneParaWhatsApp("99100-1288") === null && telefoneParaWhatsApp("") === null && telefoneParaWhatsApp(null) === null, "telefone curto/vazio = null");
  const msg = mensagemWhatsApp({ codigo: "K7M3", tipo: "caixa", transportadora: "Mercado Livre", destinatarioNome: "Felipe Suarez", apartamento: "11A" });
  ok(
    msg === "Olá, Felipe! Chegou uma encomenda para você na portaria do Espaço Tangará. Código K7M3 · Caixa · Mercado Livre. Qualquer morador do 11A pode retirar mostrando o código. — Portaria",
    "mensagem do WhatsApp igual ao contrato"
  );
  const msg2 = mensagemWhatsApp({ codigo: "K7M3", tipo: "envelope", destinatarioNome: "DUTRA", apartamento: "101B" });
  ok(msg2.startsWith("Olá, Dutra!") && msg2.includes("Código K7M3 · Envelope."), "nome em caixa alta vira Capitalizado; sem transportadora");
  const msg3 = mensagemWhatsApp({ codigo: "K7M3", tipo: "caixa", destinatarioNome: "Carol Fantoni", apartamento: "181A" }, { saudacaoNome: "Ana Lima" });
  ok(msg3.startsWith("Olá, Ana! Chegou uma encomenda para Carol"), "telefone de outro morador: saudacao dele, 'para <destinatario>'");
  const link = linkWhatsApp("(11) 99100-1288", msg) ?? "";
  ok(link.startsWith("https://wa.me/5511991001288?text=") && decodeURIComponent(link.split("?text=")[1]) === msg, "linkWhatsApp: wa.me + texto codificado");
  ok(linkWhatsApp("123", msg) === null, "linkWhatsApp: telefone sem digitos suficientes = null");

  console.log("--- constantes e fotos (validacao)");
  ok(PARADA_DIAS === 3 && TIPOS.length === 5, "PARADA_DIAS=3 e 5 tipos");
  ok(diasParada({ status: "aguardando", recebidaEm: new Date(Date.now() - 4 * DIA - 60_000) }) === 4, "diasParada: 4 dias");
  ok(diasParada({ status: "aguardando", recebidaEm: new Date(Date.now() - 2 * DIA) }) === 2, "diasParada: 2 dias");
  ok(diasParada({ status: "entregue", recebidaEm: new Date(Date.now() - 9 * DIA) }) === 0, "diasParada: entregue nao para");
  ok((await validarFoto(foto("a.png"))).ok, "foto PNG valida");
  ok((await validarFoto(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])], "a.jpg", { type: "image/jpeg" }))).ok, "foto JPEG (assinatura) valida");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
  ok((await validarFoto(new File([new Uint8Array(webp)], "a.webp", { type: "image/webp" }))).ok, "foto WebP (assinatura) valida");
  ok(!(await validarFoto(new File(["<html>oi</html>"], "x.jpg", { type: "image/jpeg" }))).ok, "rejeita texto com nome .jpg");
  ok(!(await validarFoto(new File([new Uint8Array(pngMinimo())], "x.gif", { type: "image/gif" }))).ok, "rejeita .gif");
  ok(!(await validarFoto(new File([new Uint8Array(pngMinimo())], "x.jpg", { type: "image/jpeg" }))).ok, "rejeita PNG com nome .jpg (conteudo nao bate)");
  ok(!(await validarFoto(new File([], "vazia.png", { type: "image/png" }))).ok, "rejeita arquivo vazio");
  const grande = Buffer.alloc(10 * 1024 * 1024 + 1);
  pngMinimo().copy(grande);
  ok(!(await validarFoto(new File([new Uint8Array(grande)], "grande.png", { type: "image/png" }))).ok, "rejeita mais de 10 MB");
  ok(!(await validarFoto("nao e arquivo")).ok, "rejeita valor que nao e arquivo");
  let travessia = false;
  try {
    caminhoFoto({ arquivo: "../../etc/passwd" });
  } catch {
    travessia = true;
  }
  ok(travessia, "caminhoFoto barra path traversal");
  ok(caminhoFoto({ arquivo: "12-1-0123456789abcdef.jpg" }).startsWith(DIR_FOTOS), "caminhoFoto fica dentro de uploads/encomendas");
  ok(tipoMimeFoto("1-1-0123456789abcdef.webp") === "image/webp" && tipoMimeFoto("x.html") === null, "tipoMimeFoto pela extensao");
  const svg = await QRCode.toString("K7M3", { type: "svg", margin: 2 });
  ok(svg.startsWith("<svg") && svg.includes("viewBox"), "qrcode gera SVG");
}

/* --------------------------------------------------------- fluxo de dominio */

type Ap = { id: number; numero: string };
type Mor = { id: number; nome: string };
type Port = { id: number; nome: string };
type Ctx = { aptoA: Ap; aptoB: Ap; joao: Mor; maria: Mor; antigo: Mor; pedro: Mor; pA: Port; pB: Port };
type Reg = Awaited<ReturnType<typeof registrarEncomendaDominio>>;
type Encs = { e1: Reg; e2: Reg; e3: Reg; e4: Reg };
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function testesDominio(): Promise<void> {
  console.log("--- setup");
  const pA = await prisma.porteiro.create({ data: { nome: `${MARCA} Ana` } });
  const pB = await prisma.porteiro.create({ data: { nome: `${MARCA} Beto` } });
  const aptoA = await prisma.apartamento.create({ data: { numero: APTO_A, torre: "A", andar: 99 } });
  const aptoB = await prisma.apartamento.create({ data: { numero: APTO_B, torre: "B", andar: 99 } });
  const joao = await prisma.morador.create({ data: { apartamentoId: aptoA.id, nome: "João Silva", telefone: "(11) 99100-1288" } });
  const maria = await prisma.morador.create({ data: { apartamentoId: aptoA.id, nome: "Maria Souza" } });
  const antigo = await prisma.morador.create({ data: { apartamentoId: aptoA.id, nome: "Antigo Inquilino", telefone: "11 97777-6666", ativo: false } });
  const pedro = await prisma.morador.create({ data: { apartamentoId: aptoB.id, nome: "Pedro Lima", telefone: "11 98888-7777" } });
  const arquivosAntes = await arquivosEmUploads();
  const contar = () => prisma.encomenda.count({ where: { apartamentoId: { in: [aptoA.id, aptoB.id] } } });

  console.log("--- turno");
  await fecharTurno();
  ok((await buscarTurnoAberto()) === null, "sem turno aberto");
  await esperaErro("registrar sem turno falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: joao.id, tipo: "caixa", fotos: [foto()] }), "Abra o turno");
  await esperaErro("retirar sem turno falha", () => retirarEncomendaDominio({ codigo: "K7M3", terceiroNome: "Fulano" }), "Abra o turno");
  const t1 = await abrirTurno(pA.id);
  ok(!t1.reaproveitado && t1.turno.porteiroId === pA.id, "abrir turno do porteiro A");
  const t1b = await abrirTurno(pA.id);
  ok(t1b.reaproveitado && t1b.turno.id === t1.turno.id, "reabrir o mesmo porteiro reaproveita o turno");
  ok((await prisma.turno.count({ where: { fim: null } })) === 1, "um unico turno aberto");

  console.log("--- registrar");
  const antes = await contar();
  await esperaErro("sem foto falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: joao.id, tipo: "caixa", fotos: [] }), "pelo menos 1 foto");
  await esperaErro("4 fotos falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: joao.id, tipo: "caixa", fotos: [foto(), foto(), foto(), foto()] }), "No maximo 3");
  await esperaErro("foto invalida falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: joao.id, tipo: "caixa", fotos: [new File(["<html>"], "x.jpg", { type: "image/jpeg" })] }), "imagem");
  await esperaErro("morador de outro apto falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: pedro.id, tipo: "caixa", fotos: [foto()] }), "nao esta ativo");
  await esperaErro("morador inativo falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: antigo.id, tipo: "caixa", fotos: [foto()] }), "nao esta ativo");
  await esperaErro("sem destinatario falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, tipo: "caixa", fotos: [foto()] }), "para quem");
  await esperaErro("apto inexistente falha", () => registrarEncomendaDominio({ apartamentoId: 99999999, destinatarioNome: "Fulano", tipo: "caixa", fotos: [foto()] }), "Apartamento");
  await esperaErro("tipo invalido falha", () => registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioNome: "Fulano", tipo: "foguete" as never, fotos: [foto()] }), "tipo");
  ok((await contar()) === antes, "entradas invalidas nao criam encomenda");
  ok(JSON.stringify(await arquivosEmUploads()) === JSON.stringify(arquivosAntes), "entradas invalidas nao deixam arquivo no disco");

  const e1 = await registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: joao.id, tipo: "caixa", transportadora: "Mercado Livre", local: "Prateleira A3", fotos: [foto(), foto("volume.png")] });
  ok(codigoValido(e1.codigo), "codigo gerado e valido", e1.codigo);
  ok((await prisma.encomenda.count({ where: { codigo: e1.codigo } })) === 1, "codigo unico no banco");
  ok(e1.porteiroId === pA.id && e1.destinatarioNome === "João Silva" && e1.totalFotos === 2, "porteiro do turno e destinatario gravados");
  const fotosE1 = await prisma.fotoEncomenda.findMany({ where: { encomendaId: e1.id }, orderBy: { ordem: "asc" } });
  ok(fotosE1.length === 2 && fotosE1.every((f) => new RegExp(`^${e1.id}-[12]-[0-9a-f]{16}[.]png$`).test(f.arquivo)), "fotos com nome gerado <id>-<ordem>-<hex>.png");
  const st = await stat(caminhoFoto(fotosE1[0])).catch(() => null);
  ok(!!st && st.size > 0 && caminhoFoto(fotosE1[0]).startsWith(DIR_FOTOS), "arquivo existe em uploads/encomendas");
  const e2 = await registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioNome: "  Visita   do Joao ", tipo: "envelope", fotos: [foto()] });
  const e3 = await registrarEncomendaDominio({ apartamentoId: aptoB.id, destinatarioMoradorId: pedro.id, tipo: "sacola", transportadora: "Correios", fotos: [foto()] });
  const e4 = await registrarEncomendaDominio({ apartamentoId: aptoA.id, destinatarioMoradorId: maria.id, tipo: "mercado", fotos: [foto()] });
  const codigos = new Set([e1.codigo, e2.codigo, e3.codigo, e4.codigo]);
  ok(codigos.size === 4, "codigos distintos entre encomendas");
  const e2db = await prisma.encomenda.findUniqueOrThrow({ where: { id: e2.id } });
  ok(e2db.destinatarioNome === "Visita do Joao" && e2db.destinatarioMoradorId === null, "nome livre: espacos limpos e sem morador");
  const gerado = await enc.gerarCodigo();
  ok(codigoValido(gerado) && !codigos.has(gerado) && (await prisma.encomenda.count({ where: { codigo: gerado } })) === 0, "gerarCodigo devolve codigo inexistente");

  // e3 fica "velha" (4 dias) e anterior ao inicio do turno atual: e o caso do "outro turno"
  await prisma.encomenda.update({ where: { id: e3.id }, data: { recebidaEm: new Date(Date.now() - 4 * DIA - 3600_000) } });
  const ctx: Ctx = { aptoA, aptoB, joao, maria, antigo, pedro, pA, pB };
  const encs: Encs = { e1, e2, e3, e4 };
  await testesLeituras(ctx, encs);
  await testesRetirada(ctx, encs);
  await testesCancelamento(ctx, encs);
  await testesAviso(ctx, encs);
  await testesRetencaoHistorico(ctx, encs);
  await testesRecusaWhatsApp();
  await testesImportacaoNaoMexeNaRecusa();
}

/* ------------------------------------------------------------------ leituras */

async function testesLeituras(c: Ctx, { e1, e2, e3, e4 }: Encs): Promise<void> {
  console.log("--- leituras");
  const nossos = new Set([e1.id, e2.id, e3.id, e4.id]);
  const ids = (l: { id: number }[]) => l.map((x) => x.id);
  const so = (l: { id: number }[]) => ids(l).filter((i) => nossos.has(i));

  const aguardando = await enc.listarAguardando();
  ok([e1, e2, e3, e4].every((e) => ids(aguardando).includes(e.id)), "listarAguardando contem as 4 encomendas");
  ok(so(aguardando)[0] === e3.id, "listarAguardando: mais antiga primeiro");
  const r3 = aguardando.find((x) => x.id === e3.id);
  ok(!!r3 && r3.parada && r3.diasParada === 4, "e3 aparece como parada ha 4 dias", JSON.stringify(r3?.diasParada));
  ok(!aguardando.find((x) => x.id === e1.id)?.parada, "e1 recente nao esta parada");
  ok(so(await enc.listarAguardando({ torre: "A" })).includes(e1.id) && !so(await enc.listarAguardando({ torre: "A" })).includes(e3.id), "filtro torre A");
  ok(so(await enc.listarAguardando({ torre: "B" })).join() === String(e3.id), "filtro torre B");
  ok(so(await enc.listarAguardando({ apartamentoId: c.aptoA.id })).sort().join() === [e1.id, e2.id, e4.id].sort().join(), "filtro por apartamento");
  const busca = async (b: string) => so(await enc.listarAguardando({ busca: b }));
  ok((await busca(e1.codigo.toLowerCase())).includes(e1.id), "busca por codigo (minuscula)");
  ok((await busca("joao")).sort().join() === [e1.id, e2.id].sort().join(), "busca por nome sem acento (joao)");
  ok((await busca("991a")).includes(e1.id) && !(await busca("991a")).includes(e3.id), "busca por apto exato");
  ok((await busca("991")).includes(e1.id), "busca so com numero do andar (991 -> 991A)");
  ok((await busca("992b")).join() === String(e3.id), "busca por apto da torre B");
  ok((await busca("mercado livre")).join() === String(e1.id), "busca com 2 palavras (E) em transportadora");
  ok((await busca("zzzznaoexiste")).length === 0, "busca sem resultado");

  const porCodigo = await enc.buscarPorCodigo(`${e1.codigo.slice(0, 2)}-${e1.codigo.slice(2)}`.toLowerCase());
  ok(porCodigo?.id === e1.id && porCodigo.local === "Prateleira A3" && porCodigo.fotos.length === 2, "buscarPorCodigo aceita minuscula/hifen e traz fotos");
  ok((await enc.buscarPorCodigo("K0M3")) === null && (await enc.buscarPorCodigo(await enc.gerarCodigo())) === null, "buscarPorCodigo: invalido/inexistente = null");

  const doMorador = await enc.encomendaParaMorador(e1.id, c.aptoA.id);
  ok(doMorador?.id === e1.id, "encomendaParaMorador: do proprio apto");
  ok((await enc.encomendaParaMorador(e1.id, c.aptoB.id)) === null, "encomendaParaMorador: de outro apto = null");
  ok((await enc.encomendaParaMoradorPorCodigo(e1.codigo, c.aptoB.id)) === null, "encomendaParaMoradorPorCodigo: de outro apto = null");
  ok((await enc.encomendaParaMoradorPorCodigo(e1.codigo.toLowerCase(), c.aptoA.id))?.id === e1.id, "encomendaParaMoradorPorCodigo: proprio apto");
  const json = JSON.stringify(doMorador);
  ok(!json.includes("99100") && !/telefone/i.test(json), "tipos de saida nao carregam telefone");
  const lista = await enc.listarDoApartamento(c.aptoA.id);
  ok([e1.id, e2.id, e4.id].every((i) => ids(lista.aguardando).includes(i)) && !ids(lista.aguardando).includes(e3.id), "listarDoApartamento: aguardando so do apto");
  ok(lista.historico.length === 0, "listarDoApartamento: historico vazio por enquanto");

  const resumo = await enc.resumoPortaria();
  ok(resumo.aguardando >= 4 && resumo.torreA >= 3 && resumo.torreB >= 1 && resumo.paradas >= 1, "resumoPortaria conta aguardando, torres e paradas");
  ok((await enc.listarApartamentos()).some((a) => a.numero === APTO_A), "listarApartamentos");
  ok((await enc.buscarApartamentoPorNumero(" 991a "))?.id === c.aptoA.id && (await enc.buscarApartamentoPorNumero("abc")) === null, "buscarApartamentoPorNumero");
  const ms = await enc.listarMoradoresDoApartamento(c.aptoA.id);
  ok(ms.length === 2 && ms.find((m) => m.id === c.joao.id)?.temTelefone === true && ms.find((m) => m.id === c.maria.id)?.temTelefone === false, "listarMoradoresDoApartamento: so ativos, flag de telefone");
  ok(ms.every((m) => m.avisoWhatsApp === true), "listarMoradoresDoApartamento: moradores sem escolha aceitam WhatsApp (padrao)");
}

/* ------------------------------------------------------------------ retirada */

async function testesRetirada(c: Ctx, { e1, e2, e3 }: Encs): Promise<void> {
  console.log("--- retirada");
  await esperaErro("codigo com 0 e rejeitado", () => retirarEncomendaDominio({ codigo: "K0M3", terceiroNome: "Fulano" }), "nunca usam");
  await esperaErro("codigo inexistente", () => retirarEncomendaDominio({ codigo: "ZZZZ", terceiroNome: "Fulano" }), "nao encontrado");
  await esperaErro("sem quem retirou", () => retirarEncomendaDominio({ codigo: e1.codigo }), "quem retirou");
  await esperaErro("morador E terceiro juntos", () => retirarEncomendaDominio({ codigo: e1.codigo, retiradaPorMoradorId: c.joao.id, terceiroNome: "Fulano" }), "so quem retirou");
  await esperaErro("terceiro com nome de 1 letra", () => retirarEncomendaDominio({ codigo: e1.codigo, terceiroNome: "F" }), "nome");
  await esperaErro("morador de OUTRO apto", () => retirarEncomendaDominio({ codigo: e1.codigo, retiradaPorMoradorId: c.pedro.id }), "nao esta ativo");
  await esperaErro("morador inativo", () => retirarEncomendaDominio({ codigo: e1.codigo, retiradaPorMoradorId: c.antigo.id }), "nao esta ativo");
  ok((await prisma.encomenda.findUniqueOrThrow({ where: { id: e1.id } })).status === "aguardando", "tentativas invalidas nao alteram a encomenda");

  const r1 = await retirarEncomendaDominio({ codigo: e1.codigo.toLowerCase(), retiradaPorMoradorId: c.maria.id });
  const d1 = await prisma.encomenda.findUniqueOrThrow({ where: { id: e1.id } });
  ok(r1.retiradaPor === "Maria Souza" && !r1.terceiro, "retirada por morador do mesmo apto");
  ok(d1.status === "entregue" && !!d1.entregueEm && d1.entreguePorPorteiroId === c.pA.id && d1.retiradaPorMoradorId === c.maria.id, "grava status, data, porteiro do turno e morador");
  await esperaErro("retirar de novo falha", () => retirarEncomendaDominio({ codigo: e1.codigo, retiradaPorMoradorId: c.joao.id }), "ja foi entregue");

  const disputa = await Promise.allSettled([
    retirarEncomendaDominio({ codigo: e2.codigo, terceiroNome: "Fulano de Tal", terceiroDoc: "RG 12.345.678" }),
    retirarEncomendaDominio({ codigo: e2.codigo, terceiroNome: "Beltrano" }),
  ]);
  ok(disputa.filter((x) => x.status === "fulfilled").length === 1 && disputa.filter((x) => x.status === "rejected").length === 1, "duas confirmacoes simultaneas: so uma entrega");
  const d2 = await prisma.encomenda.findUniqueOrThrow({ where: { id: e2.id } });
  ok(d2.status === "entregue" && !!d2.retiradaTerceiroNome && d2.retiradaPorMoradorId === null, "terceiro gravado, sem morador");
  const det2 = await enc.buscarPorCodigo(e2.codigo);
  ok(det2?.retiradaPorTerceiro === true && det2.retiradaPor === d2.retiradaTerceiroNome, "resumo marca retirada por terceiro");

  const hoje = await enc.listarEntreguesHoje();
  ok([e1.id, e2.id].every((i) => hoje.some((x) => x.id === i)), "listarEntreguesHoje contem as entregas");
  const eh = await enc.listarEntreguesHoje();
  ok(!eh.some((x) => x.id === e3.id), "e3 (aguardando) nao esta nas entregues");
  const lista = await enc.listarDoApartamento(c.aptoA.id);
  ok(lista.historico.some((x) => x.id === e1.id) && !lista.aguardando.some((x) => x.id === e1.id), "listarDoApartamento: entregue vai para o historico");
}

/* -------------------------------------------------------------- cancelamento */

async function testesCancelamento(c: Ctx, { e1, e3, e4 }: Encs): Promise<void> {
  console.log("--- cancelamento");
  await esperaErro("motivo curto", () => cancelarEncomendaDominio({ id: e4.id, motivo: "ab", admin: true }), "motivo");
  await esperaErro("portaria nao cancela de outro turno (e3)", () => cancelarEncomendaDominio({ id: e3.id, motivo: "registro duplicado", admin: false }), "outro turno");
  await esperaErro("encomenda entregue nao cancela", () => cancelarEncomendaDominio({ id: e1.id, motivo: "registro duplicado", admin: true }), "ja foi entregue");
  await esperaErro("encomenda inexistente", () => cancelarEncomendaDominio({ id: 99999999, motivo: "registro duplicado", admin: true }), "nao encontrada");

  const c4 = await cancelarEncomendaDominio({ id: e4.id, motivo: "  foto do volume errado ", admin: false });
  const d4 = await prisma.encomenda.findUniqueOrThrow({ where: { id: e4.id } });
  ok(c4.codigo === e4.codigo && d4.status === "cancelada" && d4.canceladaMotivo === "foto do volume errado" && !!d4.canceladaEm, "portaria cancela no proprio turno (status + motivo, nada apagado)");
  ok((await prisma.encomenda.count({ where: { id: e4.id } })) === 1 && (await prisma.fotoEncomenda.count({ where: { encomendaId: e4.id } })) === 1, "cancelar nao apaga registro nem foto");
  await esperaErro("cancelar duas vezes", () => cancelarEncomendaDominio({ id: e4.id, motivo: "de novo", admin: true }), "ja esta cancelada");
  await esperaErro("retirar encomenda cancelada", () => retirarEncomendaDominio({ codigo: e4.codigo, terceiroNome: "Fulano" }), "cancelado");

  const c3 = await cancelarEncomendaDominio({ id: e3.id, motivo: "etiqueta errada", admin: true });
  ok(c3.id === e3.id && (await prisma.encomenda.findUniqueOrThrow({ where: { id: e3.id } })).status === "cancelada", "admin cancela de qualquer turno");

  // troca de turno: o que foi registrado antes passa a ser so do admin
  const e5 = await registrarEncomendaDominio({ apartamentoId: c.aptoA.id, destinatarioNome: "Visita", tipo: "caixa", fotos: [foto()] });
  await dorme(25);
  const troca = await abrirTurno(c.pB.id);
  ok(!troca.reaproveitado && troca.anterior?.porteiroId === c.pA.id && (await prisma.turno.count({ where: { fim: null } })) === 1, "trocar de turno encerra o anterior");
  await esperaErro("portaria nao cancela registro do turno anterior (e5)", () => cancelarEncomendaDominio({ id: e5.id, motivo: "registro duplicado", admin: false }), "outro turno");
  await cancelarEncomendaDominio({ id: e5.id, motivo: "registro duplicado", admin: true });
  ok((await prisma.encomenda.findUniqueOrThrow({ where: { id: e5.id } })).status === "cancelada", "admin cancela registro de turno anterior");

  const e6 = await registrarEncomendaDominio({ apartamentoId: c.aptoA.id, destinatarioMoradorId: c.joao.id, tipo: "perecivel", fotos: [foto()] });
  ok(e6.porteiroId === c.pB.id, "novo turno: registro grava o porteiro B");
  await retirarEncomendaDominio({ codigo: e6.codigo, retiradaPorMoradorId: c.joao.id });
  ok((await prisma.encomenda.findUniqueOrThrow({ where: { id: e6.id } })).entreguePorPorteiroId === c.pB.id, "novo turno: entrega grava o porteiro B");
  const e8 = await registrarEncomendaDominio({ apartamentoId: c.aptoA.id, destinatarioNome: "Visita 2", tipo: "caixa", fotos: [foto()] });
  await fecharTurno();
  await esperaErro("portaria sem turno nao cancela", () => cancelarEncomendaDominio({ id: e8.id, motivo: "registro duplicado", admin: false }), "Abra o turno");
  await cancelarEncomendaDominio({ id: e8.id, motivo: "registro duplicado", admin: true });
  ok((await buscarTurnoAberto()) === null, "encerrar turno");
  await abrirTurno(c.pA.id);
}

/* ------------------------------------------------------------------- aviso */

const novos: { e7?: number } = {};

async function testesAviso(c: Ctx, { e1, e3 }: Encs): Promise<void> {
  console.log("--- aviso WhatsApp");
  const e7 = await registrarEncomendaDominio({ apartamentoId: c.aptoA.id, destinatarioNome: "Visita", tipo: "caixa", transportadora: "Amazon", fotos: [foto()] });
  const av = await enc.prepararAviso(e7.id);
  const texto = av.ok ? decodeURIComponent(av.link.split("?text=")[1]) : "";
  ok(av.ok && av.link.startsWith("https://wa.me/5511991001288?text=") && av.paraNome === "João Silva", "aviso sem destinatario cadastrado usa o 1o morador com telefone");
  ok(texto.startsWith("Olá, João! Chegou uma encomenda para Visita ") && texto.includes(`Código ${e7.codigo} · Caixa · Amazon.`), "mensagem diz para o destinatario quando o telefone e de outro");
  const avJoao = await enc.prepararAviso(e1.id);
  ok(avJoao.ok && decodeURIComponent(avJoao.link.split("?text=")[1]).includes("para você"), "aviso ao proprio destinatario diz para voce");
  const marcado = await marcarAvisoWhatsAppDominio(e7.id);
  ok(marcado.ok && !!(await prisma.encomenda.findUniqueOrThrow({ where: { id: e7.id } })).avisoWhatsAppEm, "marcarAviso grava avisoWhatsAppEm");
  await esperaErro("aviso de encomenda entregue", () => marcarAvisoWhatsAppDominio(e1.id), "nao esta mais aguardando");
  await prisma.morador.update({ where: { id: c.pedro.id }, data: { telefone: null } });
  const semTel = await enc.prepararAviso(e3.id);
  ok(!semTel.ok && /telefone/.test(semTel.ok ? "" : semTel.erro), "apto sem telefone: link null + erro explicando");
  novos.e7 = e7.id;
}

/* ------------------------------------------------- retencao e historico */

async function testesRetencaoHistorico(c: Ctx, { e1, e2, e3, e4 }: Encs): Promise<void> {
  const e7 = novos.e7 as number;
  console.log("--- retencao de fotos");
  const escopo = { encomendaIds: [e1.id, e3.id, e4.id, e7] };
  const seco0 = await apagarFotosAntigas(90, false, escopo);
  ok(seco0.itens.length === 0, "retencao: nada com menos de 90 dias");
  await prisma.encomenda.update({ where: { id: e1.id }, data: { entregueEm: new Date(Date.now() - 100 * DIA) } });
  await prisma.encomenda.update({ where: { id: e3.id }, data: { canceladaEm: new Date(Date.now() - 100 * DIA) } });
  const fotosE1 = await prisma.fotoEncomenda.findMany({ where: { encomendaId: e1.id } });
  const seco = await apagarFotosAntigas(90, false, escopo);
  ok(seco.itens.length === 3 && !seco.aplicado && seco.apagadas === 0, "dry-run lista fotos de entregue (2) e cancelada (1) antigas", String(seco.itens.length));
  ok(!!(await stat(caminhoFoto(fotosE1[0])).catch(() => null)) && (await prisma.fotoEncomenda.count({ where: { encomendaId: e1.id, apagadaEm: null } })) === 2, "dry-run nao mexe em arquivo nem banco");
  await apagarFotosAntigas(90, false); // sem escopo tambem roda (so lista)
  const real = await apagarFotosAntigas(90, true, escopo);
  ok(real.apagadas === 3 && real.falhas.length === 0, "aplicar remove os arquivos");
  ok(!(await stat(caminhoFoto(fotosE1[0])).catch(() => null)) && (await prisma.fotoEncomenda.count({ where: { encomendaId: e1.id, apagadaEm: { not: null } } })) === 2, "arquivo sumiu, registro ficou com apagadaEm");
  ok((await apagarFotosAntigas(90, true, escopo)).itens.length === 0, "aplicar de novo e idempotente");
  const d1 = await enc.buscarPorId(e1.id);
  ok(d1?.fotoId === null && d1.fotos.length === 0 && d1.status === "entregue", "resumo sem foto depois da retencao (encomenda intacta)");
  let rejeitou = false;
  await apagarFotosAntigas(0).catch(() => (rejeitou = true));
  ok(rejeitou, "retencao recusa dias < 1");

  console.log("--- historico");
  const hoje = diaLocalISO(new Date());
  const idsDe = (l: { id: number }[]) => l.map((x) => x.id);
  const ha5 = diaLocalISO(new Date(Date.now() - 5 * DIA));
  const geralA = await enc.listarHistoricoGeral(periodoDeDias(hoje, hoje), { torre: "A" });
  ok([e1.id, e2.id, e4.id, e7].every((i) => idsDe(geralA).includes(i)) && !idsDe(geralA).includes(e3.id), "historico geral: hoje, torre A");
  ok(idsDe(await enc.listarHistoricoGeral(periodoDeDias(ha5, hoje), { torre: "B" })).includes(e3.id), "historico geral: periodo de 5 dias traz a e3 antiga");
  ok(!idsDe(await enc.listarHistoricoGeral(periodoDeDias("2020-01-01", "2020-01-31"), {})).some((i) => [e1.id, e2.id, e3.id].includes(i)), "historico geral: periodo passado nao traz nada nosso");
  const canceladas = idsDe(await enc.listarHistoricoGeral(undefined, { status: "cancelada", apartamentoId: c.aptoA.id }));
  ok(canceladas.includes(e4.id) && !canceladas.includes(e1.id), "historico geral: filtro de status + apto");
  // na disputa da retirada qualquer um dos dois terceiros pode ter vencido: busca pelo que ficou gravado
  const vencedor = (await prisma.encomenda.findUniqueOrThrow({ where: { id: e2.id } })).retiradaTerceiroNome ?? "";
  const buscaTerceiro = ascii(vencedor).split(" ")[0].toLowerCase();
  ok(buscaTerceiro.length > 2 && idsDe(await enc.listarHistoricoGeral(undefined, { status: "entregue", busca: buscaTerceiro })).includes(e2.id), "historico geral: busca pelo nome do terceiro");
  ok((await enc.listarHistoricoGeral(undefined, { limite: 2 })).length <= 2, "historico geral respeita o limite");
  const doApto = idsDe(await enc.listarHistoricoApartamento(c.aptoA.id));
  ok([e1.id, e2.id, e4.id, e7].every((i) => doApto.includes(i)) && !doApto.includes(e3.id), "historico do apartamento (todos os status)");
  const ordem = await enc.listarHistoricoApartamento(c.aptoA.id);
  ok(ordem.every((x, i) => i === 0 || ordem[i - 1].recebidaEm >= x.recebidaEm), "historico: mais recente primeiro");
  ok(formatarDataHora(ordem[0].recebidaEm).length === 11, "formatarDataHora sobre ISO do resumo");
}

/* ------------------------------------------- recusa de aviso por WhatsApp (LGPD) */

/**
 * 23/10/2026: o morador pode recusar o aviso por WhatsApp (`Morador.avisoWhatsApp`). A recusa e da PESSOA:
 * destinatario que recusou = nenhum link (nem fallback para outro morador); destinatario sem telefone ou
 * "outro nome" = fallback so entre quem aceita. Cada passo muda o cadastro e consulta de novo (a decisao
 * e tomada contra o banco no momento do aviso, nao na hora em que a tela abriu).
 */
async function testesRecusaWhatsApp(): Promise<void> {
  console.log("--- recusa de aviso por WhatsApp (LGPD)");
  const apto = await prisma.apartamento.create({ data: { numero: APTO_C, torre: "A", andar: 95 } });
  // ids crescentes: Rita (recusa) vem ANTES de quem aceita, para o fallback "1o com telefone" errar se a regra falhar
  const rita = await prisma.morador.create({
    data: { apartamentoId: apto.id, nome: "Rita Recusa", telefone: "(11) 91111-1111", avisoWhatsApp: false },
  });
  const ana = await prisma.morador.create({ data: { apartamentoId: apto.id, nome: "Ana Aceita", telefone: "(11) 92222-2222" } });
  const sergio = await prisma.morador.create({ data: { apartamentoId: apto.id, nome: "Sergio SemFone" } });
  ok(ana.avisoWhatsApp === true && sergio.avisoWhatsApp === true && rita.avisoWhatsApp === false, "avisoWhatsApp: padrao true; false so quando gravado");

  const reg = (d: { destinatarioMoradorId?: number; destinatarioNome?: string }) =>
    registrarEncomendaDominio({ apartamentoId: apto.id, tipo: "caixa", transportadora: "Teste", fotos: [foto()], ...d });
  const textoDe = (link: string) => decodeURIComponent(link.split("?text=")[1] ?? "");
  const FONE_RITA = "5511911111111";
  const FONE_ANA = "5511922222222";

  // leituras da portaria carregam a flag (chip "nao recebe WhatsApp") sem telefone
  const doApto = await enc.listarMoradoresDoApartamento(apto.id);
  ok(
    doApto.find((m) => m.id === rita.id)?.avisoWhatsApp === false &&
      doApto.find((m) => m.id === ana.id)?.avisoWhatsApp === true &&
      doApto.find((m) => m.id === sergio.id)?.avisoWhatsApp === true,
    "listarMoradoresDoApartamento devolve avisoWhatsApp de cada morador"
  );
  const meu = (await enc.listarApartamentosComMoradores()).find((a) => a.numero === APTO_C);
  const jsonMeu = JSON.stringify(meu);
  ok(
    !!meu && meu.moradores.find((m) => m.id === rita.id)?.avisoWhatsApp === false && meu.moradores.find((m) => m.id === ana.id)?.avisoWhatsApp === true,
    "listarApartamentosComMoradores devolve avisoWhatsApp (marcador no chip da portaria)"
  );
  ok(!jsonMeu.includes("91111") && !jsonMeu.includes("92222") && !/telefone/i.test(jsonMeu), "...e continua sem expor telefone");

  // 1) destinatario que recusou: sem link, sem cair para a Ana (que tem telefone e aceita)
  const eRita = await reg({ destinatarioMoradorId: rita.id });
  const avRita = await enc.prepararAviso(eRita.id);
  ok(
    !avRita.ok && avRita.link === null && avRita.motivo === "recusou" && avRita.erro === "Rita Recusa pediu para não receber avisos no WhatsApp",
    "destinatario que recusou: sem link, motivo 'recusou' e texto exato (nao cai para outro morador)",
    JSON.stringify(avRita)
  );
  const mRita = await marcarAvisoWhatsAppDominio(eRita.id);
  ok(
    !mRita.ok && mRita.link === null && mRita.erro === "Rita Recusa pediu para não receber avisos no WhatsApp" &&
      (await prisma.encomenda.findUniqueOrThrow({ where: { id: eRita.id } })).avisoWhatsAppEm === null,
    "marcarAviso do destinatario que recusou: sem link e sem gravar avisoWhatsAppEm"
  );

  // 2) destinatario sem telefone: fallback pula a Rita (recusou, id menor) e cai na Ana
  const eSergio = await reg({ destinatarioMoradorId: sergio.id });
  const avSergio = await enc.prepararAviso(eSergio.id);
  ok(
    avSergio.ok && avSergio.paraNome === "Ana Aceita" && avSergio.link.includes(`wa.me/${FONE_ANA}`) && !avSergio.link.includes(FONE_RITA),
    "destinatario sem telefone: fallback so entre quem aceita (pula a Rita, cai na Ana)",
    JSON.stringify(avSergio)
  );
  ok(avSergio.ok && textoDe(avSergio.link).startsWith("Olá, Ana! Chegou uma encomenda para Sergio"), "mensagem do fallback saúda a Ana e diz 'para Sergio'");

  // 3) "outro nome" (sem morador vinculado): idem
  const eVisita = await reg({ destinatarioNome: "Visita do Apto" });
  const avVisita = await enc.prepararAviso(eVisita.id);
  ok(
    avVisita.ok && avVisita.paraNome === "Ana Aceita" && avVisita.link.includes(`wa.me/${FONE_ANA}`) && !avVisita.link.includes(FONE_RITA),
    "'outro nome': fallback so entre quem aceita",
    JSON.stringify(avVisita)
  );
  const mSergio = await marcarAvisoWhatsAppDominio(eSergio.id);
  ok(
    mSergio.ok && !!(await prisma.encomenda.findUniqueOrThrow({ where: { id: eSergio.id } })).avisoWhatsAppEm,
    "quem aceita continua avisado: marcarAviso grava avisoWhatsAppEm"
  );

  // 4) a Ana tambem recusa: so ha telefone de quem recusou
  await prisma.morador.update({ where: { id: ana.id }, data: { avisoWhatsApp: false } });
  for (const [nome, e] of [["destinatario sem telefone", eSergio], ["'outro nome'", eVisita]] as const) {
    const av = await enc.prepararAviso(e.id);
    ok(
      !av.ok && av.motivo === "recusou" && av.erro.includes("pediram para não receber avisos no WhatsApp") &&
        av.erro.includes("Rita Recusa") && av.erro.includes("Ana Aceita") && av.erro.includes("avise por outro meio"),
      `${nome}, todos com telefone recusaram: sem link, motivo 'recusou' e nomes no texto`,
      JSON.stringify(av)
    );
  }

  // 5) a Ana volta a aceitar mas fica sem telefone: so a Rita tem telefone e recusou (texto no singular)
  await prisma.morador.update({ where: { id: ana.id }, data: { avisoWhatsApp: true, telefone: null } });
  const avUnico = await enc.prepararAviso(eVisita.id);
  ok(
    !avUnico.ok && avUnico.motivo === "recusou" &&
      avUnico.erro === "Rita Recusa, único morador do 995A com telefone cadastrado, pediu para não receber avisos no WhatsApp - avise por outro meio",
    "unico morador com telefone recusou: texto no singular",
    JSON.stringify(avUnico)
  );

  // 6) ninguem tem telefone: o motivo volta a ser 'sem_telefone' (texto de sempre); a recusa da Rita continua valendo
  await prisma.morador.update({ where: { id: rita.id }, data: { telefone: null } });
  const avNinguem = await enc.prepararAviso(eSergio.id);
  ok(
    !avNinguem.ok && avNinguem.motivo === "sem_telefone" && avNinguem.erro === "Nenhum morador do 995A tem telefone cadastrado - avise por outro meio",
    "ninguem com telefone: motivo 'sem_telefone' e texto de sempre",
    JSON.stringify(avNinguem)
  );
  const avRitaSemFone = await enc.prepararAviso(eRita.id);
  ok(!avRitaSemFone.ok && avRitaSemFone.motivo === "recusou", "destinatario que recusou segue 'recusou' mesmo sem telefone");

  // 7) a Rita volta a aceitar (e o telefone volta): o aviso dela reabre, "para voce"
  await prisma.morador.update({ where: { id: rita.id }, data: { avisoWhatsApp: true, telefone: "(11) 91111-1111" } });
  const avRita2 = await enc.prepararAviso(eRita.id);
  ok(
    avRita2.ok && avRita2.paraNome === "Rita Recusa" && avRita2.link.includes(`wa.me/${FONE_RITA}`) && textoDe(avRita2.link).includes("para você"),
    "voltar a aceitar reabilita o aviso para o proprio destinatario",
    JSON.stringify(avRita2)
  );

  // encomenda inexistente continua com motivo proprio
  const avNada = await enc.prepararAviso(99999999);
  ok(!avNada.ok && avNada.motivo === "indisponivel", "encomenda inexistente: motivo 'indisponivel'");
}

/**
 * `scripts/importa-cadastro.ts --aplicar` roda sobre uma COPIA do banco (VACUUM INTO em pasta temporaria, via
 * DATABASE_URL): preenche telefone de quem ja existe, cria quem e novo e NAO mexe em avisoWhatsApp.
 */
async function testesImportacaoNaoMexeNaRecusa(): Promise<void> {
  console.log("--- importacao do cadastro nao mexe em avisoWhatsApp");
  const raiz = process.cwd();
  const tsx = path.join(raiz, "node_modules", "tsx", "dist", "cli.mjs");
  const tmp = await mkdtemp(path.join(tmpdir(), "zz-importa-"));
  const banco = path.join(tmp, "banco.db");
  const urlBanco = "file:" + banco.replace(/\\/g, "/");
  const nomeRecusou = "ZZTESTE Import Recusou";
  const nomeAceita = "ZZTESTE Import Aceita";
  const nomeNovo = "ZZTESTE Import Novo";
  let copia: PrismaClient | null = null;
  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${banco.replace(/\\/g, "/").replace(/'/g, "''")}'`);
    copia = new PrismaClient({ datasources: { db: { url: urlBanco } } });
    const apto = await copia.apartamento.upsert({
      where: { numero: "11A" },
      create: { numero: "11A", torre: "A", andar: 1 },
      update: {},
    });
    await copia.morador.create({ data: { apartamentoId: apto.id, nome: nomeRecusou, avisoWhatsApp: false } });
    await copia.morador.create({ data: { apartamentoId: apto.id, nome: nomeAceita } });
    await mkdir(path.join(tmp, "dados"));
    await writeFile(path.join(tmp, "dados", "apartamentos.csv"), "numero;torre;andar\r\n11A;A;1\r\n");
    await writeFile(
      path.join(tmp, "dados", "moradores.csv"),
      `apartamento;nome;telefone\r\n11A;${nomeRecusou};11999990001\r\n11A;${nomeAceita};11999990002\r\n11A;${nomeNovo};11999990003\r\n`
    );
    const rodar = () =>
      spawnSync(process.execPath, [tsx, path.join(raiz, "scripts", "importa-cadastro.ts"), "--aplicar"], {
        cwd: tmp,
        env: { ...process.env, DATABASE_URL: urlBanco },
        encoding: "utf8",
        timeout: 120_000,
      });
    const confere = async (rotulo: string) => {
      const ms = await copia!.morador.findMany({ where: { apartamentoId: apto.id, nome: { in: [nomeRecusou, nomeAceita, nomeNovo] } } });
      const por = (n: string) => ms.find((m) => m.nome === n);
      ok(
        por(nomeRecusou)?.telefone === "11999990001" && por(nomeRecusou)?.avisoWhatsApp === false,
        `${rotulo}: morador que recusou ganha o telefone e CONTINUA recusando`,
        JSON.stringify(por(nomeRecusou))
      );
      ok(por(nomeAceita)?.telefone === "11999990002" && por(nomeAceita)?.avisoWhatsApp === true, `${rotulo}: quem aceitava continua aceitando`);
      ok(por(nomeNovo)?.telefone === "11999990003" && por(nomeNovo)?.avisoWhatsApp === true, `${rotulo}: morador novo nasce aceitando`);
    };
    const r1 = rodar();
    ok(r1.status === 0, "importa-cadastro --aplicar roda sobre a copia do banco", ascii(`${r1.stdout}${r1.stderr}`).slice(0, 500));
    await confere("importacao");
    const r2 = rodar();
    ok(r2.status === 0, "importa-cadastro roda de novo (idempotente)", ascii(`${r2.stdout}${r2.stderr}`).slice(0, 500));
    await confere("2a importacao");
    ok(
      (await prisma.morador.count({ where: { nome: { startsWith: "ZZTESTE Import" } } })) === 0,
      "a importacao de teste nao tocou no banco principal"
    );
  } finally {
    if (copia) await copia.$disconnect();
    await rm(tmp, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------------- main */

async function main(): Promise<void> {
  await testesPuros();
  await limparTestes(); // sobras de uma execucao anterior que caiu no meio
  const turnosAbertosAntes = (await prisma.turno.findMany({ where: { fim: null }, select: { id: true } })).map((t) => t.id);
  const arquivosAntes = await arquivosEmUploads();
  try {
    await testesDominio();
  } finally {
    await limparTestes();
    if (turnosAbertosAntes.length > 0) {
      await prisma.turno.updateMany({ where: { id: { in: turnosAbertosAntes } }, data: { fim: null } });
    }
  }
  console.log("--- limpeza");
  const sobras = {
    aptos: await prisma.apartamento.count({ where: { numero: { in: [APTO_A, APTO_B, APTO_C] } } }),
    porteiros: await prisma.porteiro.count({ where: { nome: { startsWith: MARCA } } }),
    turnosNossos: await prisma.turno.count({ where: { porteiro: { nome: { startsWith: MARCA } } } }),
  };
  ok(sobras.aptos === 0 && sobras.porteiros === 0 && sobras.turnosNossos === 0, "banco limpo (aptos, porteiros e turnos de teste removidos)", JSON.stringify(sobras));
  ok(JSON.stringify(await arquivosEmUploads()) === JSON.stringify(arquivosAntes), "uploads/encomendas igual ao de antes (arquivos de teste removidos)");
  const abertosDepois = (await prisma.turno.findMany({ where: { fim: null }, select: { id: true } })).map((t) => t.id).sort();
  ok(JSON.stringify(abertosDepois) === JSON.stringify([...turnosAbertosAntes].sort()), "turnos abertos restaurados ao estado de antes");
}

main()
  .catch((e) => {
    falhas++;
    console.log(`FAIL excecao nao tratada -> ${ascii(e instanceof Error ? (e.stack ?? e.message) : String(e))}`);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${total - falhas}/${total} verificacoes passaram${falhas ? ` - ${falhas} FALHA(S)` : " - TUDO PASS"}`);
    process.exit(falhas > 0 ? 1 : 0);
  });
