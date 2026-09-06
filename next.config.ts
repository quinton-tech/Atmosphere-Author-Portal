import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep heavy Node-only parsers out of the server bundle; they are loaded lazily on upload.
  serverExternalPackages: ["pdf-parse", "mammoth", "@node-rs/argon2"],
  // No `experimental.serverActions.bodySizeLimit` here anymore. Raising it never actually fixed
  // the 50MB author-upload / 25MB handbook limits this app advertises: Vercel caps every
  // function's request body at 4.5MB regardless of what Next.js is configured to allow
  // (https://vercel.com/docs/functions/limitations#request-body-size), so a file anywhere between
  // 4.5MB and the advertised limit failed before validation ever ran. Author and handbook uploads
  // now go straight from the browser to Google Drive via a resumable session
  // (src/lib/drive/uploads.ts, src/app/api/uploads/*, src/app/api/admin/handbook/*) — the file's
  // bytes never pass through a Vercel function, so there's no body-size limit to raise.
};

export default nextConfig;
