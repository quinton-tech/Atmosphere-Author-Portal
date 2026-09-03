import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep heavy Node-only parsers out of the server bundle; they are loaded lazily on upload.
  serverExternalPackages: ["pdf-parse", "mammoth", "@node-rs/argon2"],
};

export default nextConfig;
