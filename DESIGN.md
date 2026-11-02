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

La identidad definitiva, calculadora, historial, ofertas y contactos pertenecen
a sus hitos. Las pruebas con fixtures no certifican publicaciones reales.