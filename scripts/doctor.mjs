import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const checks = []

function report(status, label, detail) {
  checks.push({ status, label, detail })
  const marker = status === 'PASS' ? '✓' : status === 'WARN' ? '!' : '✗'
  console.log(`${marker} ${label}: ${detail}`)
}

const nodeVersion = process.versions.node
const nodeMajor = Number.parseInt(nodeVersion.split('.')[0], 10)
report(nodeMajor >= 20 ? 'PASS' : 'FAIL', 'Node.js', `当前 ${nodeVersion}；要求 ${manifest.engines?.node || '>=20'}`)

for (const moduleName of Object.keys(manifest.dependencies || {})) {
  try {
    await import(moduleName)
    report('PASS', `依赖 ${moduleName}`, '已安装并可加载')
  } catch (error) {
    report('FAIL', `依赖 ${moduleName}`, `加载失败（${error?.code || error?.name || '未知错误'}）；请在插件目录运行 pnpm install --frozen-lockfile`)
  }
}

for (const peerName of Object.keys(manifest.peerDependencies || {})) {
  try {
    import.meta.resolve(peerName)
    report('PASS', `Host API ${peerName}`, '在当前运行环境中可解析')
  } catch {
    report('WARN', `Host API ${peerName}`, '当前目录无法解析；请确认插件由兼容版本的 DSH Host 加载')
  }
}

for (const relativePath of ['lib/index.js', 'lib/client.js', 'lib/host/shared.js', 'lib/host/routes.js', 'lib/wecom-api.js', 'lib/feishu-api.js']) {
  try {
    await access(path.join(root, relativePath))
    report('PASS', `构建文件 ${relativePath}`, '存在')
  } catch {
    report('FAIL', `构建文件 ${relativePath}`, '不存在；请先运行 pnpm run build')
  }
}

const failures = checks.filter((check) => check.status === 'FAIL').length
const warnings = checks.filter((check) => check.status === 'WARN').length
console.log(`\n自检结束：${failures} 项需修复，${warnings} 项提醒。`)
if (failures) process.exitCode = 1
