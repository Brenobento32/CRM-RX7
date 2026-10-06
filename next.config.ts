import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Maior limite entre os dois uploads que passam por Server Action:
      // imagem do WhatsApp vai até 8 MB (bucket whatsapp-midia); avatar,
      // até 2 MB (bucket avatares). A margem cobre o envelope multipart e
      // os outros campos do formulário.
      bodySizeLimit: "9mb",
    },
  },
  images: {
    // Só as fotos do bucket público de avatares deste projeto.
    remotePatterns: supabaseUrl
      ? [new URL(`${supabaseUrl}/storage/v1/object/public/avatares/**`)]
      : [],
  },
};

export default nextConfig;
