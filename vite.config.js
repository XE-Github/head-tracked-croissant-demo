import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@mediapipe/tasks-vision')) {
            return 'vision-vendor';
          }

          if (id.includes('node_modules/three/examples/')) {
            return 'three-examples';
          }

          if (id.includes('node_modules/three')) {
            return 'three-core';
          }

          return undefined;
        },
      },
    },
  },
});
