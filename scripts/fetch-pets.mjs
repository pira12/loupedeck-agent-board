#!/usr/bin/env node
// Downloads the built-in "Codex" terminal pet from OpenAI's public CDN and converts it to PNG.
// The artwork belongs to OpenAI, so it is fetched at install time instead of being committed.
// Usage: node scripts/fetch-pets.mjs [--force]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const PETS = { codex: 'https://persistent.oaistatic.com/codex/pets/v1/codex-spritesheet-v4.webp' }
const dir = new URL('../assets/pets/', import.meta.url).pathname
const force = process.argv.includes('--force')

fs.mkdirSync(dir, { recursive: true })
for (const [name, url] of Object.entries(PETS)) {
    const out = path.join(dir, `${name}.png`)
    if (fs.existsSync(out) && !force) {
        console.log(`${name}: already present`)
        continue
    }
    try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const webp = Buffer.from(await res.arrayBuffer())
        const { width, height } = await sharp(webp).metadata()
        if (width !== 1536 || ![1872, 2288].includes(height)) throw new Error(`unexpected sprite sheet size ${width}x${height}`)
        await sharp(webp).png().toFile(out)
        console.log(`${name}: downloaded (${width}x${height})`)
    } catch (e) {
        console.warn(`${name}: could not download (${e.message}). Codex sessions will use the Claude mascot until you rerun: node scripts/fetch-pets.mjs`)
    }
}
process.exitCode = 0 // never fail the install over artwork
