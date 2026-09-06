import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep heavy Node-only parsers out of the server bundle; they are loaded lazily on upload.
  serverExternalPackages: ["pdf-parse", "mammoth", "@node-rs/argon2"],
  experimental: {
    // Default is 1MB. Author uploads (src/app/(author)/uploads) allow files up to 50MB;
    // the multipart/form-data envelope adds some overhead on top of the raw file bytes.
    serverActions: { bodySizeLimit: "55mb" },
  },
};

export default nextConfig;
