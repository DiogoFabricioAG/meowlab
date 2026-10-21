import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [tailwind(), react()],
  output: 'static',
  build: {
    format: 'directory'
  },
  vite: {
    optimizeDeps: {
      include: ['@xyflow/react', 'react', 'react-dom']
    }
  }
});
