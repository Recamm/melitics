# meliextension

## Arrancar

La configuración se agrega al proyecto existente. No se crea ni modifica el código de la aplicación.

La instalación de dependencias es explícita. CreateApp no ejecuta npm, pip, Git, despliegues ni servicios externos durante la generación. Las herramientas que necesiten las skills se comprueban con `createapp . --doctor`.

## Empezar con tu asistente

Abrí esta carpeta con GitHub Copilot y enviá:

> Leé AGENTS.md, .createapp/POLICY.md y .createapp/config.json. Revisá el código existente y trabajá con el coordinador y la autonomía configurados. Usá solo los perfiles ca-* que correspondan a la tarea. Primero resumí el objetivo y el siguiente paso; después avanzá hasta verificarlo.

## Objetivo inicial

Extension propia para Brave y Chrome (Manifest V3), TypeScript y React con Vite, destinada a analizar publicaciones de MercadoLibre. Referencia funcional: MercadoLibre Herramientas con IA / MercadoToolkit, ID agkdknlphoikfmliifdcdgijjhmcjile, version instalada 1.0.43. Fase actual: analisis de solo lectura y plan; NO crear codigo de aplicacion, scaffold, package.json ni instalar dependencias del producto hasta autorizacion expresa del usuario. No copiar codigo, marca ni recursos propietarios sin licencia o permiso. Implementacion independiente; permisos minimos, sin cookies ni credenciales extraidas. Vista rapida, calculadora de tarifas verificadas, historial propio de precios; IA y Buybox sujetos a fuentes autorizadas y backend propio. No reutilizar ni eludir autenticacion, limites o pagos de servicios privados de MercadoToolkit. Comunicacion en espanol. Preparacion autorizada: solo skills e instrucciones mediante createapp.

## Qué se instaló

- Perfiles locales adaptados para roles concretos; no plugins oficiales completos.
- Fuentes originales en `.createapp/vendor/`, fijadas a commits y verificadas con hashes de blob Git.
- Un contrato de coordinación en `.createapp/POLICY.md` y la selección en `config.json`.
- `11` perfiles en `.agents/skills/`, con activación limitada al rol.

Los paquetes opcionales y herramientas se describen en la configuración. Si elegiste Graphify, ejecutá manualmente `python .createapp/setup_graphify.py`; luego consultá el ejecutable local con --help. No hace falta registrar otra skill con graphify install.
Los perfiles no garantizan obediencia del modelo ni eliminan conflictos con plugins globales. Si otra instalación ignora el contrato, desactivala en esa sesión.
No se instaló una PWA, autenticación, base de datos ni CI por seleccionar referencias de esas tecnologías. Son decisiones de implementación posteriores.

## Cambios y actualizaciones

Volvé a ejecutar `createapp` en este proyecto para elegir únicamente skills faltantes del catálogo actual. También podés usar `createapp --ui` o `createapp . --add-skills impeccable find-skills`; `--dry-run` muestra ese plan sin escribir. Se conservan los perfiles existentes, las fuentes fijadas y las decisiones del contrato. Las nuevas fuentes quedan separadas en `.createapp/additions/`.
Podés editar POLICY.md para cambiar acuerdos; editar config.json por sí solo no reinstala ni elimina perfiles. Este modo no actualiza ni quita skills instaladas ni cambia el coordinador. Una actualización de fuentes existentes requiere revisión y migración explícitas; nunca se reemplazan silenciosamente.
