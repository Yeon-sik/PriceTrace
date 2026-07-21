import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.CAPACITOR_BUILD === "true" ? "" : "/PriceTrace",
  allowedDevOrigins: ["127.0.0.1"],
};
export default nextConfig;
