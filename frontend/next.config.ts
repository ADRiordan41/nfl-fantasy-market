import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR || ".next-mm4";

const nextConfig: NextConfig = {
  // Avoid OneDrive lock contention on the default .next directory.
  distDir,
  // Playwright uses 127.0.0.1 while Next allows localhost by default.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
