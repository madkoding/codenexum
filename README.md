# opencode-context-manager

Plugin + Skill para que [opencode](https://opencode.ai) maneje proyectos grandes con compresión inteligente de contexto y búsqueda en el código.

## Qué incluye

- **Plugin nativo TS** — 4 tools + 2 hooks que el LLM usa directamente:
  - `context_analyze` — indexa un proyecto: parsea funciones, clases, interfaces, type aliases y enums
  - `context_search` — busca por palabra clave sobre el índice local
  - `context_stats` — muestra estadísticas del índice
  - `context_clear` — limpia el índice
  - **Auto-update**: el índice se actualiza solo cuando editas archivos (hook `event`)
  - **System prompt**: inyecta instrucciones para que el LLM use `context_search` antes de leer archivos (hook `experimental.chat.system.transform`)
- **SKILL.md** — Enseña a opencode a clasificar archivos en 3 niveles y comprimir contexto.

Sin Python, sin venv, sin dependencias externas pesadas. Una dependencia: `@opencode-ai/plugin` (instalada automáticamente).

## Instalación

```bash
git clone https://github.com/madkoding/opencode-context-manager.git
cd opencode-context-manager
./install.sh
# Reinicia opencode
```

El script:
1. Copia el plugin a `~/.config/opencode/plugins/`
2. Copia el SKILL.md a `~/.config/opencode/skills/context-manager/`
3. Instala `@opencode-ai/plugin` si no está
4. Añade el plugin a `opencode.jsonc` automáticamente

## Desinstalación

```bash
./uninstall.sh
```

## Tools

| Tool | Args | Uso |
|------|------|-----|
| `context_analyze` | `path` (opcional) | Indexar proyecto actual o una ruta específica |
| `context_search` | `query` (requerido), `n` (opcional, default 10) | Buscar código indexado |
| `context_stats` | — | Ver estado del índice |
| `context_clear` | — | Borrar el índice |

## Cómo funciona

1. `context_analyze` recorre el árbol de directorios ignorando `node_modules/`, `.git/`, etc.
2. Para cada archivo de código (`.py`, `.js`, `.ts`, `.go`, `.rs`, `.java`, etc.) extrae funciones, clases, interfaces, type aliases y enums con expresiones regulares.
3. Guarda todo en un archivo JSON en `~/.cache/opencode/context-manager.json`.
4. `context_search` hace matching por tokens con scoring: nombre exacto pesa más que contenido parcial.
5. **Auto-update**: cuando un archivo cambia, se re-parsea solo ese archivo y se actualizan sus chunks en el índice (con debounce de 500ms y hash para evitar re-parse innecesario).
6. **System prompt**: cada turno, si hay índice, se inyecta un `<context-manager>` block indicando al LLM que use `context_search` antes de leer archivos.

## Lenguajes soportados

Python, JavaScript/TypeScript, Go, Rust, Java, Ruby, PHP, C/C++, C#

## Requisitos

- opencode v1.x
- [Bun](https://bun.sh) (para instalar `@opencode-ai/plugin`)