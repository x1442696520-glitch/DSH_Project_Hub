import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const lib = resolve(root, 'lib')
await mkdir(lib, { recursive: true })
const clientModules = [
  'src/client/shared.js',
  'src/client/components.js',
  'src/client/panel.js',
  'src/client.js'
]
const clientBundle = (await Promise.all(clientModules.map((path) => readFile(resolve(root, path), 'utf8')))).join('\n')
await Promise.all([
  copyFile(resolve(root, 'src/host.js'), resolve(lib, 'index.js')),
  cp(resolve(root, 'src/host'), resolve(lib, 'host'), { recursive: true, force: true }),
  copyFile(resolve(root, 'src/wecom-api.js'), resolve(lib, 'wecom-api.js')),
  copyFile(resolve(root, 'src/feishu-api.js'), resolve(lib, 'feishu-api.js')),
  writeFile(resolve(lib, 'client.js'), clientBundle)
])
console.log(`Built ${clientModules.length} client modules and Host modules into lib/`)

