/**
 * Redução de foto NO NAVEGADOR (22/10/2026) - só roda no cliente (canvas, createImageBitmap).
 * Lado maior 1280 px, JPEG qualidade 0,8: uma foto de celular de 4 MB vira ~200 KB.
 * Respeita a rotação EXIF (foto de celular em pé não sai deitada) e nunca amplia.
 * O servidor valida de novo (tipo real, 10 MB): isto é conforto e velocidade, não segurança.
 */

export const LADO_MAXIMO = 1280;
export const QUALIDADE_JPEG = 0.8;
const LIMITE_ORIGINAL = 40 * 1024 * 1024;
export const MSG_ILEGIVEL = "Não foi possível ler essa imagem. Tire a foto de novo.";

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

type Decodificada = { fonte: CanvasImageSource; largura: number; altura: number; liberar: () => void };

async function decodificar(file: File): Promise<Decodificada> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image": respeita a rotação EXIF da câmera (foto de celular em pé)
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { fonte: bmp, largura: bmp.width, altura: bmp.height, liberar: () => bmp.close() };
    } catch {
      // navegador sem esse modo: cai no <img>, que aplica a rotação sozinho
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((ok, falha) => {
      img.onload = () => ok();
      img.onerror = () => falha(new Error(MSG_ILEGIVEL));
      img.src = url;
    });
    return {
      fonte: img,
      largura: img.naturalWidth,
      altura: img.naturalHeight,
      liberar: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

export type ImagemReduzida = { file: File; largura: number; altura: number };

export async function reduzirImagem(original: File): Promise<ImagemReduzida> {
  if (original.type && !original.type.startsWith("image/")) throw new Error("Escolha uma foto (imagem).");
  if (original.size > LIMITE_ORIGINAL) throw new Error("Essa foto é grande demais. Tire outra.");
  const dec = await decodificar(original).catch(() => {
    throw new Error(MSG_ILEGIVEL);
  });
  try {
    if (!dec.largura || !dec.altura) throw new Error(MSG_ILEGIVEL);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(dec.largura, dec.altura));
    const largura = Math.max(1, Math.round(dec.largura * escala));
    const altura = Math.max(1, Math.round(dec.altura * escala));
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(MSG_ILEGIVEL);
    ctx.fillStyle = "#fff"; // PNG com transparência não vira fundo preto no JPEG
    ctx.fillRect(0, 0, largura, altura);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(dec.fonte, 0, 0, largura, altura);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", QUALIDADE_JPEG));
    if (!blob) throw new Error(MSG_ILEGIVEL);
    const arquivo = new File([blob], `foto-${Date.now().toString(36)}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    return { file: arquivo, largura, altura };
  } finally {
    dec.liberar();
  }
}

