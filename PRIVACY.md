# Privacidad de MeliExtension

Aplicable al paquete local independiente 0.1.0 para Brave/Chrome de escritorio.
La politica refleja la implementacion actual; una fuente remota o IA requeriria
otra autorizacion y actualizar esta documentacion.

## Datos consultados

La extension lee datos publicos de la publicacion activa de MercadoLibre
Argentina: titulo, precio/moneda, IDs de publicacion/catalogo, imagen y datos
publicos del vendedor disponibles. Conserva la fuente y fecha de observacion.
Usa datos estructurados publicos, metadatos y elementos visibles del documento;
no lee contexto privado de aplicacion, cookies, CSRF, claves ni datos del comprador.

La lectura no acredita la identidad del vendedor, ventas, ranking, precio
historico anterior ni tiempo de Buybox. Ausencia de informacion no significa
envio gratis, cuota sin interes ni una oferta disponible.

## Almacenamiento local

- Preferencia de apertura del panel en `chrome.storage.local`, restringida a
  contextos de la extension. No usa sincronizacion de Chrome.
- Publicaciones seguidas, capturas manuales de precios, contactos guardados
  manualmente y retencion propuesta en IndexedDB de la extension.
- Cada captura incluye su snapshot publico y procedencia, que pueden incluir
  el vendedor y su perfil. El contacto guarda ID de vendedor, enlace publico,
  fuente, fecha, vencimiento e identidad no confirmada.
- Borradores de rentabilidad y estado del revisor de propuestas solo en memoria.
  No se guardan conversaciones, solicitudes de IA ni credenciales de proveedor.

Limites: 100 publicaciones, 50000 capturas y 1000 contactos. La retencion
7/30/90 dias es propuesta, no un borrado programado. Un contacto vence a los
30 dias de su observacion y permanece marcado hasta borrarlo manualmente.

## Comunicaciones

No hay backend, telemetria, analitica propia, publicidad ni envio a proveedores
de IA. La asistencia esta desactivada, con presupuesto USD 0 y ningun envio
autorizado. Catalogo/Buybox remotos no tienen fuente configurada.

Al abrir MercadoLibre, el navegador realiza las conexiones normales de ese
sitio, que no son controladas por esta politica. La extension puede cargar la
imagen publica del producto desde mlstatic mediante HTTPS y sin referrer;
fuentes, estilos e iconos se empaquetan localmente. Seguir un enlace publico
abre un sitio externo sujeto a su propia politica de privacidad.

## Permisos y acceso

- `storage`: guardar la preferencia del panel y trabajar con datos locales.
- `https://*.mercadolibre.com.ar/*`: ejecutar el content script y leer la
  publicacion activa en Argentina. No habilita otros mercados ni APIs privadas.
- No se solicitan permisos cookies, debugger, unlimitedStorage o clipboardWrite.
  El portapapeles solo se usa por copia manual y puede ser rechazado por el navegador.
- La CSP de las paginas de extension limita scripts/fuentes/conexiones a recursos
  propios, e imagenes al CDN publico mlstatic. No existe proxy generico de red
  ni comunicacion externa abierta a otras aplicaciones.

Las validaciones de mensajes verifican extension, origen, frame y publicacion;
las operaciones de contactos se vinculan al vendedor. La extension no modifica
la cuenta, precios, publicaciones, compras ni datos del perfil original.

## Exportacion y borrado

Exportar historial crea un JSON/CSV propio v1 en la carpeta de descargas elegida
por el navegador. Incluye los snapshots publicos almacenados y sus fuentes;
no incluye contactos. El archivo queda bajo control del usuario y no se borra
al eliminar datos dentro de la extension. Compartirlo puede divulgar esos datos.

Importar solo admite ese formato validado y requiere confirmacion. Se combinan
datos sin borrar los actuales; entradas invalidas no se importan parcialmente.

Dejar de seguir conserva capturas. Limpiar historial o eliminar una publicacion
requiere confirmacion. Borrar todos los datos elimina publicaciones, capturas y
contactos, pero conserva la preferencia del panel. Un contacto puede borrarse
individualmente desde el vendedor correspondiente. No hay eliminacion automatica.

Desinstalar la extension o borrar su almacenamiento en el navegador puede
eliminar los datos locales. No existe copia remota ni restauracion desde otro
perfil; la exportacion de historial es manual.

## Alcance de la verificacion

La evidencia y los limites de pruebas reales figuran en
[docs/implementation-plan.md](docs/implementation-plan.md). Las pruebas sinteticas
no acreditan un proveedor de IA ni funcionamiento en todas las publicaciones.
La prueba publica autorizada del hito 8 uso un perfil sin sesion y recibio
HTTP 403, sin verificar publicaciones ni intentar eludir el bloqueo. Sus
capturas/informe quedaron fuera del ZIP en una carpeta temporal de resultados.
Esta entrega local no incorpora una politica de servicio remoto ni un canal de
publicacion comercial; esos elementos deben acordarse antes de habilitarlos.