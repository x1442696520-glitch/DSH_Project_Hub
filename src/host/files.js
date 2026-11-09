export function createFilesMethods(shared) {
  const { ROOT, PROJECT_FILE, TASKS_DIR, PROJECT_FILES_DIR, PROJECT_ID, BRIDGE_JOURNAL_FILE, INBOUND_FILE_CONFIRM_TTL_MS, PROJECT_FILE_WRITE_SCRIPT, PROJECT_FILE_WRITE_PWSH_SCRIPT, fail, sanitizeInboundFilename } = shared
  return {
  async target(relativePath, workspaceRoot = this.root) {
    const root = await this.ctx.fs.resolve(workspaceRoot)
    const target = await this.ctx.fs.resolve(relativePath, { cwd: workspaceRoot })
    if (!this.ctx.fs.contains(root, target)) fail('文件目标超出所属 DSH 工作区，拒绝访问', 403)
    return target
  },

  async assertEntryType(relativePath, expectedType, workspaceRoot, { optional = false, signal } = {}) {
    const entry = await this.ctx.fs.lstat(relativePath, { cwd: workspaceRoot }, signal)
    if (!entry && optional) return undefined
    if (!entry || entry.type !== expectedType) fail(`项目路径类型无效或包含符号链接：${relativePath}`, 403)
    return entry
  },

  async assertProjectPath(relativePath, workspaceRoot, signal) {
    if (relativePath === BRIDGE_JOURNAL_FILE) {
      await this.assertEntryType(relativePath, 'file', workspaceRoot, { optional: true, signal })
      return
    }
    if (relativePath === PROJECT_FILE) {
      await this.assertEntryType(PROJECT_FILE, 'file', workspaceRoot, { optional: true, signal })
      return
    }
    const taskMatch = new RegExp(`^${TASKS_DIR}/(t-[a-z0-9-]{4,80}\\.md)$`).exec(relativePath)
    if (relativePath === TASKS_DIR || taskMatch) {
      await this.assertEntryType(TASKS_DIR, 'directory', workspaceRoot, { optional: true, signal })
      if (taskMatch) await this.assertEntryType(relativePath, 'file', workspaceRoot, { optional: true, signal })
      return
    }
    const legacy = new RegExp(`^${ROOT}/(p-[a-z0-9-]{4,80})(?:/(tasks)(?:/t-[a-z0-9-]{4,80}\\.md)?|/PROJECT\\.md)?$`).exec(relativePath)
    if (!legacy) fail('项目路径不在允许的 Workspace 根目录结构中', 403)
    await this.assertEntryType(ROOT, 'directory', workspaceRoot, { optional: true, signal })
    await this.assertEntryType(`${ROOT}/${legacy[1]}`, 'directory', workspaceRoot, { optional: true, signal })
    if (legacy[2]) await this.assertEntryType(`${ROOT}/${legacy[1]}/tasks`, 'directory', workspaceRoot, { optional: true, signal })
    if (relativePath.endsWith('.md')) await this.assertEntryType(relativePath, 'file', workspaceRoot, { optional: true, signal })
  },

  projectFilesPath(projectId, path = '') {
    if (!PROJECT_ID.test(projectId)) fail('项目 ID 无效')
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) fail('项目文件路径必须是 Workspace 根目录 files 内的相对路径', 403)
    const segments = path === '' ? [] : path.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment))) fail('项目文件路径包含无效目录名', 403)
    return segments.length ? `${PROJECT_FILES_DIR}/${segments.join('/')}` : PROJECT_FILES_DIR
  },

  async assertProjectFilesPath(projectId, path, workspaceRoot, expectedType, signal) {
    const relativePath = this.projectFilesPath(projectId, path)
    await this.assertEntryType(PROJECT_FILES_DIR, 'directory', workspaceRoot, { signal })
    let current = PROJECT_FILES_DIR
    const segments = path === '' ? [] : path.split('/')
    for (let index = 0; index < segments.length; index += 1) {
      current += `/${segments[index]}`
      const type = index < segments.length - 1 ? 'directory' : expectedType
      await this.assertEntryType(current, type, workspaceRoot, { signal })
    }
    return relativePath
  },

  async readFile(relativePath, signal, workspaceRoot = this.root) {
    await this.assertProjectPath(relativePath, workspaceRoot, signal)
    const target = await this.target(relativePath, workspaceRoot)
    return this.ctx.fs.readText(target, signal)
  },

  async writeFile(relativePath, content, signal, workspaceRoot = this.root, sandboxPolicy) {
    await this.assertProjectPath(relativePath, workspaceRoot, signal)
    const target = await this.target(relativePath, workspaceRoot)
    const current = await this.ctx.fs.stat(target, signal)
    if (current) {
      return this.ctx.fs.writeText(target, content, { kind: 'replaceIfVersion', version: current.version }, signal, sandboxPolicy)
    }
    return this.ctx.fs.writeText(target, content, { kind: 'createIfAbsent' }, signal, sandboxPolicy)
  },

  async findProjectFileCollision(workspaceRoot, filename) {
    const directory = await this.ctx.fs.lstat(PROJECT_FILES_DIR, { cwd: workspaceRoot })
    if (!directory) return null
    if (directory.type !== 'directory') fail('项目 files 路径不是安全目录，拒绝写入', 403)
    const directoryTarget = await this.target(PROJECT_FILES_DIR, workspaceRoot)
    let entries = []
    try { entries = await this.ctx.fs.listDir(directoryTarget) }
    catch (error) { if (error?.code !== 'FS_NOT_FOUND' && error?.code !== 'ENOENT') throw error }
    const match = entries.find((entry) => entry.name.toLocaleLowerCase() === filename.toLocaleLowerCase())
    if (!match) return null
    const relativePath = `${PROJECT_FILES_DIR}/${match.name}`
    const info = await this.ctx.fs.lstat(relativePath, { cwd: workspaceRoot })
    if (!info || info.type === 'symlink') fail('同名项目路径不是普通文件，拒绝覆盖', 403)
    if (info.type !== 'file') fail('files 目录中存在同名目录，无法保存该文件', 409)
    return { filename: match.name, relativePath, info }
  },

  async writeInboundProjectFile({ workspace, session, filename, bytes, overwrite = false }) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) fail('收到的文件为空或格式无效')
    const safeName = sanitizeInboundFilename(filename)
    let collision = await this.findProjectFileCollision(workspace.path, safeName)
    if (collision && !overwrite) return { conflict: true, filename: collision.filename }
    const finalName = collision?.filename || safeName
    const relativePath = `${PROJECT_FILES_DIR}/${finalName}`
    const target = await this.target(relativePath, workspace.path)
    const targetPath = this.ctx.fs.processPath(target)
    const workspaceTarget = await this.ctx.fs.resolve(workspace.path)
    const workdir = this.ctx.fs.processPath(workspaceTarget)
    const sandboxPolicy = this.ctx.sandboxPolicy.resolve({ session })
    if (sandboxPolicy.mode === 'read-only') {
      const error = new Error('项目助手会话处于只读沙箱，不能保存入站文件')
      error.code = 'SANDBOX_READ_ONLY'
      throw error
    }
    if (sandboxPolicy.mode === 'workspace-write') {
      let policyRoot
      try { policyRoot = await this.ctx.fs.resolve(sandboxPolicy.workspaceRoot) }
      catch {
        const error = new Error('无法解析项目助手会话的沙箱工作区根目录')
        error.code = 'SANDBOX_ROOT_UNRESOLVED'
        throw error
      }
      if (!this.ctx.fs.contains(policyRoot, target)) {
        const error = new Error('目标文件不在项目助手会话允许写入的沙箱根目录中')
        error.code = 'SANDBOX_ROOT_MISMATCH'
        throw error
      }
    }
    if (!this.ctx.shell || typeof this.ctx.shell.resolve !== 'function' || typeof this.ctx.shell.execute !== 'function') fail('DSH 安全 Shell 写入服务不可用', 503)
    const isWindows = globalThis.process?.platform === 'win32'
    const command = isWindows ? PROJECT_FILE_WRITE_PWSH_SCRIPT : `"$PROJECT_HUB_NODE" -e '${PROJECT_FILE_WRITE_SCRIPT}'`
    const spec = this.ctx.shell.resolve({
      command,
      workdir,
      timeoutMs: 60_000,
      stdoutMaxBytes: 1024,
      stdin: Buffer.from(bytes).toString('base64'),
      env: {
        ...(!isWindows ? { PROJECT_HUB_NODE: String(globalThis.process?.execPath || 'node').replace(/\\/g, '/') } : {}),
        PROJECT_HUB_FILE_TARGET: targetPath,
        PROJECT_HUB_FILE_MODE: overwrite ? 'replace' : 'create'
      },
      sandboxPolicy
    })
    const execution = await this.ctx.shell.execute(spec)
    const result = await execution.result()
    const errorCode = String(result?.stderr?.text || '').trim().split(/\s+/)[0]
    if (result?.exitCode !== 0 || result?.timedOut || result?.aborted || result?.sandbox?.denied) {
      if (!overwrite && errorCode === 'EEXIST') {
        collision = await this.findProjectFileCollision(workspace.path, safeName)
        if (collision) return { conflict: true, filename: collision.filename }
      }
      const error = new Error('项目文件安全写入失败')
      error.code = errorCode || (result?.sandbox?.denied ? 'SANDBOX_DENIED' : 'FILE_WRITE_FAILED')
      throw error
    }
    const writtenEntry = await this.ctx.fs.lstat(relativePath, { cwd: workspace.path })
    const writtenInfo = await this.ctx.fs.stat(target)
    if (!writtenEntry || writtenEntry.type !== 'file' || !writtenInfo || writtenInfo.type !== 'file') {
      const error = new Error('项目文件写入后未能在目标目录中验证到文件')
      error.code = 'WRITE_VERIFY_MISSING'
      throw error
    }
    if (Number.isFinite(writtenInfo.size) && writtenInfo.size !== bytes.byteLength) {
      const error = new Error('项目文件写入后大小与接收字节数不一致')
      error.code = 'WRITE_VERIFY_SIZE_MISMATCH'
      throw error
    }
    return { conflict: false, filename: finalName, path: relativePath, size: bytes.byteLength }
  },

  rememberPendingFileOverwrite(map, key, pending) {
    this.clearPendingFileOverwrite(map, key)
    const entry = { ...pending, expiresAt: Date.now() + INBOUND_FILE_CONFIRM_TTL_MS, busy: false, timer: undefined }
    entry.timer = setTimeout(() => {
      if (map.get(key) === entry) map.delete(key)
      this.releasePendingFileBytes(entry)
    }, INBOUND_FILE_CONFIRM_TTL_MS)
    entry.timer.unref?.()
    map.set(key, entry)
    return entry
  },

  clearPendingFileOverwrite(map, key, { preserveBytes = false } = {}) {
    const entry = map.get(key)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    map.delete(key)
    if (!preserveBytes) this.releasePendingFileBytes(entry)
    return entry
  },

  releasePendingFileBytes(entry) {
    for (const file of entry?.files || []) {
      try { file.bytes?.fill?.(0) } catch {}
      file.bytes = undefined
    }
    if (entry) entry.files = []
  },

  clearAllPendingFileOverwrites(map) {
    for (const key of [...map.keys()]) this.clearPendingFileOverwrite(map, key)
  },

  async saveInboundFileBatch({ map, key, files, workspace, project, session, sessionId, reply, savedBefore = [] }) {
    const saved = [...savedBefore]
    for (let index = 0; index < files.length; index++) {
      const item = files[index]
      const result = await this.writeInboundProjectFile({ workspace, session, filename: item.filename, bytes: item.bytes })
      if (result.conflict) {
        const pendingFiles = [{ filename: result.filename, bytes: item.bytes }, ...files.slice(index + 1)]
        this.rememberPendingFileOverwrite(map, key, {
          sessionId,
          workspaceId: workspace.id,
          projectId: project.id,
          files: pendingFiles,
          savedBefore: saved
        })
        await reply(`项目 files/${result.filename} 已存在。本次该文件尚未保存${pendingFiles.length > 1 ? `，另有 ${pendingFiles.length - 1} 个附件待处理` : ''}。请回复「替换」覆盖，或回复「取消」保留原文件；确认有效期 5 分钟。`)
        return { pending: true, saved }
      }
      saved.push(`files/${result.filename}`)
      try { item.bytes?.fill?.(0) } catch {}
      item.bytes = undefined
    }
    return { pending: false, saved }
  },
  }
}

