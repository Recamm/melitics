import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'MeliExtension',
    description: 'Herramientas locales para publicaciones de MercadoLibre.',
    minimum_chrome_version: '120',
    permissions: ['storage'],
    host_permissions: ['https://*.mercadolibre.com.ar/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'",
    },
  },
});