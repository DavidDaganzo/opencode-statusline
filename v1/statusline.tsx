/** @jsxImportSource @opentui/solid */
// Status line para OpenCode (port de la status line de Claude Code).
// Se pinta en el slot `app_bottom` (barra inferior de toda la app).
// https://github.com/DavidDaganzo/opencode-statusline
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type {
    TuiPlugin,
    TuiPluginApi,
    TuiPluginModule,
} from "@opencode-ai/plugin/tui"
import {
    createEffect,
    createMemo,
    createSignal,
    For,
    on,
    onCleanup,
    Show,
} from "solid-js"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const EUR_RATE = 0.92 // €/$ aproximado — editar cuando cambie
const USAGE_POLL_MS = 60000 // cada cuánto se consulta el uso del proveedor

const fmt = (n: number) =>
    n >= 1e6
        ? (n / 1e6).toFixed(1) + "M"
        : n >= 1e3
          ? (n / 1e3).toFixed(1) + "k"
          : String(n)

const usdFmt = (n: number) => "$" + n.toFixed(2)

// Cuenta atrás hasta un instante (ms)
const restante = (ts: number, now: number) => {
    const min = Math.floor((ts - now) / 60000)
    if (min <= 0) return "ya"
    const d = Math.floor(min / 1440)
    const h = Math.floor((min % 1440) / 60)
    const m = min % 60
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
}

// Reinicios de OpenRouter: 00:00 UTC (día), lunes 00:00 UTC (semana),
// día 1 00:00 UTC (mes)
const nextUtcDay = (now: number) => {
    const d = new Date(now)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}
const nextUtcMonday = (now: number) => {
    const d = new Date(now)
    const toMonday = (8 - d.getUTCDay()) % 7 || 7
    return Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + toMonday,
    )
}
const nextUtcMonth = (now: number) => {
    const d = new Date(now)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}
const nextReset = (kind: string | null | undefined, now: number) =>
    kind === "daily"
        ? nextUtcDay(now)
        : kind === "weekly"
          ? nextUtcMonday(now)
          : kind === "monthly"
            ? nextUtcMonth(now)
            : undefined

// ---------------------------------------------------------------------------
// Uso del proveedor
// ---------------------------------------------------------------------------

type OpenRouterUsage = {
    kind: "openrouter"
    credits?: { total: number; used: number }
    limit?: { limit: number; remaining: number; reset?: string | null }
    daily: number
    weekly: number
    monthly: number
    free?: { used: number; limit: number }
}

type AnthropicWindow = { pct: number; resetsAt?: number }
type AnthropicUsage = {
    kind: "anthropic"
    fiveHour?: AnthropicWindow
    sevenDay?: AnthropicWindow
}

// OpenCode Go: tres ventanas (5 h móvil, semanal, mensual) en % del límite
type GoWindow = { pct: number; resetsAt?: number; limited: boolean }
type GoUsage = {
    kind: "opencode-go"
    rolling?: GoWindow
    weekly?: GoWindow
    monthly?: GoWindow
}

type Usage = OpenRouterUsage | AnthropicUsage | GoUsage

type AuthEntry =
    | { type: "api"; key: string }
    | { type: "oauth"; access: string; refresh?: string; expires?: number }

// Credenciales que guarda OpenCode con `opencode auth login`
function readAuth(): Record<string, AuthEntry> {
    const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
    try {
        return JSON.parse(readFileSync(join(base, "opencode", "auth.json"), "utf8"))
    } catch {
        return {}
    }
}

async function getJson(url: string, headers: Record<string, string>) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    return res.json() as Promise<any>
}

async function fetchOpenRouter(key: string): Promise<OpenRouterUsage> {
    const headers = { Authorization: `Bearer ${key}` }
    const [k, c] = await Promise.all([
        getJson("https://openrouter.ai/api/v1/key", headers),
        // Solo responde con claves de cuenta; si falla se omite el saldo
        getJson("https://openrouter.ai/api/v1/credits", headers).catch(
            () => undefined,
        ),
    ])
    const d = k.data ?? {}
    return {
        kind: "openrouter",
        credits: c?.data
            ? { total: c.data.total_credits, used: c.data.total_usage }
            : undefined,
        limit:
            d.limit != null
                ? {
                      limit: d.limit,
                      remaining: d.limit_remaining ?? d.limit - d.usage,
                      reset: d.limit_reset,
                  }
                : undefined,
        daily: d.usage_daily ?? 0,
        weekly: d.usage_weekly ?? 0,
        monthly: d.usage_monthly ?? 0,
        free: d.free_model_daily_requests
            ? {
                  used: d.free_model_daily_requests.used,
                  limit: d.free_model_daily_requests.limit,
              }
            : undefined,
    }
}

// Mismo dato que los `rate_limits` de la status line de Claude Code: solo
// existe con la suscripción de Claude (Pro/Max) conectada por OAuth
async function fetchAnthropic(token: string): Promise<AnthropicUsage> {
    const j = await getJson("https://api.anthropic.com/api/oauth/usage", {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
    })
    const win = (w: any): AnthropicWindow | undefined =>
        w
            ? {
                  pct: Math.round(w.utilization ?? 0),
                  resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined,
              }
            : undefined
    return {
        kind: "anthropic",
        fiveHour: win(j.five_hour),
        sevenDay: win(j.seven_day),
    }
}

// Endpoint de la consola de OpenCode (no documentado, el mismo que usa la
// web): con la clave de API de Go devuelve el uso de la suscripción
async function fetchGo(key: string): Promise<GoUsage> {
    const j = await getJson("https://opencode.ai/zen/go/v1/usage", {
        Authorization: `Bearer ${key}`,
    })
    const win = (w: any): GoWindow | undefined =>
        w
            ? {
                  pct: Math.round(w.percent ?? 0),
                  resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : undefined,
                  limited: w.status === "rate-limited",
              }
            : undefined
    const u = j.usage ?? {}
    return {
        kind: "opencode-go",
        rolling: win(u.rolling),
        weekly: win(u.weekly),
        monthly: win(u.monthly),
    }
}

const apiKey = (e?: AuthEntry) =>
    e?.type === "api" && e.key ? e.key : undefined

async function fetchUsage(): Promise<Usage[]> {
    const auth = readAuth()
    const jobs: Promise<Usage>[] = []

    // La clave de la consola sirve para Zen y para Go; sin suscripción a Go
    // el endpoint responde 403 y simplemente no se pinta
    const goKey =
        apiKey(auth["opencode-go"]) ??
        apiKey(auth.opencode) ??
        process.env.OPENCODE_API_KEY
    if (goKey) jobs.push(fetchGo(goKey))

    const orKey = apiKey(auth.openrouter) ?? process.env.OPENROUTER_API_KEY
    if (orKey) jobs.push(fetchOpenRouter(orKey))

    const an = auth.anthropic
    // Con el token caducado no se pregunta: OpenCode lo renueva al usarlo
    if (an?.type === "oauth" && (!an.expires || an.expires > Date.now()))
        jobs.push(fetchAnthropic(an.access))

    const out = await Promise.allSettled(jobs)
    return out.flatMap(r => (r.status === "fulfilled" ? [r.value] : []))
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

function View(props: { api: TuiPluginApi; usage: () => Usage[] }) {
    const api = props.api
    const theme = () => api.theme.current

    // Reloj para refrescar minutos y cuentas atrás
    const [now, setNow] = createSignal(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30000)
    onCleanup(() => clearInterval(timer))

    const sessionID = createMemo(() => {
        const r = api.route.current
        return r.name === "session"
            ? (r.params as { sessionID: string }).sessionID
            : undefined
    })
    const session = createMemo(() => {
        const id = sessionID()
        return id ? api.state.session.get(id) : undefined
    })
    const assistants = createMemo(() => {
        const id = sessionID()
        if (!id) return []
        return api.state.session
            .messages(id)
            .filter((m): m is AssistantMessage => m.role === "assistant")
    })
    const last = createMemo(() =>
        assistants().findLast(m => m.tokens.output > 0),
    )
    const model = createMemo(() => {
        const l = last()
        if (!l) return undefined
        return api.state.provider.find(p => p.id === l.providerID)?.models[
            l.modelID
        ]
    })

    // Contexto ocupado: tokens del último turno, cache incluida (igual que el
    // sidebar de OpenCode)
    const ctx = createMemo(() => {
        const t = last()?.tokens
        const used = t
            ? t.input + t.output + t.reasoning + t.cache.read + t.cache.write
            : 0
        const size = model()?.limit.context || 200000
        return { used, size, pct: Math.round((used / size) * 100) }
    })

    // Tokens NUEVOS de la sesión. No se cuenta cache.read: son relecturas del
    // contexto en cada turno y dispararían el total.
    const sessionTok = createMemo(() =>
        assistants().reduce(
            (acc, m) =>
                acc +
                m.tokens.input +
                m.tokens.output +
                m.tokens.reasoning +
                m.tokens.cache.write,
            0,
        ),
    )
    const usd = createMemo(
        () =>
            session()?.cost ?? assistants().reduce((a, m) => a + m.cost, 0),
    )
    const mins = createMemo(() => {
        const created = session()?.time.created
        return created ? Math.floor((now() - created) / 60000) : 0
    })
    const onFreeModel = createMemo(() => !!last()?.modelID.endsWith(":free"))
    // Modelo gratuito de OpenCode Zen: tope diario de peticiones por IP que
    // vuelve a 0 a las 00:00 UTC (OpenCode no expone cuántas quedan)
    const onZenFree = createMemo(() => {
        const l = last()
        return l?.providerID === "opencode" && (model()?.cost?.input ?? 0) === 0
    })

    // Verde < 60, amarillo >= 60, rojo >= 85
    const colByPct = (p: number) =>
        p >= 85 ? theme().error : p >= 60 ? theme().warning : theme().success
    const filled = () => Math.min(10, Math.round(ctx().pct / 10))

    const Sep = () => <span style={{ fg: theme().textMuted }}> · </span>
    const Dim = (p: { children: any }) => (
        <span style={{ fg: theme().textMuted }}>{p.children}</span>
    )
    const Pct = (p: { value: number }) => (
        <span style={{ fg: colByPct(p.value) }}>{p.value}%</span>
    )
    const Reset = (p: { at?: number }) => (
        <Show when={p.at}>
            {at => <Dim> ({restante(at(), now())})</Dim>}
        </Show>
    )

    const OpenRouterView = (p: { u: OpenRouterUsage }) => {
        const creditPct = () =>
            p.u.credits && p.u.credits.total > 0
                ? Math.round((p.u.credits.used / p.u.credits.total) * 100)
                : undefined
        const limitPct = () =>
            p.u.limit && p.u.limit.limit > 0
                ? Math.round(
                      ((p.u.limit.limit - p.u.limit.remaining) /
                          p.u.limit.limit) *
                          100,
                  )
                : undefined
        return (
            <>
                <Show when={p.u.credits}>
                    {c => (
                        <>
                            <Sep />
                            <Dim>💳 </Dim>
                            {usdFmt(c().used)}
                            <Dim>/{usdFmt(c().total)} </Dim>
                            <Pct value={creditPct() ?? 0} />
                        </>
                    )}
                </Show>
                <Show when={p.u.limit}>
                    {l => (
                        <>
                            <Sep />
                            <Dim>límite </Dim>
                            <Pct value={limitPct() ?? 0} />
                            <Dim> {usdFmt(l().remaining)} libres</Dim>
                            <Reset at={nextReset(l().reset, now())} />
                        </>
                    )}
                </Show>
                <Sep />
                <Dim>hoy </Dim>
                {usdFmt(p.u.daily)}
                <Reset at={nextUtcDay(now())} />
                <Sep />
                <Dim>sem </Dim>
                {usdFmt(p.u.weekly)}
                <Reset at={nextUtcMonday(now())} />
                <Sep />
                <Dim>mes </Dim>
                {usdFmt(p.u.monthly)}
                <Reset at={nextUtcMonth(now())} />
                <Show when={onFreeModel() && p.u.free}>
                    {f => (
                        <>
                            <Sep />
                            <Dim>gratis </Dim>
                            <Pct
                                value={Math.round(
                                    (f().used / Math.max(1, f().limit)) * 100,
                                )}
                            />
                            <Dim>
                                {" "}
                                {f().used}/{f().limit}
                            </Dim>
                            <Reset at={nextUtcDay(now())} />
                        </>
                    )}
                </Show>
            </>
        )
    }

    const AnthropicView = (p: { u: AnthropicUsage }) => (
        <>
            <Show when={p.u.fiveHour}>
                {w => (
                    <>
                        <Sep />
                        <Dim>5h </Dim>
                        <Pct value={w().pct} />
                        <Reset at={w().resetsAt} />
                    </>
                )}
            </Show>
            <Show when={p.u.sevenDay}>
                {w => (
                    <>
                        <Sep />
                        <Dim>sem </Dim>
                        <Pct value={w().pct} />
                        <Reset at={w().resetsAt} />
                    </>
                )}
            </Show>
        </>
    )

    const GoView = (p: { u: GoUsage }) => {
        const Win = (w: { label: string; win?: GoWindow }) => (
            <Show when={w.win}>
                {x => (
                    <>
                        <Sep />
                        <Dim>{w.label} </Dim>
                        <Pct value={x().pct} />
                        <Show when={x().limited}>
                            <span style={{ fg: theme().error }}> ⛔</span>
                        </Show>
                        <Reset at={x().resetsAt} />
                    </>
                )}
            </Show>
        )
        return (
            <>
                <Win label="5h" win={p.u.rolling} />
                <Win label="sem" win={p.u.weekly} />
                <Win label="mes" win={p.u.monthly} />
            </>
        )
    }

    // Uso del proveedor del modelo en curso; en la pantalla de inicio, todos
    const usageShown = createMemo(() => {
        const provider = last()?.providerID
        const all = props.usage()
        if (!provider) return all
        const own = all.filter(u => u.kind === provider)
        return own.length ? own : all
    })

    return (
        <box width="100%" paddingLeft={2} paddingRight={2} flexShrink={0}>
            <text fg={theme().text} wrapMode="none">
                <Show
                    when={sessionID()}
                    fallback={<span style={{ fg: theme().primary }}>uso</span>}
                >
                    <span style={{ fg: theme().primary }}>
                        <b>{model()?.name ?? last()?.modelID ?? "—"}</b>
                    </span>
                    <Sep />
                    <span style={{ fg: colByPct(ctx().pct) }}>
                        {"▓".repeat(filled())}
                    </span>
                    <Dim>{"░".repeat(10 - filled())}</Dim>{" "}
                    <Pct value={ctx().pct} />{" "}
                    <Dim>
                        {fmt(ctx().used)}/{fmt(ctx().size)}
                    </Dim>
                    <Sep />
                    <Dim>💬 </Dim>
                    {fmt(sessionTok())}
                    <Sep />
                    <Dim>💶 </Dim>
                    <span style={{ fg: theme().success }}>
                        {usdFmt(usd())}
                    </span>{" "}
                    <Dim>~€{(usd() * EUR_RATE).toFixed(2)}</Dim>
                    <Sep />
                    <Dim>⏱ {mins()}m</Dim>
                </Show>
                <Show
                    when={onZenFree()}
                    fallback={
                        <For each={usageShown()}>
                            {u =>
                                u.kind === "openrouter" ? (
                                    <OpenRouterView u={u} />
                                ) : u.kind === "opencode-go" ? (
                                    <GoView u={u} />
                                ) : (
                                    <AnthropicView u={u} />
                                )
                            }
                        </For>
                    }
                >
                    <Sep />
                    <Dim>gratis · se reinicia</Dim>
                    <Reset at={nextUtcDay(now())} />
                </Show>
            </text>
        </box>
    )
}

const tui: TuiPlugin = async api => {
    const [usage, setUsage] = createSignal<Usage[]>([])
    let busy = false
    const refresh = async () => {
        if (busy) return
        busy = true
        try {
            setUsage(await fetchUsage())
        } catch {
            // sin red o sin credenciales: se mantiene el último dato
        } finally {
            busy = false
        }
    }
    refresh()
    const poll = setInterval(refresh, USAGE_POLL_MS)
    api.lifecycle.onDispose(() => clearInterval(poll))

    api.slots.register({
        order: 100,
        slots: {
            app_bottom() {
                // Al terminar cada respuesta se vuelve a consultar el uso
                createEffect(
                    on(
                        () => {
                            const r = api.route.current
                            if (r.name !== "session") return undefined
                            const id = (r.params as { sessionID: string })
                                .sessionID
                            const msgs = api.state.session.messages(id)
                            const l = msgs.findLast(m => m.role === "assistant")
                            return l?.time.completed
                        },
                        done => {
                            if (done) setTimeout(refresh, 3000)
                        },
                        { defer: true },
                    ),
                )
                return <View api={api} usage={usage} />
            },
        },
    })
}

const plugin: TuiPluginModule & { id: string } = {
    id: "daviddaganzo.statusline",
    tui,
}

export default plugin
