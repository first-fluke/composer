import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@agent-valley/core"],
  serverExternalPackages: ["zod"],
}

export default nextConfig
