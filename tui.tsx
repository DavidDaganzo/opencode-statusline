/** @jsxImportSource @opentui/solid */
// Status line para OpenCode 2.x (port de la status line de Claude Code).
// Se pinta en el slot `app` (barra inferior de toda la app).
// Para OpenCode 1.x, usar v1/statusline.tsx.
// https://github.com/DavidDaganzo/opencode-statusline
import { Plugin } from "@opencode/plugin/tui"
import type {
    CredentialEntry,
    ModelInfo,
    SessionMessageAssistant,
    SessionMessageInfo,
} from "@opencode/client"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"

type Context = Plugin.Context

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

// Reinicios de OpenRouter y del tope gratuito de OpenCode: 00:00 UTC (día),
// lunes 00:00 UTC (semana), día 1 00:00 UTC (mes)
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

type Window = { pct: number; resetsAt?: number; limited?: boolean }

type AnthropicUsage = {
    kind: "anthropic"
    fiveHour?: Window
    sevenDay?: Window
}

// OpenCode Go: tres ventanas (5 h móvil, semanal, mensual) en % del límite
type GoUsage = {
    kind: "opencode-go"
    rolling?: Window
    weekly?: Window
    monthly?: Window
}

type Usage = OpenRouterUsage | AnthropicUsage | GoUsage

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
    const win = (w: any): Window | undefined =>
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
    const win = (w: any): Window | undefined =>
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

// Credenciales que guardó `/connect` (o `opencode auth`) en el servidor de
// OpenCode. Se piden por el cliente, así que también vale con un servidor remoto
async function readCredentials(context: Context) {
    const list: CredentialEntry[] = await context.client.credential
        .list()
        .catch(() => [])
    const active = (id: string) =>
        list.find(c => c.integrationID === id && c.active) ??
        list.find(c => c.integrationID === id)
    const key = (id: string) => {
        const v = active(id)?.value
        return v?.type === "key" ? v.key : undefined
    }
    const oauth = (id: string) => {
        const v = active(id)?.value
        return v?.type === "oauth" ? v : undefined
    }
    return { key, oauth }
}

async function fetchUsage(context: Context): Promise<Usage[]> {
    const cred = await readCredentials(context)
    const jobs: Promise<Usage>[] = []

    // La clave de la consola sirve para Zen y para Go; sin suscripción a Go
    // el endpoint responde 403 y simplemente no se pinta
    const goKey =
        cred.key("opencode-go") ??
        cred.key("opencode") ??
        process.env.OPENCODE_API_KEY
    if (goKey) jobs.push(fetchGo(goKey))

    const orKey = cred.key("openrouter") ?? process.env.OPENROUTER_API_KEY
    if (orKey) jobs.push(fetchOpenRouter(orKey))

    const an = cred.oauth("anthropic")
    // Con el token caducado no se pregunta: OpenCode lo renueva al usarlo
    if (an && (!an.expires || an.expires > Date.now()))
        jobs.push(fetchAnthropic(an.access))

    const out = await Promise.allSettled(jobs)
    return out.flatMap(r => (r.status === "fulfilled" ? [r.value] : []))
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

const isAssistant = (m: SessionMessageInfo): m is SessionMessageAssistant =>
    m.type === "assistant"

function View(props: { context: Context; usage: () => Usage[] }) {
    const context = props.context
    const theme = () => context.theme

    // Reloj para refrescar minutos y cuentas atrás
    const [now, setNow] = createSignal(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30000)
    onCleanup(() => clearInterval(timer))

    const sessionID = createMemo(() => {
        const r = context.ui.router.current()
        return r.type === "session" ? r.sessionID : undefined
    })
    const session = createMemo(() => {
        const id = sessionID()
        return id ? context.data.session.get(id) : undefined
    })
    const assistants = createMemo(() => {
        const id = sessionID()
        if (!id) return []
        return context.data.session.message.list(id).filter(isAssistant)
    })
    const last = createMemo(() =>
        assistants().findLast(m => (m.tokens?.output ?? 0) > 0),
    )
    const model = createMemo((): ModelInfo | undefined => {
        const ref = last()?.model ?? session()?.model
        if (!ref) return undefined
        return context.data.location.model
            .list(session()?.location)
            ?.find(m => m.providerID === ref.providerID && m.id === ref.id)
    })

    // Contexto ocupado: tokens del último turno, cache incluida (igual que el
    // pie de la sesión de OpenCode)
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
        assistants().reduce((acc, m) => {
            const t = m.tokens
            return t
                ? acc + t.input + t.output + t.reasoning + t.cache.write
                : acc
        }, 0),
    )
    const usd = createMemo(() => {
        const id = sessionID()
        return id ? context.data.session.cost(id) : 0
    })
    const mins = createMemo(() => {
        const created = session()?.time.created
        return created ? Math.floor((now() - created) / 60000) : 0
    })
    const providerID = createMemo(
        () => last()?.model.providerID ?? session()?.model?.providerID,
    )
    const onFreeModel = createMemo(() => !!last()?.model.id.endsWith(":free"))
    // Modelo gratuito de OpenCode Zen: tope diario de peticiones por IP que
    // vuelve a 0 a las 00:00 UTC (OpenCode no expone cuántas quedan)
    const onZenFree = createMemo(
        () =>
            providerID() === "opencode" &&
            (model()?.cost ?? []).every(c => c.input === 0 && c.output === 0),
    )

    // Verde < 60, amarillo >= 60, rojo >= 85
    const colByPct = (p: number) =>
        p >= 85
            ? theme().text.feedback.error.base
            : p >= 60
              ? theme().text.feedback.warning.base
              : theme().text.feedback.success.base
    const filled = () => Math.min(10, Math.round(ctx().pct / 10))

    const Sep = () => <span style={{ fg: theme().text.muted }}> · </span>
    const Dim = (p: { children: any }) => (
        <span style={{ fg: theme().text.muted }}>{p.children}</span>
    )
    const Pct = (p: { value: number }) => (
        <span style={{ fg: colByPct(p.value) }}>{p.value}%</span>
    )
    const Reset = (p: { at?: number }) => (
        <Show when={p.at}>
            {at => <Dim> ({restante(at(), now())})</Dim>}
        </Show>
    )
    const Win = (p: { label: string; win?: Window }) => (
        <Show when={p.win}>
            {w => (
                <>
                    <Sep />
                    <Dim>{p.label} </Dim>
                    <Pct value={w().pct} />
                    <Show when={w().limited}>
                        <span style={{ fg: theme().text.feedback.error.base }}>
                            {" "}
                            ⛔
                        </span>
                    </Show>
                    <Reset at={w().resetsAt} />
                </>
            )}
        </Show>
    )

    const OpenRouterView = (p: { u: OpenRouterUsage }) => {
        const creditPct = () =>
            p.u.credits && p.u.credits.total > 0
                ? Math.round((p.u.credits.used / p.u.credits.total) * 100)
                : 0
        const limitPct = () =>
            p.u.limit && p.u.limit.limit > 0
                ? Math.round(
                      ((p.u.limit.limit - p.u.limit.remaining) /
                          p.u.limit.limit) *
                          100,
                  )
                : 0
        return (
            <>
                <Show when={p.u.credits}>
                    {c => (
                        <>
                            <Sep />
                            <Dim>💳 </Dim>
                            {usdFmt(c().used)}
                            <Dim>/{usdFmt(c().total)} </Dim>
                            <Pct value={creditPct()} />
                        </>
                    )}
                </Show>
                <Show when={p.u.limit}>
                    {l => (
                        <>
                            <Sep />
                            <Dim>límite </Dim>
                            <Pct value={limitPct()} />
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

    // Uso del proveedor del modelo en curso; en la pantalla de inicio, todos
    const usageShown = createMemo(() => {
        const provider = providerID()
        const all = props.usage()
        if (!provider) return all
        const own = all.filter(u => u.kind === provider)
        return own.length ? own : all
    })

    return (
        <box width="100%" paddingLeft={2} paddingRight={2} flexShrink={0}>
            <text fg={theme().text.base} wrapMode="none">
                <Show
                    when={sessionID()}
                    fallback={
                        <span style={{ fg: theme().text.action.primary.base }}>
                            uso
                        </span>
                    }
                >
                    <span style={{ fg: theme().text.action.primary.base }}>
                        <b>{model()?.name ?? last()?.model.id ?? "—"}</b>
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
                    <span style={{ fg: theme().text.feedback.success.base }}>
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
                                    <>
                                        <Win label="5h" win={u.rolling} />
                                        <Win label="sem" win={u.weekly} />
                                        <Win label="mes" win={u.monthly} />
                                    </>
                                ) : (
                                    <>
                                        <Win label="5h" win={u.fiveHour} />
                                        <Win label="sem" win={u.sevenDay} />
                                    </>
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

export default Plugin.define({
    id: "daviddaganzo.statusline",
    setup(context) {
        const [usage, setUsage] = createSignal<Usage[]>([])
        let busy = false
        const refresh = async () => {
            if (busy) return
            busy = true
            try {
                setUsage(await fetchUsage(context))
            } catch {
                // sin red o sin credenciales: se mantiene el último dato
            } finally {
                busy = false
            }
        }
        refresh()
        const poll = setInterval(refresh, USAGE_POLL_MS)
        // Al terminar cada respuesta se vuelve a consultar el uso
        const stop = context.data.on("session.execution.succeeded", () => {
            setTimeout(refresh, 3000)
        })

        const unslot = context.ui.slot({
            append: "app",
            render: () => <View context={context} usage={usage} />,
        })

        return () => {
            clearInterval(poll)
            stop()
            unslot()
        }
    },
})
