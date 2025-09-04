import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, readdirSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/background.js'),
        content: resolve(__dirname, 'src/content/content.js'),
        popup: resolve(__dirname, 'src/popup/popup.js')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          // Keep HTML files in root
          if (assetInfo.name.endsWith('.html')) {
            return '[name].[ext]';
          }
          // Keep CSS files with JS files
          if (assetInfo.name.endsWith('.css')) {
            return '[name].[ext]';
          }
          return 'assets/[name].[ext]';
        }
      }
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
    copyPublicDir: false // We'll handle copying manually
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  plugins: [
    {
      name: 'copy-extension-assets',
      generateBundle() {
        // Copy manifest.json
        const manifestContent = readFileSync(resolve(__dirname, 'public/manifest.json'), 'utf-8');
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: manifestContent
        });

        // Copy popup.html to root (Vite puts it in src/popup/ by default)
        try {
          const popupHtmlContent = readFileSync(resolve(__dirname, 'src/popup/popup.html'), 'utf-8');
          this.emitFile({
            type: 'asset',
            fileName: 'popup.html',
            source: popupHtmlContent
          });
        } catch (error) {
          console.warn('Could not copy popup.html:', error.message);
        }

        // Copy all icon files
        try {
          const iconsDir = resolve(__dirname, 'public/icons');
          const iconFiles = readdirSync(iconsDir);
          
          iconFiles.forEach(iconFile => {
            if (iconFile.endsWith('.png') || iconFile.endsWith('.svg') || iconFile.endsWith('.ico')) {
              const iconContent = readFileSync(resolve(iconsDir, iconFile));
              this.emitFile({
                type: 'asset',
                fileName: `icons/${iconFile}`,
                source: iconContent
              });
            }
          });
        } catch (error) {
          console.warn('Could not copy icons:', error.message);
        }
      }
    }
  ]
});