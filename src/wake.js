// After the PC sleeps, the Loupedeck stays enumerated on USB, so the serial
// port never reports a disconnect — but the device has dropped its session and
// ignores everything we send. We spot the resume and reconnect from scratch.

/**
 * Calls `onResume(gapMs)` when the wall clock jumps forward much further than
 * the timer interval — which is what a suspend/resume looks like from inside
 * a process (timers are paused while asleep, the wall clock is not).
 */
export function watchForResume(onResume, { intervalMs = 2000, thresholdMs = 10_000, now = Date.now, setTimer = setInterval } = {}) {
    let last = now()
    return setTimer(() => {
        const t = now()
        const gap = t - last
        last = t
        if (gap > intervalMs + thresholdMs) onResume(gap)
    }, intervalMs)
}

const withTimeout = (promise, ms, what) => Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms).unref?.()),
])

/**
 * Closes the device and reconnects, retrying until the handshake succeeds.
 * Returns a function; calls while a reconnect is already running are ignored.
 */
export function makeReconnector(device, { log = () => {}, timeoutMs = 5000, retryMs = 3000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    let running = false
    return async function reconnect(reason) {
        if (running) return
        running = true
        log(`reconnecting Loupedeck (${reason})`)
        try {
            for (let attempt = 1; ; attempt++) {
                try { await withTimeout(device.close(), timeoutMs, 'close') } catch {}
                // The library schedules its own retry on some failures; we drive retries here.
                clearTimeout(device._reconnectTimer)
                try {
                    await withTimeout(device.connect(), timeoutMs, 'connect')
                    return
                } catch (e) {
                    clearTimeout(device._reconnectTimer)
                    log(`reconnect attempt ${attempt} failed: ${e?.message ?? e}`)
                    await sleep(retryMs)
                }
            }
        } finally {
            running = false
        }
    }
}
