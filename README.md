# opencode-statusline

Barra de estado para [OpenCode](https://opencode.ai) que muestra, en una sola línea en la
parte inferior de la terminal, **cuánto contexto llevas, cuánto te está costando la sesión
y cuánto te queda de tu plan y cuándo se reinicia**.

Es la versión para OpenCode de la status line de Claude Code.

```
Kimi K3 · ▓▓▓░░░░░░░ 28% 72.0k/256.0k · 💬 317.1k · 💶 $0.42 ~€0.39 · ⏱ 5m · 5h 34% (2h 14m) · sem 12% (5d 5h) · mes 4% (18d 3h)
```

## Qué muestra

| Elemento | Significado |
|----------|-------------|
| `Kimi K3` | Modelo que estás usando. |
| `▓▓▓░░░░░░░ 28% 72.0k/256.0k` | Contexto ocupado: tokens del último turno sobre el máximo del modelo. |
| `💬 317.1k` | Tokens nuevos de la sesión (no cuenta las relecturas de caché, que inflarían el total). |
| `💶 $0.42 ~€0.39` | Coste de la sesión en dólares y euros aproximados. |
| `⏱ 5m` | Minutos desde que empezó la sesión. |
| `5h 34% (2h 14m)` … | Uso de tu plan y, entre paréntesis, cuánto falta para que se reinicie. |

Los porcentajes cambian de color según el uso: **verde** por debajo del 60 %, **amarillo**
desde el 60 % y **rojo** desde el 85 %. Se usan los colores del tema de OpenCode que tengas.

### Uso del plan según el proveedor

| Proveedor | Qué muestra |
|-----------|-------------|
| **OpenCode Go** (suscripción de 10 $/mes) | `5h` · `sem` · `mes`: % gastado de cada límite y cuándo se reinicia. `⛔` si ya lo has agotado. |
| **OpenCode gratis** (modelos *free* de Zen) | `gratis · se reinicia (11h 18m)`. El tope diario de peticiones vuelve a cero a las 00:00 UTC. OpenCode no dice cuántas llevas ni cuántas quedan, así que solo se puede mostrar el reinicio. |
| **OpenRouter** | `💳` créditos gastados de los comprados y %; gasto de `hoy`, `sem` y `mes` con su reinicio; % del límite si la clave tiene uno; peticiones gratis del día si usas un modelo `:free`. |
| **Claude** (suscripción Pro/Max conectada a OpenCode) | `5h` · `sem`, igual que en Claude Code. |

Dentro de una sesión se muestra el uso del proveedor del modelo que estás usando. En la
pantalla de inicio aparece el de todos los proveedores que tengas conectados. El dato se
actualiza cada minuto y al terminar cada respuesta.

No hay que configurar ninguna clave: el plugin usa la que OpenCode ya guardó al conectar el
proveedor con `/connect`.

## Requisitos

**OpenCode 1.18 o superior** (probado con la 1.19.3). Para ver tu versión:

```
opencode --version
```

No hace falta instalar Node ni ninguna dependencia: OpenCode ya trae todo lo que usa el
plugin.

## Instalación

### 1. Descargar el plugin

Descarga [`statusline.tsx`](statusline.tsx) (botón **Download raw file** en GitHub) o
clona el repositorio:

```
git clone https://github.com/DavidDaganzo/opencode-statusline.git
cd opencode-statusline
```

### 2. Copiarlo a la configuración de OpenCode

Ponlo en una carpeta `tui-plugins` dentro de la configuración de OpenCode:

- **Windows:** `C:\Users\TU_USUARIO\.config\opencode\tui-plugins\statusline.tsx`
- **Mac / Linux:** `~/.config/opencode/tui-plugins/statusline.tsx`

Desde la carpeta donde está `statusline.tsx`:

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory -Force "$HOME\.config\opencode\tui-plugins"
Copy-Item statusline.tsx "$HOME\.config\opencode\tui-plugins\"
```

```bash
# Mac / Linux / Git Bash
mkdir -p ~/.config/opencode/tui-plugins
cp statusline.tsx ~/.config/opencode/tui-plugins/
```

> ⚠️ **No** lo pongas en `~/.config/opencode/plugins/`. OpenCode carga esa carpeta
> automáticamente como plugins de *servidor*, y este es un plugin de *interfaz (TUI)*.

### 3. Activarlo en `tui.json`

OpenCode solo carga los plugins de interfaz que estén en `tui.json`:

- **Windows:** `C:\Users\TU_USUARIO\.config\opencode\tui.json`
- **Mac / Linux:** `~/.config/opencode/tui.json`

**Si el fichero no existe**, créalo con este contenido (o copia el [`tui.json`](tui.json)
de este repositorio):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./tui-plugins/statusline.tsx"]
}
```

**Si ya existe**, añade `"./tui-plugins/statusline.tsx"` a la lista `plugin` (créala si no
está) respetando las comas del JSON. La ruta es relativa a la carpeta de `tui.json`.

### 4. Reiniciar OpenCode

Cierra OpenCode y vuelve a abrirlo. Abajo verás el uso de tu plan. Al abrir una sesión y
recibir la primera respuesta aparecen también el modelo, el contexto, los tokens y el coste.

> **Windows: "la ejecución de scripts está deshabilitada en este sistema".** No tiene que
> ver con el plugin: PowerShell bloquea el lanzador de OpenCode que instala npm. Arranca
> con `opencode.cmd` o permite los scripts locales para tu usuario (no hace falta ser
> administrador):
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

## Actualizar

Vuelve a copiar la nueva versión de `statusline.tsx` encima de la anterior y reinicia
OpenCode. No hace falta tocar `tui.json`.

## Personalizar

Al principio de `statusline.tsx`:

- `EUR_RATE`: cambio de dólares a euros (por defecto `0.92`).
- `USAGE_POLL_MS`: cada cuánto se consulta el uso del plan (por defecto, 60 000 ms).
- Los umbrales de color están en la función `colByPct`.

## Desactivarlo

Sin borrar nada, añade esto a `tui.json`:

```json
{
  "plugin_enabled": { "daviddaganzo.statusline": false }
}
```

Para quitarlo del todo, borra la entrada de la lista `plugin` y el fichero
`tui-plugins/statusline.tsx`.

## Problemas frecuentes

**No aparece la barra.** Comprueba que tienes OpenCode 1.18 o superior y que la ruta de
`tui.json` apunta al fichero. Para ver si hay errores al cargar el plugin, arranca con:

```
opencode --print-logs --log-level DEBUG
```

**Sale la barra pero no el uso de OpenCode Go.** El plugin lee la clave de API que guardó
`/connect` (en `~/.local/share/opencode/auth.json`). Si entraste con la cuenta de la
consola en vez de pegando una clave, crea una en
[opencode.ai/console](https://opencode.ai/console) y conéctala con `/connect`, o ponla en
la variable de entorno `OPENCODE_API_KEY`.

## Cómo obtiene el uso

| Proveedor | Consulta |
|-----------|----------|
| OpenCode Go | `GET https://opencode.ai/zen/go/v1/usage`, el mismo endpoint que usa la consola web. No está documentado, así que OpenCode podría cambiarlo. |
| OpenRouter | `GET https://openrouter.ai/api/v1/key` y `GET https://openrouter.ai/api/v1/credits`. |
| Claude | `GET https://api.anthropic.com/api/oauth/usage`, lo mismo que usa Claude Code. |

Las consultas van solo a tu propio proveedor y con tu propia clave. El plugin no envía datos
a ningún otro sitio.

## Licencia

[MIT](LICENSE) © David Daganzo
