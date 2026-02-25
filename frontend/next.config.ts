import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid OneDrive lock contention on the default .next directory.
  distDir: ".next-mm4",
  // Playwright uses 127.0.0.1 while Next allows localhost by default.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
