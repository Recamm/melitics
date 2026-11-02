# MeliExtension: identidad e interaccion

Direccion elegida por el usuario: blanco, grafito y verde petroleo. Nombre
provisional MeliExtension, sin marcas ni recursos de MercadoToolkit.

- Herramienta operativa compacta, no landing. IBM Plex Sans local, 14 px de
  cuerpo y 18 px de titulo; cifras tabulares. Sin tracking negativo.
- Fondo blanco, superficies gris frio, texto grafito, verde petroleo para
  acciones y datos confirmados; ambar para datos parciales o desactualizados.
- Panel lateral de hasta 380 px, bordes de 6 px, sin tarjetas anidadas. Foto
  publica del producto si esta disponible, sin inventar una imagen del articulo.
- Secciones sin marco: resumen, identificadores, vendedor y procedencia. Las
  funciones de hitos futuros no se presentan como operativas.
- Iconos Lucide con nombres accesibles y tooltip; controles de al menos 32 px,
  foco visible, Escape para cerrar y retorno de foco a la pagina.
- Popup de 380 px con el mismo lenguaje visual; ajuste a anchuras menores,
  texto largo y zoom 200%. El panel no modifica estilos del sitio anfitrion.
- Montaje aislado en Shadow DOM. Anclaje propio al body como fallback estable;
  no depende de modificar root-app. Cierre desmonta React y observadores.
- Estados: carga, datos parciales, no soportado, error recuperable y datos
  desactualizados. Navegacion con debounce 200 ms y cancelacion, sin polling.
- Fuentes, iconos y estilos se empaquetan localmente. Imagenes de producto
  limitadas al CDN publico mlstatic, sin referrer y sin cookies extraidas.

- Rentabilidad comparte panel y popup mediante pestanas accesibles. Resumen,
  Rentabilidad e Historial; flechas/Home/End cambian de vista sin perder el borrador local.
  Cargos manuales vacios, importes decimales locales, errores por campo y moneda
  explicita; no conversiones ni tarifas oficiales supuestas. No usar tarjetas
  para agrupar formulario o resultados.
- Resultado principal de ganancia con cifras tabulares; perdida con signo y
  color rojo, no solo color. Recibido, margen sobre venta, retorno sobre costo
  y equilibrio por separado. Desglose, supuestos, fuente, fecha y version en
  detalles; simulador oficial como enlace externo, sin automatizar sesiones.
- El borrador se conserva entre vistas y se reinicia por publicacion/seleccion
  o cambio de moneda. Vive solo en memoria, no en la pagina anfitriona ni un
  servicio remoto. El almacenamiento historico pertenece al hito 5.

- Historial con seguimiento y captura explicitamente separados, indicador de
  ultima captura UTC, periodos 7/30/90 dias, moneda y cobertura faltante. Tabla
  paginada con precio y procedencia; sin precios anteriores inventados.
- Gestion de historial en una pestana propia, con lista lateral en escritorio
  y secciones apiladas en movil. Grafico modular diferido solo alli, no en el
  script de cada publicacion. Huecos por precio ausente, otra moneda o mas de
  24 horas sin capturas; importes exactos disponibles en la tabla.
- Limites locales visibles y confirmaciones nativas para importacion, retencion
  y eliminaciones. Cancelar recibe el foco inicial; Escape no modifica datos.
  Errores de cuota visibles tambien dentro del modal, con opcion de reintentar.
- JSON/CSV propios versionados, sin conversion monetaria ni conexion remota.
  Dejar de seguir conserva el historial; no hay limpieza o rastreo automatico.

La identidad definitiva, ofertas y contactos pertenecen a sus hitos.
Las pruebas con fixtures no certifican publicaciones reales.