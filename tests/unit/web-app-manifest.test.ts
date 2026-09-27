/**
 * What Chrome needs to install ServeFlow as an app rather than as a shortcut.
 *
 * Without a linked manifest, "Add to Home screen" on Android makes a plain shortcut, and a
 * shortcut always opens in a normal Chrome tab. With one that names the app, starts at `/`,
 * asks for `standalone` and offers a 192 and a 512 icon, Chrome installs it and launches it
 * in its own window. These are static files served as-is by Hosting, so the files themselves
 * are what is asserted here.
 *
 * Deliberately NOT here: a service worker. Current Chrome installs without one, and adding
 * one is an offline-support decision this project has not made — see the last block.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose: string
}

const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown> & {
  icons: ManifestIcon[]
}
const html = read('index.html')

/** A PNG's own width and height, from its IHDR chunk — no image library needed for two ints. */
function pngSize(publicPath: string): { width: number; height: number } {
  const bytes = readFileSync(join(root, 'public', publicPath))
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('the manifest', () => {
  it('names the app ServeFlow, in full and on the home screen', () => {
    expect(manifest.name).toBe('ServeFlow')
    expect(manifest.short_name).toBe('ServeFlow')
  })

  it('launches standalone at the root, and keeps every route inside the app', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.id).toBe('/')
  })

  it('leaves orientation to the device, so a tablet can rotate', () => {
    expect(manifest).not.toHaveProperty('orientation')
  })

  it('carries the colours the page itself declares', () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/)
    // The status bar should not change colour between the splash and the loaded page.
    expect(html).toContain(`<meta name="theme-color" content="${String(manifest.theme_color)}" />`)
  })

  it.each([
    ['192x192', 'any', 192],
    ['512x512', 'any', 512],
    ['512x512', 'maskable', 512],
  ])('offers a %s %s PNG that exists at that size', (sizes, purpose, pixels) => {
    const icon = manifest.icons.find((each) => each.sizes === sizes && each.purpose === purpose)
    expect(icon?.type).toBe('image/png')
    expect(icon?.src.startsWith('/')).toBe(true)

    // Hosting serves public/ at the root, so an icon's path is its file under public/.
    expect(pngSize(icon!.src.slice(1))).toEqual({ width: pixels, height: pixels })
  })
})

describe('index.html', () => {
  it('links the manifest from a path Hosting serves as a file, not through the SPA rewrite', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(existsSync(resolve(root, 'public/manifest.webmanifest'))).toBe(true)
  })

  it('gives the browser tab the ServeFlow icon rather than the Vite logo', () => {
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />')

    const favicon = read('public/icons/favicon.svg')
    // The same terracotta square as the app icons, with the S drawn as an outline so the tab
    // does not depend on a font being available when it renders.
    expect(favicon).toContain(`fill="${String(manifest.theme_color)}"`)
    expect(favicon).not.toContain('<text')
    expect(existsSync(resolve(root, 'public/favicon.svg'))).toBe(false)
  })
})

/**
 * No service worker, and so no offline mode.
 *
 * A caching worker would keep serving an old build after a deploy, and taking orders offline
 * needs Firestore's persistent cache first or they are lost when the app closes. Neither is
 * wanted yet; this fails loudly if a worker arrives without that decision being made.
 */
describe('offline support, deliberately absent', () => {
  it('registers no service worker anywhere in the app', () => {
    const sources: string[] = []
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(readFileSync(path, 'utf8'))
      }
    }
    walk(resolve(root, 'src'))

    expect(sources.some((source) => source.includes('serviceWorker'))).toBe(false)
    expect(html).not.toContain('serviceWorker')
  })

  it('ships no worker script', () => {
    const files = readdirSync(resolve(root, 'public'))
    expect(files.filter((name) => /(^sw|worker)\.js$/i.test(name))).toEqual([])
  })
})
