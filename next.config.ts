import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Avatares vão até 2 MB (limite do bucket); a margem cobre o
      // envelope multipart e os outros campos do formulário.
      bodySizeLimit: "3mb",
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
