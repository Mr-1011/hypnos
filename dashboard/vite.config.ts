import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The page is only a view: the three programs in sensors/ (run.sh starts them) own the device
// links and the recordings, so closing this tab or stopping Vite never interrupts a night.
// Each program serves /api/... on its own port; the page reaches it under its device's prefix.
// The agent (agent/voice.py, the voice loop) is a fourth program of the same kind.
const to = (port: number, name: string) => ({
  target: `http://127.0.0.1:${port}`,
  rewrite: (p: string) => p.replace(new RegExp(`^/api/${name}`), '/api'),
})

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5300,
    strictPort: true,
    // the page is same-origin; Vite's default answers any localhost page's preflight, so another
    // local port could POST commands through the proxy
    cors: false,
    proxy: {
      '/api/muse': to(5301, 'muse'),
      '/api/polar': to(5302, 'polar'),
      '/api/band': to(5303, 'band'),
      '/api/agent': to(5304, 'agent'),
    },
  },
})
