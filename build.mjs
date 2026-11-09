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
const clientDefinitions = await Promise.all(clientModules.map(async (path) => {
  const source = await readFile(resolve(root, path), 'utf8')
  const id = source.match(/^\s*id:\s*(['"])(.*?)\1/m)?.[2]
  const factory = source.match(/\bfactory:\s*(\([^)]*\)\s*=>)\s*\{/)
  const wrapperEnd = source.lastIndexOf('\n  }\n})')
  if (!id || !factory || wrapperEnd < factory.index + factory[0].length) {
    throw new Error(`Invalid client module wrapper: ${path}`)
  }
  const body = source.slice(factory.index + factory[0].length, wrapperEnd)
  return `      ${JSON.stringify(id)}: ${factory[1]} {${body}\n      }`
}))
const clientBundle = `window.__ModuleLoader__.load({
  id: 'dsh-project-hub/client',
  factory: (require) => {
    const factories = {
${clientDefinitions.join(',\n')}
    }
    const cache = Object.create(null)
    const load = (id) => {
      if (!Object.prototype.hasOwnProperty.call(factories, id)) return require(id)
      if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id]
      return (cache[id] = factories[id](load))
    }
    return load('dsh-project-hub/client')
  }
})
`
await Promise.all([
  copyFile(resolve(root, 'src/host.js'), resolve(lib, 'index.js')),
  cp(resolve(root, 'src/host'), resolve(lib, 'host'), { recursive: true, force: true }),
  copyFile(resolve(root, 'src/wecom-api.js'), resolve(lib, 'wecom-api.js')),
  copyFile(resolve(root, 'src/feishu-api.js'), resolve(lib, 'feishu-api.js')),
  writeFile(resolve(lib, 'client.js'), clientBundle)
])
console.log(`Built ${clientModules.length} client modules and Host modules into lib/`)

