# Plan de implementacion: extension propia para MercadoLibre

Fecha: 2026-11-01.
Estado: analisis estatico completado; hitos 1 y 2 implementados y verificados.
Implementacion de la app: autorizada por el usuario para comenzar este plan.
Proceso guiado: esperar indicacion antes de continuar con el hito 3.

## Objetivo y restricciones

Construir una extension independiente para Brave y Chrome que ayude a evaluar
publicaciones de MercadoLibre. Aprovechar los conceptos observados, no copiar
codigo, marcas, iconos, estilos ni servicios privados de MercadoToolkit.

- Mantener Manifest V3 y el stack React + Vite configurado con createapp.
- La fase inicial de planificacion fue sin codigo ni dependencias de aplicacion.
	Las autorizaciones posteriores habilitaron los hitos 1 y 2.
- No modificar la extension instalada ni datos del perfil de Brave.
- No extraer cookies, credenciales ni informacion privada de la cuenta.
- No acceder a APIs privadas de MercadoToolkit ni eludir limites o autenticacion.
- No presentar datos inventados como historial, ventas, tarifas o resultados de IA.
- No publicar, desplegar ni contratar servicios sin autorizacion adicional.
- Trabajar en una sesion, sin subagentes y con hitos verificables.

## Analisis integral del paquete

Referencia: MercadoLibre Herramientas con IA, ID
agkdknlphoikfmliifdcdgijjhmcjile, version instalada 1.0.43.

Se leyeron los 22 archivos, incluidos metadatos y recursos: 1.860.144 bytes.
Los tres bundles se parsearon completos con Acorn: 515.156 nodos AST. Se
procesaron todos los JSON, CSS, HTML, SVG, avisos de licencia y archivos PNG.
Las copias legibles y herramientas de analisis quedaron fuera del repositorio.
La revision manual se concentro en la logica propia, sus contratos y los puntos
de integracion; no fue una auditoria linea por linea de las bibliotecas incluidas.

Es un analisis estatico: no se ejecutaron los scripts originales, no se leyo el
almacenamiento del perfil y no se enviaron solicitudes a las APIs privadas.
No se dispone del codigo de los servidores, de los fuentes TypeScript originales
ni de mapas de codigo. Por ello no se puede confirmar la exactitud de las
estimaciones remotas ni el comportamiento real del proveedor solo con este paquete.

### Componentes y responsabilidades observadas

| Componente del paquete | Funcion observada |
| --- | --- |
| Manifiesto Chrome | Manifest V3; content script en 18 dominios de MercadoLibre; permisos storage, unlimitedStorage e idle; red y conexiones externas muy amplias. |
| Bundle content | React 18.2, estado Redux, extraccion de pagina, consulta de ofertas y backend, costos, contactos, tablas y graficos. |
| Bundle background | Proxy de solicitudes, clientes remotos, IndexedDB de visitas y actualizacion de ofertas mientras el usuario esta inactivo. |
| Bundle main y HTML | Pagina registrada como DevTools; el componente final renderiza null. El manifiesto activo no define popup. |
| Estilos e imagenes | Widget integrado, tablas, estados restringidos y marca del proveedor; estilos nuevos y heredados conviven. |
| Manifiesto Safari | Alternativa Manifest V2 con popup; no gobierna la extension cargada en Brave. |
| Bibliotecas | React, Redux/Immer, polyfills, Lucide y ECharts; estas bibliotecas no son el codigo fuente original del producto. |

### Flujo de datos observado

1. El content script obtiene datos desde el script Nordic de MercadoLibre,
	metadatos, campos ocultos y elementos de la pagina. Distingue publicacion
	individual de producto de catalogo.
2. Para catalogo solicita las primeras dos paginas de ofertas al endpoint web
	`/p/api/products/{productId}/s`. Normaliza vendedor, precio, cuotas y envio.
	Que la pagina use este endpoint no lo convierte en una API publica estable.
3. Envia `PRODUCT_VIEW_EVENT` al worker y consulta `product_page_info` con
	identificadores, ofertas y una serializacion del estado de pagina.
4. El backend devuelve cuenta/suscripcion, contactos, series de precios,
	participacion de Buybox, estimaciones de ventas y perfiles de competidores.
	El paquete no contiene los algoritmos del servidor que producen esas metricas.
5. Para costos de venta, el codigo usa el simulador de MercadoLibre Argentina,
	campos de sesion y CSRF. Lee una estructura de componentes del simulador;
	no es una tabla local universal de comisiones.
6. Para contactos tambien construye una busqueda de Google con nombre y pais,
	solicita HTML sin credenciales y extrae un panel de negocio. No hay garantia
	de que el resultado corresponda al vendedor correcto.
7. Redux guarda un bloque de vendedores/contactos en storage.local. El worker
	guarda visitas en IndexedDB, selecciona productos pendientes y pagina ofertas
	cuando el estado de actividad pasa a idle o locked.
8. La interfaz usa dos pestanas principales, vendedor y ofertas, mas un grafico
	separado. Observadores y un sondeo cada segundo detectan cambios de publicacion.

### Servicios y rutas identificadas

El cliente contiene diez rutas POST bajo `https://www.mercadotoolkit.com/api`:

- `/v1_browser_extension/product_page_info`: enriquecimiento principal.
- `/v1_browser_extension/listing_sales_history`: historial de ventas por publicacion.
- `/v1_browser_extension/status`: estado de la extension.
- `/v1/catalog_product_items`: publicaciones de un producto.
- `/v1/get_by_id`: consulta por identificador.
- `/v1/item_tracking_data`: datos de seguimiento.
- `/v1/search_catalog_products`: busqueda de productos.
- `/v1/status`: estado de cuenta/servicio.
- `/v1/track_items`: alta de seguimiento.
- `/v1/untrack_items`: baja de seguimiento.

Los thunks de aplicacion examinados invocan las dos primeras; otras rutas
forman parte del cliente incluido y no prueban que exista una pantalla activa
para usarlas. El worker tambien llama directamente a product_page_info.
La configuracion conserva un host local de desarrollo del proveedor; no se usara.

No se identifico un cliente directo de OpenAI u otro proveedor ni un flujo
activo de generacion de publicaciones en la interfaz revisada. La ficha anuncia
IA, pero su implementacion del lado servidor no esta incluida.

### Mejoras derivadas del codigo

| Hallazgo estatico | Decision para la version propia | Hito |
| --- | --- | --- |
| pageInfo contiene userId, rootUserId y csrfToken, y se serializa hacia el proveedor. | DTO publico con lista cerrada de campos; rechazar campos de sesion y no enviarlos a ningun backend. | 1, 6, 7 |
| Proxy de fetch y seleccion de metodo por nombre con validacion limitada. | Mensajes tipados, esquemas estrictos, validacion del emisor y operaciones enumeradas; nunca aceptar URL, headers o metodo arbitrarios. | 1 |
| Conexiones externas abiertas y listener de costos sin comprobacion de origen. | Omitir externally_connectable y onMessageExternal; limitar hosts al marketplace y, si se aprueba, al backend propio. | 1 |
| El contacto se construye sobre un objeto mutable compartido. | Registro independiente por siteId y sellerId, procedencia, fecha y caducidad; sin mezcla entre vendedores. | 6 |
| Varias instancias guardan el bloque completo de estado. | Worker como unica autoridad de escritura; transacciones y actualizaciones por entidad. | 5 |
| Tareas idle basadas en variables globales y setTimeout. | Sin rastreo silencioso; trabajos persistidos y alarms solo para un modo autorizado. Recuperar estado tras reiniciar el worker. | 5, 6 |
| El montaje modifica estilo y atributo canary de elementos de MercadoLibre. | Un Shadow DOM propio, montaje idempotente y limpieza con el contexto de WXT; no cambiar estilos de la pagina anfitriona. | 3 |
| Sin un meta de precio se puede degradar toda la extraccion a pagina generica. | Campos parciales independientes, errores por campo y fuentes alternativas comprobadas. | 2 |
| Moneda y redondeo del grafico estan fijados a es-AR y cero decimales. | Moneda, exponente y locale por mercado; dinero en unidades menores enteras. | 2, 4 |
| El menor precio de las series se etiqueta como Buybox. | Separar precio minimo de ganador real; precio mas bajo no implica ganar el Buybox. | 6 |
| El mismo tier completo alimenta todos los porcentajes de cuotas. | Participacion independiente por segmento y denominador verificable. | 6 |
| Graficos suavizados unen ausencias y hay placeholders comerciales borrosos. | Marcar huecos y falta de cobertura; no fabricar metricas, vendedores ni periodos disponibles. | 3, 5 |
| El bundle content pesa 1.363.192 bytes y incluye el motor completo de graficos. | ECharts modular y carga diferida solo al abrir historial; medir el bundle resultante. | 5, 8 |

Las licencias visibles cubren librerias de terceros, no autorizan por si solas
la redistribucion del producto. El desarrollo sera independiente y no reutilizara
el nombre, identificador, clave publica, recursos visuales ni codigo del proveedor.

## Alcance propuesto

Propuesta para aprobar: Argentina como primer mercado verificado, porque el
simulador original solo implementa MLA. Mantener adaptadores extensibles a los
18 dominios, sin declarar otros paises compatibles hasta probar sus formatos y
fuentes. Idioma inicial espanol; portugues se incorpora con la validacion de Brasil.

| Funcion | Primera entrega local | Ampliacion condicionada |
| --- | --- | --- |
| Vista rapida | Producto, publicacion, vendedor, precio, moneda, enlace y origen de cada dato disponible. | Enriquecimiento por API autorizada. |
| Ofertas y competidores | Comparar ofertas publicas observadas; cuotas, Full/envio, filtros y ordenamiento. | Catalogo completo y datos remotos con paginacion permitida. |
| Rentabilidad | Calculo manual transparente con desglose, escenarios y reglas versionadas. | Tarifas oficiales documentadas con autorizacion; no copiar el endpoint interno del simulador. |
| Seguimiento | Alta/baja explicita, observaciones al visitar y fecha de ultima captura. | Actualizacion programada solo con fuente permitida y consentimiento. |
| Historial | Precio propio desde la primera captura, min/max, cambios, exportacion y borrado. | Historico anterior mediante fuente autorizada o importacion validada. |
| Buybox | Ganador observado si la fuente lo identifica y participacion en capturas. | Porcentaje temporal solo si se conoce metodologia, ventana y cobertura. |
| Perfil y contactos | Datos publicos verificables del vendedor con procedencia. | Perfil cuantitativo y contacto comercial con fuente autorizada; no adivinar identidades. |
| Ventas y velocidad | Mostrar la leyenda publica como dato declarado, no ventas diarias exactas. | Historial real o estimacion con metodologia, cobertura y etiqueta explicita. |
| Asistente de IA | Estado desactivado claro si no hay proveedor configurado. | Titulos, descripcion, atributos y analisis mediante backend propio aprobado. |

Los hitos 1 a 5 conforman una entrega local usable. Los hitos 6 y 7 completan
las funciones avanzadas; no se consideraran implementadas con datos simulados
en lugar de una fuente real. El hito 8 cierra cada entrega acordada.

## Arquitectura propuesta

### Fronteras de responsabilidad

- Content script: lectura publica, normalizacion, deteccion de navegacion y UI
	en mundo aislado. No accede al almacenamiento historico directamente.
- Worker: valida emisor y mensaje, escribe entidades, devuelve datos propios y
	controla conexiones a origenes permitidos. Registra listeners al arrancar.
- Dominio: modelos, dinero, calculadora, estadisticas y comparaciones puros,
	independientes de React, DOM y proveedor remoto.
- Interfaz: un panel de trabajo con Resumen, Ofertas, Historial, Rentabilidad y
	Vendedor; popup de acceso y opciones. No crear una landing page.
- Backend opcional: autenticacion propia, credenciales de proveedor, cuotas y
	servicio de IA/datos autorizados. Nunca usar la cuenta de MercadoToolkit.

### Herramientas previstas

Instalar despues de la autorizacion, con versiones compatibles fijadas en lockfile:

- WXT y su modulo React, Vite subyacente, TypeScript y React.
- Zod para contratos estrictos entre contextos; Lucide para controles.
- idb sobre IndexedDB para transacciones; storage.local solo para preferencias
	pequenas con acceso restringido a TRUSTED_CONTEXTS.
- Vitest, fake-indexeddb y jsdom para dominio, persistencia y extraccion;
	Testing Library para las vistas cuando se implementen.
- ECharts/core con LineChart y SVGRenderer, cargado de forma diferida en hito 5;
	Papa Parse cuando se implemente CSV, sin construir un parser manual.
- Herramientas de navegador existentes antes de instalar Playwright adicional.
- Servicio Node/TypeScript con Hono y SDK oficial del proveedor solo en hito 7,
	si se autoriza la integracion. No instalarlo durante el modo local.

No Next.js, Postgres, Redux, permisos cookies/debugger, ilimitados de red o
plugins globales por defecto. Node 24.14.0 esta disponible en el entorno actual.

### Contratos que deben mantenerse

| Modelo | Campos y reglas |
| --- | --- |
| Money | amountMinor entero seguro, currency ISO y exponent; nunca mensajes con BigInt o importes float. |
| PublicPageSnapshot | siteId, URL canonica, kind, listingId/productId, title, price, seller publico, observedAt y procedencia. Identificadores y campos faltantes son null, no cero inventado. |
| OfferSnapshot | ID de publicacion y vendedor, Money, numero de cuotas, interes, Full/envio, fuente y ganador observado opcional. |
| PriceObservation | Clave de publicacion + fecha UTC + moneda; precio, vendedor/producto y revision del extractor. No mezclar cambios de moneda. |
| FeeScenario/FeeResult | Precio, costo, cargos monetarios y tasas en puntos basicos; fuente/version; payout, profit y margen. Datos incompletos no producen un neto exacto. |
| SellerContact | siteId/sellerId, campo, valor, URL fuente, fecha y estado verificado/no confirmado; ninguna clave de comprador. |
| Capability | Estado available, disabled, unsupported o unavailable con razon y fuente; no inferir disponibilidad por un placeholder. |

Definir modelos y esquemas juntos en `src/shared/contracts.ts` y derivar tipos
de los esquemas. Mensajes en `src/messaging/protocol.ts`: version, requestId,
operacion enumerada y payload estricto. Respuestas: resultado o error tipado
invalid-input, forbidden, unsupported, unavailable, timeout, rate-limited,
storage-full o internal. No incluir HTML remoto, headers ni tokens en errores.

Funciones principales: `extractPublicPage(document, url): ExtractionResult`,
`calculateProfitability(scenario): FeeResult`,
`recordObservation(snapshot): Promise<ObservationResult>` y
`summarizeBuybox(observations, segment): BuyboxSummary`. Sus modelos viven en
el contrato compartido; las implementaciones pertenecen a los hitos siguientes.

## Hitos de implementacion

### Hito 1: base instalable y permisos

Archivos: `package.json`, lockfile, `wxt.config.ts`, `tsconfig.json`,
`vitest.config.ts`, `entrypoints/background.ts`, `src/shared/contracts.ts`,
`src/messaging/protocol.ts`, `src/messaging/protocol.test.ts` y
`tests/manifest.test.ts`.

1. Tras autorizacion, preparar WXT en la carpeta existente sin sobrescribir
	las instrucciones y skills de createapp. Fijar versiones y dependencias.
2. Definir scripts dev, build, typecheck y test; test debe ejecutar Vitest run.
	Generar Manifest V3, minimum_chrome_version 120 y permisos storage mas los
	dominios concretos del primer mercado. Sin externally_connectable.
3. Antes de implementar mensajes, escribir pruebas de esquema y emisor:
	aceptar solo contexto propio y marketplace autorizado; rechazar version
	desconocida, campos de sesion, URL arbitraria y payload malformado.
4. Registrar el router al arrancar, cargar estado de forma asincrona y devolver
	errores uniformes. No exponer un fetch generico ni ejecutar codigo remoto.
5. Compilar y cargar la extension desempaquetada en Brave con un perfil de
	pruebas nuevo. No reutilizar ni reemplazar la extension original.

Comprobacion: `npm run build`, `npm run typecheck` y
`npm run test -- src/messaging/protocol.test.ts tests/manifest.test.ts`.
Resultado: paquete `.output/chrome-mv3`, manifiesto correcto, pruebas PASS y
rechazo de mensajes no autorizados sin solicitudes de red.

### Hito 2: extraccion y normalizacion

Archivos: `src/platforms/mercadolibre/markets.ts`, `extract.ts`, `extract.test.ts`,
`src/shared/money.ts`, `money.test.ts` y fixtures sinteticas en `tests/fixtures/`.

1. Crear fixtures propias de publicacion, catalogo, pagina incompleta y ruta no
	soportada; no guardar paginas con informacion de una cuenta.
2. Escribir primero pruebas de JSON-LD, arrays/@graph, metadatos, enlaces e
	identificadores publicos. Un precio ausente no invalida titulo ni vendedor.
3. Implementar extractPublicPage con prioridad de datos estructurados y DOM.
	No evaluar scripts, recorrer cookies ni leer buyerId, root_user_id o csrf.
	Un fallback Nordic requerira evidencia de necesidad y lectura segura de
	campos publicos, no serializacion indiscriminada del estado.
4. Separar siteId, moneda y locale de la URL; validar origen, IDs y URL canonica.
	Distinguir publicacion de producto y no asumir que su ID es el mismo.
5. Verificar ARS `1.234,56` = 123456 unidades menores, BRL equivalente y CLP
	sin decimales; rechazar importes ambiguos, negativos, NaN e inseguros.
	Estos tests de formato no certifican por si solos el soporte de esos paises.

Comprobacion: `npm run test -- src/platforms/mercadolibre/extract.test.ts src/shared/money.test.ts`.
Resultado: campos parciales utilizables, moneda correcta y cero datos de sesion.

### Hito 3: vista rapida y navegacion

Archivos: `entrypoints/mercadolibre.content.tsx`, `entrypoints/popup/index.html`,
`entrypoints/popup/main.tsx`, `src/ui/App.tsx`, `src/ui/App.test.tsx`,
`src/ui/styles.css`, `src/platforms/mercadolibre/navigation.test.ts` y `DESIGN.md`.

1. Acordar en DESIGN.md una identidad propia: interfaz operativa compacta,
	tablas legibles, iconos con nombres accesibles, colores de estado y producto
	real como referencia visual. No copiar logos ni estilos de MercadoToolkit.
2. Montar un unico panel con createShadowRootUi, apertura/cierre y accion de
	toolbar; fallback visible si no existe el anclaje esperado de MercadoLibre.
3. Usar eventos de navegacion de WXT y observacion acotada del DOM; debounce de
	200 ms, limpieza al invalidar contexto y no sondeo permanente cada segundo.
4. Probar A -> B con respuesta tardia de A: no debe sobrescribir B. Desmontar
	React, observers y solicitudes al cerrar o reiniciar el contexto.
5. Mostrar carga, campo no disponible, datos viejos y error recuperable.
	Verificar teclado, foco de retorno, zoom 200%, popup de 380 px y paginas de
	1280/1920 px; sin modificar el estilo de elementos anfitriones.

Comprobacion: pruebas de App/navegacion, capturas y flujo en extension real.
Resultado: panel estable, sin duplicados ni solapamientos y con procedencia de datos.

### Hito 4: calculadora de rentabilidad

Archivos: `src/features/fees/calculate.ts`, `calculate.test.ts`, `FeesView.tsx`
y `FeesView.test.tsx`. Consume Money y FeeScenario; produce FeeResult.

1. Probar antes del calculo un escenario en unidades menores: precio 10000,
	comision 1000 puntos basicos, fijo 200, envio 500, impuestos 300, costo 4000
	y financiacion 0 debe producir payout 8000 y profit 4000.
2. Implementar desglose y redondeo consistente por moneda. Distinguir monto
	recibido, ganancia neta, margen sobre venta y retorno sobre costo.
3. Probar costo cero, perdida, precio cero, datos incompletos y tasa >= 100%:
	margen/punto de equilibrio no calculable no se presenta como cero valido.
4. Permitir escenarios manuales y guardar fuente/fecha/version de las reglas.
	Categoria, tipo de publicacion, cuotas y costo logistico no son universales.
5. Ofrecer enlace al simulador oficial cuando se necesite la cotizacion real.
	Una integracion automatica exige documentacion/autorizacion propia y su
	prueba real; no extraer CSRF ni usar el endpoint interno como contrato publico.

Comprobacion: `npm run test -- src/features/fees/calculate.test.ts src/features/fees/FeesView.test.tsx`.
Resultado: calculos reproducibles y supuestos visibles, incluso sin login.

### Hito 5: seguimiento e historial propio

Archivos: `src/background/store.ts`, `store.test.ts`,
`src/features/history/history.ts`, `history.test.ts`, `HistoryView.tsx`,
`transfer.ts`, `transfer.test.ts` y opciones en `entrypoints/options/`.

1. Escribir pruebas de dos pestanas con escrituras simultaneas y reinicio del
	worker. Cada observacion confirmada debe sobrevivir sin perder otra entidad.
2. Usar idb con stores versionados de publicaciones seguidas, observaciones y
	contactos. Deducir duplicados por identidad/fecha/fuente y terminar la
	transaccion antes de confirmar; no reemplazar un bloque global de Redux.
3. Implementar seguir/dejar de seguir y captura explicita al visitar. Mostrar
	ultima observacion, origen, periodos 7/30/90 dias y falta de cobertura.
	Datos propios consultables sin internet; nunca inventar historial previo.
4. Implementar min/max, cambios y grafico modular diferido con huecos visibles,
	tabla accesible alternativa y timestamps UTC. Retencion propuesta 90 dias,
	100 publicaciones y 50000 observaciones; informar los limites antes de
	aplicarlos y confirmar borrados o cambios de retencion.
5. Exportar CSV/JSON e importar JSON versionado/CSV con Papa Parse. Probar
	comillas/saltos de linea, formulas de hoja de calculo, moneda cambiada,
	duplicados y schema desconocido; una importacion invalida no borra datos.
	Gestionar cuota llena sin sobrescribir silenciosamente informacion anterior.

Comprobacion: `npm run test -- src/background/store.test.ts src/features/history/history.test.ts src/features/history/transfer.test.ts`.
Resultado: seguimiento y datos historicos propios recuperables, exportables y borrables.
No agregar rastreo idle, alarms ni notificaciones sin aprobar ese modo.

### Hito 6: catalogo y Buybox

Archivos: `src/features/catalog/catalog.ts`, `catalog.test.ts`, `OffersView.tsx`,
`src/features/sellers/contacts.ts`, `contacts.test.ts`, `SellerView.tsx` y
`src/services/marketplace.ts`, `marketplace.test.ts`.

1. Completar primero comparacion local por precio, cuotas e interes, Full/envio
	y fecha. Un estado desconocido no significa envio gratis ni cuota sin interes.
	Consumir OfferSnapshot y producir grupos comparables, no grupos por regex unica.
2. Probar un ganador mas caro que la oferta minima: ambos indicadores deben
	diferir. Para cuotas/directo, no reutilizar un porcentaje de otro segmento.
3. Implementar summarizeBuybox con porcentaje de capturas de ganador conocido,
	numero de muestras y ventana. Las capturas de ganador desconocido no cuentan
	como derrotas. Nunca etiquetar ese resultado como porcentaje de tiempo.
4. Construir contactos por vendedor con fuente/fecha, caducidad y validacion de
	URL http(s). Probar navegacion entre dos vendedores y enlaces javascript:.
	No buscar automaticamente personas ni asumir identidad desde un resultado de Google.
5. Elegir una API documentada/autorizada y completar paginacion solo con ese
	permiso. Backend propio si requiere secretos/OAuth. Timeout 10 s; maximo dos
	reintentos para operaciones idempotentes/transitorias, respetando Retry-After;
	nada de reintentar 401/403 ni de ignorar 429. Cancelar al cambiar de pagina.

Comprobacion: pruebas de catalogo/contactos/servicio y, tras permiso, prueba real
de la fuente. Si no hay fuente, capacidad unavailable sin datos de demostracion.
Ventas diarias, posicion de mercado y perfiles requieren metodologia y cobertura;
no inferirlos del texto publico de unidades vendidas ni de una unica captura.
Actualizar paises y seguimiento programado solo tras aprobar sus fuentes y pruebas.

### Hito 7: asistencia de IA

Archivos: `src/features/assistant/client.ts`, `client.test.ts`, `AssistantView.tsx`
y, solo si se autoriza, `services/assistant/` con su configuracion y pruebas.

1. Acordar proveedor, presupuesto, alojamiento y politica de datos. Sin esas
	decisiones, la capacidad queda desactivada y el resto de la extension funciona.
2. Definir DTO de producto publico, tarea y preferencias; un test debe rechazar
	HTML completo, cookies, CSRF, identificadores de comprador y claves de proveedor.
3. Crear el backend con autenticacion propia, SDK oficial, validacion, limites
	por usuario y secreto en entorno del servidor. CORS no reemplaza autenticacion.
4. Tratar texto de publicaciones como entrada no confiable: sin ejecucion de
	herramientas ni obediencia a instrucciones embebidas. Validar salida
	estructurada, no renderizar HTML arbitrario y marcar afirmaciones sin fuente.
5. Mostrar propuesta de titulo, descripcion y atributos con diferencias y copia
	manual. Consentimiento antes del envio; sin publicar automaticamente ni
	generar correos/redes del vendedor. Probar cancelacion, errores y limites.

Comprobacion: pruebas de DTO/cliente/backend y prueba real solo con credenciales
aportadas fuera del chat y presupuesto aprobado. No basta un mock para certificar IA.

### Hito 8: validacion y entrega

Archivos: `tests/extension.spec.ts`, `README.md` y `PRIVACY.md`.

1. Ejecutar `npm run typecheck`, `npm run test` y `npm run build`; comprobar
	fuentes de dependencias, licencias, permisos, CSP y ausencia de secretos.
2. Cargar cada build validado en un perfil temporal nuevo de Chromium/Brave.
	Probar popup, contenido, navegacion, almacenamiento y reinicio del worker.
	Fixtures y preview web no acreditan por si solos funcionamiento en MercadoLibre.
3. Con permiso, probar publicaciones reales del mercado acordado sin acciones
	de venta ni envio automatico de informacion a terceros; registrar lo no probado.
4. Comprobar accesibilidad, zoom, capturas, texto largo, desbordes y carga diferida.
	Medir tamano de bundles y confirmar que graficos no cargan en la entrada inicial.
5. Documentar carga desempaquetada, permisos, datos locales, borrado, fuentes,
	funciones condicionadas, fallos y actualizacion. Preparar ZIP local; no publicar
	en la tienda, crear commits/ramas ni desplegar servicios automaticamente.

Resultado: entrega local instalable, comprobaciones reproducibles y limites honestos.
La extension objetivo es escritorio Brave/Chrome; un viewport estrecho no certifica
compatibilidad con Brave Android ni con Safari.

## Preparacion ya realizada

createapp 0.2.2 configuro 11 perfiles, trabajo guiado y subagentes desactivados.
Su diagnostico confirmo la configuracion. En esa fase no se crearon fuentes ni
dependencias de la app. La carpeta no era un repositorio Git inicializado durante la primera
comprobacion; no se crearon ramas ni commits.

## Avance del hito 1

Autorizacion: el usuario indico comenzar este plan. Se implemento solo el primer
hito, conservando las instrucciones y skills de createapp. Mercado inicial de
trabajo: Argentina / MLA. Nombre provisional independiente: MeliExtension; la
identidad visual definitiva queda pendiente para el hito de interfaz.

- Base WXT 0.21.5 y modulo React 1.2.2, React 19.3.1, TypeScript 7.0.2,
  Zod 4.6.7 y Vitest 5.0.5, con versiones fijadas y package-lock.json.
- Manifest V3, Chrome minimo 120, storage y solo el dominio HTTPS argentino;
  sin cookies, debugger, idle, unlimitedStorage ni conexiones externas.
- Protocolo version 1 con status.get y preferences.get; objetos estrictos,
  UUID de solicitud, control de emisor, dominio, origen y frame principal.
  No hay proxy generico de red ni aceptacion de campos de cuenta o sesion.
- Listener registrado sin await. Inicializacion asincrona compartida y
  recuperable; storage.local restringido a TRUSTED_CONTEXTS antes de leer
  preferencias. Estado incompatible usa valores predeterminados seguros.
- Capacidades declaradas no disponibles o desactivadas. Todavia no hay popup,
  content script, extraccion, calculadora, historial, contactos ni IA.

Verificacion realizada:

1. RED: 28 pruebas del protocolo fallaron con una interfaz provisional vacia.
	GREEN: pasaron tras implementar esquemas, emisor e inicializacion.
2. Una prueba adicional detecto inicializacion solo al recibir mensajes; se
	corrigio para iniciar al arrancar sin bloquear el registro del listener.
3. npm run typecheck y npm run build pasaron. Las 40 pruebas de protocolo,
	manifiesto generado y ciclo de vida del worker pasaron. Las pruebas de
	almacenamiento/reinicio usan dobles de la API, no un perfil personal.
4. npm ls --depth=0 no detecto conflictos; npm audit --omit=dev no reporto
	vulnerabilidades conocidas en dependencias de ejecucion. Esto no constituye
	una auditoria completa ni reemplaza la revision final del hito 8.
5. Brave 156.1.98.63 cargo el bundle real en un perfil temporal nuevo, con red
	bloqueada: MV3, permisos, almacenamiento accesible y listener registrado.
	El ID fue distinto del original. Se cerro el navegador y elimino ese perfil.
	Se uso playwright-core temporal fuera del producto tras una interrupcion
	de la comprobacion por DevTools nativo; no se agrego como dependencia.

Paquete generado: .output/chrome-mv3, 90.66 kB en total, con manifest.json y
background.js. No se copio codigo ni recursos del proveedor. Las pruebas no
acreditan funciones en publicaciones reales ni ejecucion en Chrome 120: esa
version es el minimo declarado; el navegador efectivamente probado fue Brave
156. Tampoco se probaron popup ni UI, que pertenecen a hitos siguientes.

Preparacion reproducible desde estas fuentes:

```powershell
npm ci --ignore-scripts
npm run prepare:extension
npm run typecheck
npm run build
npm run test -- src/messaging/protocol.test.ts tests/background.test.ts tests/manifest.test.ts
```

Carga manual: abrir brave://extensions o chrome://extensions, activar el modo
desarrollador y usar "Cargar descomprimida" sobre .output/chrome-mv3. Esta base
no tiene boton/popup ni modifica paginas; esas funciones aun no se implementaron.
Para probar futuros builds, usar un perfil temporal nuevo o recargar explicitamente
la extension propia. No reemplazar la extension original instalada.

## Avance del hito 2

Autorizacion: el usuario indico "prosegui" tras el cierre del hito 1. Se
implemento extraccion y normalizacion como modulos locales independientes; no
se inicio el hito de interfaz ni se ampliaron los permisos del manifiesto.

- Money y PublicPageSnapshot tienen esquemas compartidos estrictos. Los
	importes se devuelven como enteros seguros y los campos ausentes como null.
- parseMoney separa precios decimales de maquina de precios visibles segun
	locale. ARS y BRL usan dos decimales, CLP ninguno; tambien se conserva USD
	cuando esta declarado. No se convierten monedas ni se redondea precision
	invalida. BigInt se usa solo internamente para comprobar el limite seguro;
	no aparece en snapshots ni mensajes.
- extractPublicPage valida origen HTTPS argentino y la estructura de ruta
	antes de consultar el documento. Separa publicacion de catalogo y conserva
	una publicacion seleccionada explicitamente sin confundirla con el producto.
	URL canonica y enlaces de vendedor no conservan query ni fragmentos.
- Prioridad: JSON-LD, metadatos y DOM publico acotado. Soporta arrays, @graph
	y referencias @id sin seleccionar productos recomendados o identidades
	contradictorias. Referencias duplicadas/ciclicas, precios de otra publicacion
	y ofertas multiples ambiguas quedan sin valor; lowPrice no es precio actual.
- Cada campo encontrado conserva origen y URL de procedencia. Los resultados
	complete requieren titulo, precio y nombre publico de vendedor; partial
	preserva los campos validos, y unsupported no incluye un snapshot.
- No se lee Nordic, cookies, globals de sesion ni estado privado. No se ejecutan
	scripts, modifican nodos anfitriones, realizan requests ni extraen contactos.
- Cuatro fixtures HTML propias: publicacion, catalogo, pagina incompleta y ruta
	no soportada. Los valores de sesion presentes en las fixtures son ficticios
	y sirven solo para comprobar su exclusion del resultado.
- jsdom 26.1.0 se instalo solo como dependencia de pruebas, sin scripts de
	ciclo de vida. Es compatible con Node 24.14.0; jsdom 30.1.3 exige un Node
	posterior. Vitest separa pruebas unitarias Node y de plataforma en jsdom.

Verificacion realizada:

1. RED/GREEN de importes: 10 casos validos fallaron con el parser provisional;
	las 39 pruebas monetarias pasaron tras implementarlo.
2. RED/GREEN de extraccion: 17 casos fallaron antes de implementar la lectura.
	Se corrigio una inclusion accidental de claves internas que el contrato
	estricto rechazo aun teniendo valor undefined.
3. Regresiones RED/GREEN confirmaron y corrigieron rutas privadas anidadas,
	ofertas ajenas, identificadores contradictorios y coincidencias entre IDs
	null. Las 34 pruebas del extractor pasaron.
4. npm run typecheck y npm run build pasaron. npm run test aprobo 113 pruebas:
	73 nuevas y las 40 del hito 1. npm audit no reporto vulnerabilidades conocidas;
	git diff --check, contemplando CRLF, y los diagnosticos del editor pasaron.

Comprobacion enfocada reproducible:

```powershell
npm run test -- src/platforms/mercadolibre/extract.test.ts src/shared/money.test.ts
npm run typecheck
npm run build
```

Limites: solo se acepta el mercado argentino. Las pruebas de formato BRL/CLP
no certifican Brasil o Chile. Los selectores DOM y la estructura JSON-LD se
validaron sobre fixtures sinteticas, no sobre publicaciones reales actuales.
La integracion del extractor con el content script y el popup pertenece al
hito 3; la base instalada aun no analiza paginas ni ofrece interfaz. El worker
sigue exponiendo solo estado y preferencias. El build actual pesa 96.36 kB;
la carga real en Brave documentada arriba corresponde al build del hito 1.

Estado de avance:

- [x] Hito 1: base instalable y permisos.
- [x] Hito 2: extraccion y normalizacion.
- [ ] Hito 3: vista rapida y navegacion; pendiente de indicacion para continuar.
- [ ] Hitos 4-8: no iniciados.

## Validacion y pendientes del plan

- [x] Identificar paquete y version instalada.
- [x] Configurar herramientas de planificacion y desarrollo con createapp.
- [x] Procesar todos los scripts y recursos del paquete en modo de solo lectura.
- [x] Documentar flujo de datos, funciones, contratos y limites observados.
- [x] Completar mejoras, archivos propuestos y pruebas por hito.
- [x] Confirmar que el plan no introduce codigo de aplicacion.
- [x] Obtener autorizacion antes de implementar.

Decisiones pendientes: identidad/nombre definitivo y fuentes/presupuesto para
hitos 6-7. Avanzar entre hitos requiere indicacion conforme al proceso guiado.
La autorizacion de implementacion no es permiso implicito para publicar ni para
modificar la instalacion existente de Brave.

## Referencias y trazabilidad

- [Ficha de la extension](https://chromewebstore.google.com/detail/mercadolibre-herramientas/agkdknlphoikfmliifdcdgijjhmcjile).
- [WXT: content scripts, Shadow DOM y ciclo de UI](https://wxt.dev/guide/essentials/content-scripts.html).
- [Chrome: ciclo del service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
- [Chrome: storage y niveles de acceso](https://developer.chrome.com/docs/extensions/reference/api/storage).

SHA-256 de los bundles analizados, para identificar la version exacta sin
incorporar su codigo al repositorio:

| Bundle | SHA-256 |
| --- | --- |
| background | f28b7485c622480a3aaa5da8b9bb0ffab8bc20b1d82d42c05938bb0178d96751 |
| content | 8f86d7df362cefa44b5108f1d5b597439a4f6a79d019dc5e2f2dff2c2a666014 |
| main | d4b2be10eb457ebc6749879ceab8991b7e40f8d97a3f49906452b576ec2ca812 |