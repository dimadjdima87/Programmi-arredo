import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  ...(process.env.STUDIO_DESKTOP_BUILD === "1"
    ? { output: "standalone" as const }
    : {}),
};
export default config;
