<div align="center">

<img src="./icon.png" alt="CodeNexum" width="180"/>

# CodeNexum

### Tu modelo sabe mucho. Tu contexto, no tanto.

**CodeNexum** es un indexador de código + motor de compresión de contexto para [opencode](https://opencode.ai).
Recorta drásticamente los tokens que gastas en `read`, `grep`, `glob` y `bash` — sin perder un ápice de precisión —
y te devuelve una ventana de contexto útil, no una papelera de logs.

> _“No es que tu modelo tenga poco contexto. Es que lo estás llenando de paja.”_

</div>

---

## ¿Por qué CodeNexum?

Cuando le pides a un agente que explore un repositorio, ocurre esto:

- `read` devuelve el archivo completo aunque solo necesites una función.
- `grep` escupe 4.000 líneas con `node_modules` incluidas.
- `bash npm test` te tira el log entero de 800 líneas cuando solo querías saber si pasó.

Eso son **decenas de miles de tokens tirados a la basura** en cada turno. CodeNexum intercepta ese ruido y lo reemplaza por algo que tu modelo sí puede usar: **chunks indexados, resúmenes semánticos y métricas en tiempo real**.

### El resultado

- **Menos tokens gastados, más conversación útil** — ahorra entre 40 % y 80 % del output de herramientas en proyectos medianos.
- **Respuestas más rápidas** — el modelo recibe menos basura que procesar por turno.
- **Cero cambio de flujo** — el plugin intercepta en `tool.execute.before/after`; tú solo usas opencode normal.
- **Visibilidad total** — un dashboard en vivo te dice exactamente qué ahorraste, dónde y por qué.

---

## ✨ Bondades

| | Feature | Por qué te importa |
|---|---|---|
| 🔥 | **Indexado incremental FTS5 + BM25** | SQLite local con búsqueda sub-milisegundo. Tu código queda searchable, no solo leíble. |
| 🧠 | **Resúmenes semánticos** | `npm test` con 800 líneas → 1 línea: `8 passed, 3 failed`. El modelo sabe lo que necesita. |
| ✂️ | **Compresión ANSI / dedupe / stack-trim** | Quita colores, colapsa líneas repetidas, recorta indentación. Detalles que cuestan tokens y no aportan. |
| 🧩 | **Substitución de `read` por chunks** | Lee el archivo, devuelve solo los símbolos indexados (funciones, clases, exports). Mantienes contexto sin pagar el archivo entero. |
| 🔍 | **`grep` y `glob` indexados** | Buscar en el código real indexado, no en tu filesystem con todo el ruido. |
| 🔗 | **Callers / callees / impact** | Pregunta `¿quién usa esta función?` y obtén la lista al instante, sin navegar manualmente. |
| 💾 | **Caché en memoria + disco** | Repeticiones del mismo `read`/`grep` no cuestan nada. Persistente entre sesiones. |
| 📊 | **Dashboard React con métricas en vivo** | Ve tokens ahorrados, top queries, archivos calientes, salud del índice, todo en tiempo real. |
| 🪶 | **Plugin delgado (~120 LOC)** | Sin lógica de negocio en el plugin. Todo el indexado vive en la app — el plugin es solo un proxy. |
| 🖥️ | **Multiplataforma** | macOS, Windows, Linux. App de bandeja con auto-inicio. |

---

## 🚀 Quick start

### 1. Instala la app

Descarga el instalador para tu plataforma desde **Releases** o compílalo:

```bash
bun install
bun run --filter @codenexum/electron package
```

| Plataforma | Artefacto |
|---|---|
| macOS (Apple Silicon) | `CodeNexum-0.99.0-arm64.dmg` |
| Windows | `CodeNexum 0.99.0.exe` (portable) |
| Linux | `CodeNexum-0.99.0.AppImage` |

Abre la app — corre en segundo plano con un icono en la bandeja.

### 2. Registra el plugin

Añade a tu `opencode.json`:

```json
{
  "plugins": ["@codenexum/plugin"]
}
```

Reinicia opencode. **Ya está.** La próxima vez que tu agente lea un archivo, CodeNexum hará su magia.

### 3. Mira el dashboard

Abre la ventana de CodeNexum o lanza `context_dashboard` desde el agente para ver tu ahorro acumulado, top queries y salud del índice.

---

## 🧠 Cómo funciona

```
┌─────────────────────────────────────────────────────┐
│  opencode                                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │  @codenexum/plugin (MCP client)                 │ │
│  │  - registra 7 herramientas context_*            │ │
│  │  - intercepta read / bash / grep / glob         │ │
│  │  - comprime outputs antes de devolver           │ │
│  └──────────────┬──────────────────────────────────┘ │
└─────────────────┼────────────────────────────────────┘
                  │ MCP (streamable HTTP)
┌─────────────────▼────────────────────────────────────┐
│  @codenexum/electron (CodeNexum app)                │
│  ┌─────────────┐ ┌──────────────────────────────────┐│
│  │  Main proc  │ │  MCP server (:7770)              ││
│  │  - bandeja  │ │  - indexador (SQLite FTS5)       ││
│  │  - auto-start│ │  - búsqueda / related / impact ││
│  │  - settings │ │  - compresión + resumen sem.     ││
│  └─────────────┘ │  - telemetría de tokens          ││
│                   │  - datos del dashboard           ││
│  ┌────────────────────────────────────────────────┐ ││
│  │  Renderer — Dashboard React                    │ ││
│  └────────────────────────────────────────────────┘ ││
│  ┌────────────────────────────────────────────────┐ ││
│  │  SQLite (node:sqlite, FTS5 + BM25 + edges)    │ ││
│  └────────────────────────────────────────────────┘ ││
└─────────────────────────────────────────────────────┘
```

Cuando tu agente ejecuta `read foo.ts`, el plugin:

1. Captura el path antes de que la herramienta nativa corra.
2. Llama al MCP server con `cm_read_snippet`.
3. El server devuelve los **chunks indexados** del archivo (símbolos, signatures, contexto).
4. Si el snippet indexado es más pequeño que el `read` nativo → lo sustituye.
5. Registra el ahorro en `usage_events` para el dashboard.

Lo mismo con `grep`, `glob` y `bash cat|head|tail`.

---

## 🛠️ Herramientas que registra

| Tool | Qué hace |
|---|---|
| `context_search` | Búsqueda full-text (FTS5 + BM25) sobre el índice |
| `context_related` | Callers, callees, imports, extends, implements de un símbolo |
| `context_impact` | Archivos que dependen de los archivos dados |
| `context_stats` | Estadísticas del índice: chunks, fill %, ahorro estimado |
| `context_analyze` | Re-indexar un proyecto o path |
| `context_read_snippet` | Snippet indexado en vez de `read` completo |
| `context_search_snippet` | Snippet de búsqueda para reemplazar `grep`/`glob` |
| `context_compression` | Diagnóstico del compresor |
| `context_dashboard` | Resumen JSON del dashboard |

---

## 📊 El dashboard

Abre la app y mira en tiempo real:

- **Tokens ahorrados** (acumulado + por mecanismo: substitución, snippets, compresión, caché)
- **Top queries** — qué busca más tu agente
- **Archivos calientes** — qué código se lee más
- **Salud del índice** — por proyecto, con freshness, cobertura, fallos
- **Actividad reciente** — feed de cada interceptación

No más volar a ciegas. Ves exactamente dónde se van (y dónde se ahorran) los tokens.

---

## 🧪 ¿Cuándo vale la pena?

| Situación | ¿Vale? |
|---|---|
| Sesión larga, 20+ llamadas a herramientas en un codebase grande | **Sí, brutal** |
| Proyecto mediano que tu agente recorre por primera vez | **Sí** |
| Debug de tests / build con logs enormes | **Sí, enorme** (compresión semántica) |
| Una pregunta rápida, sin tools | No (overhead del plugin > ahorro) |
| Proyecto minúsculo (<20 archivos) | No (nada que indexar) |

> **Regla de dedo:** break-even a partir de 3-4 llamadas a herramientas. Todo lo que pase de ahí es ganancia neta.

---

## 🏗️ Arquitectura

```
packages/
  core/          — types, tokenizer, format, search parser, resolve, context
  sql/           — SQLite layer (store, edges, parsers) via node:sqlite
apps/
  electron/      — App de bandeja (main + MCP server + dashboard React)
  plugin/        — Plugin de opencode (~120 LOC, cliente MCP puro)
```

Stack: **TypeScript estricto**, **Electron 43**, **React 19**, **Tailwind**, **node:sqlite**, **recharts**.

---

## ⚙️ Configuración

Ver [CONFIG.md](./CONFIG.md) para todas las variables de entorno (`CODENEXUM_*`).

Las más útiles:

- `CODENEXUM_MCP_PORT` (7770) — puerto del servidor MCP
- `CODENEXUM_MCP_URL` — override del endpoint
- `CODENEXUM_MAX_FILES` (10000) — tope de archivos indexados por proyecto
- `CODENEXUM_MAX_FILE_BYTES` (1MiB) — tope por archivo
- `CODENEXUM_SEMANTIC_COMPRESS` (1) — activa resúmenes semánticos

---

## 🗑️ Desinstalar

Quita `"@codenexum/plugin"` de tu `opencode.json` y reinicia. Para limpieza total:

```bash
rm -rf ~/.config/codenexum
rm -rf ~/.config/opencode/plugins/node_modules/@codenexum
```

---

## 📜 Licencia

MIT.

---

<div align="center">

**Hecho para que tu agente llegue más lejos con menos.**

[Reporta un bug](https://github.com/madkoding/codenexum/issues) · [Pide una feature](https://github.com/madkoding/codenexum/issues) · [Ver releases](https://github.com/madkoding/codenexum/releases)

</div>
