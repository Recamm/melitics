# MeliExtension

Extension independiente para Brave y Chrome de escritorio, Manifest V3, para
publicaciones publicas de MercadoLibre Argentina (MLA). No esta afiliada a
MercadoLibre ni reutiliza servicios o recursos de MercadoToolkit.

## Funciones y limites

- Resumen de producto, precio, identificadores y vendedor desde datos publicos.
  Campos ausentes y datos desactualizados se muestran explicitamente.
- Rentabilidad con cargos manuales e importes exactos. No son tarifas oficiales;
  no hay conversion de monedas ni rentabilidad garantizada.
- Historial local con seguimiento y captura separados: abrir una pagina no
  guarda un precio automaticamente. Periodos 7/30/90 dias y cobertura observada,
  no historial anterior inventado. Grafico solo en la gestion del historial.
- Exportacion/importacion de historial propio JSON/CSV v1, hasta 64 MB,
  100 publicaciones y 50000 capturas. No incluye contactos.
- Contactos: solo perfiles publicos observados con ID de vendedor, guardados por
  accion manual. Identidad no confirmada, procedencia y vencimiento a 30 dias;
  los vencidos no se eliminan automaticamente. Limite de 1000 contactos.
- Comparacion local de ofertas y calculo de Buybox preparados. Catalogo remoto
  y Buybox remoto no disponibles por falta de fuente autorizada. Buybox representa
  capturas con ganador conocido, nunca porcentaje de tiempo ni ventas inferidas.
- IA desactivada: sin proveedor, presupuesto USD 0, sin backend ni envios.
  Los contratos y el revisor de propuestas estan preparados; no se generan
  propuestas de demostracion ni se publica automaticamente.

## Instalacion local

Requisitos: Brave o Chrome de escritorio con base Chromium 120 o superior.

1. Descomprimir el ZIP local de entrega en una carpeta estable, o generar el
   paquete desde el codigo usando los comandos siguientes.
2. Abrir `brave://extensions` o `chrome://extensions`.
3. Activar Modo desarrollador y elegir Cargar descomprimida.
4. Seleccionar la carpeta que contiene el manifest de produccion. Al compilar
   desde este repositorio, es `.output/chrome-mv3`.
5. Abrir una publicacion o producto de catalogo de MercadoLibre Argentina.
   Desde el icono de la extension se puede abrir el panel o deshabilitar su
   apertura en publicaciones. Gestionar historial abre una pagina propia.

No cargar el ZIP directamente ni la carpeta raiz del repositorio. No se instala
ni modifica la extension original. No hay publicacion en Chrome Web Store.

## Desarrollo y comprobaciones

Node 24.14.0 fue verificado. Las dependencias estan fijadas en el lockfile.

```powershell
npm ci --ignore-scripts
npm run prepare:extension
npm run build
npm run prepare:delivery
npm run typecheck
npm run test
npm audit --omit=dev
```

Preparar WXT es necesario despues de una instalacion sin scripts. Las pruebas
de manifest y entrega leen el build generado; por eso se compila y se prepara
la entrega antes de ejecutarlas. Preparar la entrega copia esta documentacion,
el plan y los avisos de terceros al build; no descarga paquetes ni publica nada.
`npm run dev` inicia el entorno local. El preview web no acredita que funcione
una publicacion real ni sustituye cargar la extension.

El runner nativo existente usa Playwright temporal fuera del producto mediante
`MELI_BROWSER_TOOLS` y perfiles nuevos de Brave. Sus modos incluyen navegacion,
carreras del popup, rentabilidad, historial, Mercado y asistencia desactivada.
Ver [plan y evidencia](docs/implementation-plan.md) para el estado de entrega
y las comprobaciones reproducibles finales.

Para reproducir los checks nativos en Windows, con Brave instalado y el preview
iniciado en otra terminal mediante `npm run dev`:

```powershell
$env:MELI_BROWSER_TOOLS = Join-Path $env:TEMP ('meli-browser-tools-' + [guid]::NewGuid())
npm install --prefix $env:MELI_BROWSER_TOOLS --ignore-scripts --no-audit --no-fund --save-exact playwright-core@1.58.2
node tests/browser-smoke.mjs
node tests/browser-smoke.mjs --history-only
node tests/browser-smoke.mjs --fees-only
node tests/browser-smoke.mjs --market-only
node tests/browser-smoke.mjs --assistant-only
node tests/browser-smoke.mjs --navigation-only
node tests/browser-smoke.mjs --popup-races-only
```

Cada ejecucion borra su perfil temporal y conserva las capturas en la carpeta
de resultados anunciada. El tooling temporal no integra el ZIP. El modo separado
`--public-pages-only` requiere autorizacion expresa, bloquea APIs/XHR y terceros
no necesarios, y no inicia sesion. Un exit code 0 no significa verificacion real:
consultar `verifiedPublications` y el estado HTTP del informe.

## Paquete de entrega

Despues de compilar, preparar y validar, crear un ZIP local desde PowerShell:

```powershell
Compress-Archive -Path .output/chrome-mv3/* -DestinationPath .output/MeliExtension-0.1.0.zip -CompressionLevel Optimal -Force
Get-FileHash .output/MeliExtension-0.1.0.zip -Algorithm SHA256
```

El manifest queda en la raiz al descomprimir. Se incluyen los 14 archivos del
build, este README, privacidad, el plan y los avisos de 21 paquetes de runtime
y helpers. No incluye fuentes de la app, tests, perfiles, dependencias de
desarrollo ni archivos de entorno. No se crea un paquete de tienda firmado.

## Actualizacion y recuperacion

- Antes de actualizar, exportar el historial propio. Los contactos no estan
  incluidos en esos archivos.
- Reemplazar el build en la misma carpeta y pulsar Recargar en la pagina de
  extensiones; recargar tambien las publicaciones abiertas.
- Mantener carpeta e ID de extension. Otra ruta, perfil o navegador puede crear
  otro almacenamiento. Desinstalar puede eliminar los datos locales.
- Ante datos incompletos, actualizar la captura. El sitio puede cambiar sus
  selectores o restringir acceso; no se eluden autenticacion ni limites.
- Ante falta de espacio, exportar o eliminar datos confirmadamente. No se
  descartan capturas previas ni se hace limpieza automatica para recuperarlo.
- Gestionar historial permite dejar de seguir sin borrar, limpiar capturas
  antiguas o eliminar una publicacion. Borrar todos los datos incluye contactos
  y requiere confirmacion; no borra la preferencia del panel.

## Privacidad, licencias y verificacion

Consultar [PRIVACY.md](PRIVACY.md) antes de usar la extension. Las dependencias
conservan sus licencias y avisos; deben acompanar el paquete distribuido.
No se ha asignado una licencia al codigo propio ni autorizado su publicacion.

Las pruebas con fixtures son sinteticas. No certifican todos los articulos,
selectores actuales, paises, navegadores ni calidad de un modelo de IA.
En la entrega del hito 8, la busqueda publica autorizada devolvio HTTP 403:
no se pudo verificar ninguna publicacion real. Los siete modos locales pasaron
en Brave y 259 pruebas automatizadas pasaron; Google Chrome no se ejecuto
separadamente. La IA y las fuentes remotas permanecen desactivadas/no disponibles.
Un viewport estrecho no certifica Brave Android ni Safari.