import http from 'node:http'

const MAX_BODY = 1 << 20

/**
 * Hook script POSTs Claude's hook stdin JSON as the body, with extra headers:
 *   X-Hook-Event, X-Tilix-Id, X-Claude-Pid
 */
export function startServer(store, onChange, port = 47800) {
    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/sessions') {
            res.writeHead(200, { 'content-type': 'application/json' })
            return res.end(JSON.stringify(store.list()))
        }
        if (req.method !== 'POST' || req.url !== '/event') {
            res.writeHead(404)
            return res.end()
        }
        let body = ''
        req.setEncoding('utf8')
        req.on('data', chunk => {
            body += chunk
            if (body.length > MAX_BODY) req.destroy()
        })
        req.on('end', () => {
            let data
            try {
                data = body.trim() ? JSON.parse(body) : {}
            } catch {
                res.writeHead(400)
                return res.end()
            }
            const pid = parseInt(req.headers['x-claude-pid'], 10)
            const evt = {
                event: data.hook_event_name || req.headers['x-hook-event'],
                session_id: data.session_id,
                cwd: data.cwd,
                tilix_id: req.headers['x-tilix-id'] || null,
                pid: Number.isFinite(pid) && pid > 1 ? pid : null,
                agent: req.headers['x-agent'] === 'codex' ? 'codex' : 'claude',
            }
            if (store.applyEvent(evt)) onChange()
            res.writeHead(204)
            res.end()
        })
    })
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => resolve(server))
    })
}
