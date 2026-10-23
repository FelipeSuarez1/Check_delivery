/**
 * <QrCodigo codigo size? className? />  (server component, 22/10/2026)
 * SVG do QR cujo conteúdo é o PRÓPRIO código (4 caracteres) - o leitor da
 * portaria devolve exatamente "K7M3". Alto contraste (escuro sobre branco) e
 * zona de silêncio embutida, para ler bem na tela do celular.
 *  - codigo: string no formato do alfabeto (inválido = não renderiza nada)
 *  - size: lado em px (padrão 160)
 */
import QRCode from "qrcode";
import { codigoValido } from "@/lib/codigo";

export async function QrCodigo({
  codigo,
  size = 160,
  className,
}: {
  codigo: string;
  size?: number;
  className?: string;
}) {
  if (!codigoValido(codigo)) return null;
  const lado = Math.max(32, Math.round(Number(size)) || 160);
  const svg = await QRCode.toString(codigo, {
    type: "svg",
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#1F1D1A", light: "#FFFFFF" },
  });
  // `codigo` já foi validado contra o alfabeto; o SVG vem da biblioteca, não de entrada do usuário
  const comTamanho = svg.replace(
    "<svg ",
    `<svg width="${lado}" height="${lado}" role="img" aria-label="QR code da encomenda ${codigo}" `
  );
  return (
    <div
      className={className}
      style={{ width: lado, height: lado, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: comTamanho }}
    />
  );
}
