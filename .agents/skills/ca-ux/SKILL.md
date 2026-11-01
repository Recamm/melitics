---
name: ca-ux
description: "Diseñar o revisar interacción, accesibilidad y responsive. Respetar el sistema de diseño acordado."
---

# ca-ux

1. Leer `.createapp/POLICY.md` desde la raíz del proyecto. Aplicar su coordinación, autonomía, pruebas y alcance.
2. Si la tarea coincide con este rol, consultar solo las secciones necesarias de las fuentes de abajo. No invocar sus nombres originales como otras skills. Sus flujos, gates, pruebas, formato y herramientas son recomendaciones sujetas a las excepciones explícitas de POLICY.md.
3. Trabajar dentro de ese rol y devolver evidencia al coordinador. No encadenar bootstraps ni otros orquestadores.

Fuentes originales fijadas por commit (rutas relativas a la raíz del proyecto):
- `.createapp/vendor/nextlevelbuilder/ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/SKILL.md`

El ejecutable CreateApp incluye Python para este buscador: desde el proyecto, usar `createapp . --ux-search "consulta breve" --design-system`. Si trabajás desde el código fuente, también sirve `python ".createapp/vendor/nextlevelbuilder/ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/scripts/search.py" "consulta breve" --design-system`. No asumir CLAUDE_PLUGIN_ROOT: esta instalación no es un plugin.

Este perfil fue adaptado por CreateApp. No equivale a instalar el plugin oficial completo; sus hooks y comandos nativos no se instalan. Ver `.createapp/sources.lock.json` para procedencia y licencias.
