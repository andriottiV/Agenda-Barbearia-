import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HoraAi",
    short_name: "HoraAi",
    description: "Sua agenda online e rápida",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#D4AF37",
    icons: [
      {
        src: "/IconAB.png?v=20260514",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/IconAB.png?v=20260514",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/IconAB.png?v=20260514",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
