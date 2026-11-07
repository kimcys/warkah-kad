import { defineConfig, loadEnv } from "vite";

// Single-page app: the Worker hands every unknown path to index.html (api/wrangler.toml [assets]).
// In development /api is proxied to the API Worker (`npm run dev` in api/, port 8787) so the site and the API share one origin, as in production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_PROXY || "http://localhost:8787";
  // The API refuses writes whose Origin is not its own, and in development it is reached on another port. The proxy therefore
  // presents the target's origin, which is what the browser's own origin will be once the site and API share one host.
  const viaProxy = { target, changeOrigin: true, configure: (proxy) => proxy.on("proxyReq", (req) => { if (req.getHeader("origin")) req.setHeader("origin", target); }) };
  return {
    server: { host: true, port: 5180, proxy: { "/api": viaProxy } },
    build: { target: "es2020", sourcemap: false }
  };
});
