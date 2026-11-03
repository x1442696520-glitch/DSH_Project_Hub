import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const lib = resolve(root, 'lib')
await mkdir(lib, { recursive: true })
await Promise.all([
  copyFile(resolve(root, 'src/host.js'), resolve(lib, 'index.js')),
  copyFile(resolve(root, 'src/client.js'), resolve(lib, 'client.js')),
  copyFile(resolve(root, 'src/wecom-api.js'), resolve(lib, 'wecom-api.js')),
  copyFile(resolve(root, 'src/feishu-api.js'), resolve(lib, 'feishu-api.js'))
])
console.log('Built dsh-project-hub into lib/')
