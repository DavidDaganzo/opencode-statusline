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

**OpenCode 2.x** (probado con la 2.1.2). Para ver tu versión:

```
opencode --version
```

¿Sigues en OpenCode 1.x? Usa la versión de la carpeta [`v1/`](v1) (ver
[Instalación en OpenCode 1.x](#instalación-en-opencode-1x)).

No hace falta instalar Node ni ninguna dependencia: OpenCode ya trae todo lo que usa el
plugin.

## Instalación

OpenCode carga solo los plugins que encuentra en `plugins/<nombre>/tui.tsx` dentro de su
carpeta de configuración. No hay que tocar ningún fichero de configuración.

### Opción A: con git (recomendada, así se actualiza con `git pull`)

```powershell
# Windows (PowerShell)
git clone https://github.com/DavidDaganzo/opencode-statusline.git "$HOME\.config\opencode\plugins\statusline"
```

```bash
# Mac / Linux / Git Bash
git clone https://github.com/DavidDaganzo/opencode-statusline.git ~/.config/opencode/plugins/statusline
```

### Opción B: sin git

1. Descarga [`tui.tsx`](tui.tsx) (botón **Download raw file** en GitHub).
2. Crea la carpeta `plugins\statusline` dentro de la configuración de OpenCode y pon ahí
   el fichero, **con el nombre `tui.tsx`**:
   - **Windows:** `C:\Users\TU_USUARIO\.config\opencode\plugins\statusline\tui.tsx`
   - **Mac / Linux:** `~/.config/opencode/plugins/statusline/tui.tsx`

### Reiniciar OpenCode

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

- **Con git:** `git pull` dentro de `~/.config/opencode/plugins/statusline` y reinicia
  OpenCode.
- **Sin git:** descarga de nuevo `tui.tsx` encima del anterior y reinicia OpenCode.

## Personalizar

Al principio de `tui.tsx`:

- `EUR_RATE`: cambio de dólares a euros (por defecto `0.92`).
- `USAGE_POLL_MS`: cada cuánto se consulta el uso del plan (por defecto, 60 000 ms).
- Los umbrales de color están en la función `colByPct`.

## Desactivarlo

Sin borrar nada, en `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["*", "-daviddaganzo.statusline"]
}
```

Para quitarlo del todo, borra la carpeta `~/.config/opencode/plugins/statusline`.

## Problemas frecuentes

**No aparece la barra.**
- Comprueba que tienes OpenCode 2.x (`opencode --version`).
- Comprueba que el fichero se llama exactamente `tui.tsx` y está en
  `plugins/statusline/`, no directamente en `plugins/`.
- Para ver si el plugin se carga, arranca con logs y busca `daviddaganzo.statusline`:

  ```
  opencode --print-logs --log-level debug
  ```

**Sale la barra pero no el uso de OpenCode Go.** El plugin usa la clave de API que guardó
`/connect` (puedes verla con `opencode auth list`). Si entraste con la cuenta de la consola
en vez de pegando una clave, crea una en [opencode.ai/console](https://opencode.ai/console)
y conéctala con `/connect`, o ponla en la variable de entorno `OPENCODE_API_KEY`.

## Instalación en OpenCode 1.x

La API de plugins cambió por completo en OpenCode 2.0, así que para la 1.x (1.18 o
superior) está la versión de la carpeta [`v1/`](v1):

1. Copia [`v1/statusline.tsx`](v1/statusline.tsx) a
   `~/.config/opencode/tui-plugins/statusline.tsx`. **No** a `plugins/`: en 1.x esa carpeta
   se carga como plugins de servidor.
2. Añádelo a `~/.config/opencode/tui.json` (o copia [`v1/tui.json`](v1/tui.json) si no
   tienes ese fichero):

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["./tui-plugins/statusline.tsx"]
   }
   ```

3. Reinicia OpenCode.

Al pasar a la 2.x, borra `tui-plugins/statusline.tsx` e instala la versión nueva como se
explica arriba.

## Cómo obtiene el uso

| Proveedor | Consulta |
|-----------|----------|
| OpenCode Go | `GET https://opencode.ai/zen/go/v1/usage`, el mismo endpoint que usa la consola web. No está documentado, así que OpenCode podría cambiarlo. |
| OpenRouter | `GET https://openrouter.ai/api/v1/key` y `GET https://openrouter.ai/api/v1/credits`. |
| Claude | `GET https://api.anthropic.com/api/oauth/usage`, lo mismo que usa Claude Code. |

La clave se pide al propio OpenCode (`credential.list` del cliente), así que también
funciona si OpenCode se conecta a un servidor remoto. Las consultas van solo a tu propio
proveedor y con tu propia clave. El plugin no envía datos a ningún otro sitio.

## Licencia

[MIT](LICENSE) © David Daganzo
