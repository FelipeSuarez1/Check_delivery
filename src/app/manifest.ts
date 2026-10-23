import type { MetadataRoute } from "next";

/**
 * Torna o app instalável ("Adicionar à tela inicial"): abre em janela própria,
 * sem barra de endereço. Servido em /manifest.webmanifest — liberado no
 * middleware por não conter nada sensível (só nome, cores e ícones).
 * start_url "/" de propósito: o middleware manda cada papel para a sua tela.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Encomendas Tangará",
    short_name: "Encomendas",
    description: "Encomendas da portaria do Condomínio Espaço Tangará",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // tablet do balcão em paisagem, celular do morador em retrato
    orientation: "any",
    background_color: "#FAF8F3",
    theme_color: "#C47A2C",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["utilities", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
