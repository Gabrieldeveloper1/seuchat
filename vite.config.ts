import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200, // libsodium (com WASM embutido) é grande por natureza
    rollupOptions: {
      output: {
        // separa o que raramente muda → cache melhor e carregamento paralelo
        manualChunks: {
          react: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
          crypto: ["libsodium-wrappers-sumo", "@scure/bip39"],
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
