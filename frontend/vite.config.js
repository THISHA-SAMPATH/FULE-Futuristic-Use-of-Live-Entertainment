import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT) || 5173,
    // When another FULE tab/server owns the default port, Vite selects the next free port.
    strictPort: false,
  },
});
