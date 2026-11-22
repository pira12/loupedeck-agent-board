import { execFile } from 'node:child_process'

const UUID = /^[0-9a-f-]{36}$/i

export function focusArgs(tilixId) {
    return [
        'call', '--session', '--dest', 'com.gexperts.Tilix',
        '--object-path', '/com/gexperts/Tilix',
        '--method', 'org.gtk.Actions.Activate',
        'activate-terminal', `[<'${tilixId}'>]`, '{}',
    ]
}

/** Ask Tilix to focus the terminal with this TILIX_ID. Resolves true on success. */
export function focusTerminal(tilixId, exec = execFile) {
    if (!tilixId || !UUID.test(tilixId)) return Promise.resolve(false)
    return new Promise(resolve => {
        exec('gdbus', focusArgs(tilixId), { timeout: 2000 }, err => resolve(!err))
    })
}
