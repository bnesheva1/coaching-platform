import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB, which is too small for profile photo uploads
      // handled directly through a Server Action. Our own app-level check
      // rejects anything over 2MB with a friendly message — this limit
      // needs enough headroom above that so a too-large file still reaches
      // our code instead of triggering a framework-level crash first.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
