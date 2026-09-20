import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The governance API routes load the compiled Rust kernel binding (napi-rs)
  // from native/ at runtime, outside the bundler graph. Keep the artifact in
  // the server output trace so standalone/Vercel output includes it.
  outputFileTracingIncludes: {
    "/api/approvals/**": ["./native/**"],
  },
};

export default nextConfig;
