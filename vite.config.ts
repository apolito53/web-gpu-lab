import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4187,
    strictPort: true,
  },
});

