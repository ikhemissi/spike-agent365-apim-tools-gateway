import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Loaded from node_modules rather than bundled: OpenTelemetry instruments modules as Node.js loads them.
  serverExternalPackages: ["@azure/monitor-opentelemetry", "@azure/identity"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }];
  },
};

export default config;
