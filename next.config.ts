import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Allow the dev HMR channel from these hosts. Without this, opening the app
  // via 127.0.0.1 or the LAN IP gets its /_next/webpack-hmr requests blocked,
  // which desyncs the client bundle and makes buttons stop responding.
  allowedDevOrigins: ["localhost", "127.0.0.1", "198.18.0.1"]
};

export default nextConfig;
