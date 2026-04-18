/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    if (isServer) {
      config.plugins.push(
        new (require("webpack").IgnorePlugin)({
          resourceRegExp: /.*Worker\.(ts|js)$/,
        })
      );
    }
    return config;
  },
  headers: async () => [
    {
      source: "/(.*\\.wasm)",
      headers: [{ key: "Content-Type", value: "application/wasm" }],
    },
  ],
};
module.exports = nextConfig;
