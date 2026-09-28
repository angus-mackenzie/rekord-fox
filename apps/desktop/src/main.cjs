const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

let backendProcess = null
let isQuitting = false

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (port) resolve(port)
        else reject(new Error('could not allocate a localhost port'))
      })
    })
  })
}

function resolveWebDist() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'web')
  return path.resolve(__dirname, '..', '..', 'web', 'dist')
}

function resolveBackendCommand() {
  if (app.isPackaged) {
    const executable = process.platform === 'win32' ? 'rekord-backend.exe' : 'rekord-backend'
    return {
      command: path.join(process.resourcesPath, 'backend', executable),
      args: [],
      cwd: process.resourcesPath,
    }
  }

  return {
    command: path.resolve(__dirname, '..', '..', 'backend', '.venv', 'bin', 'python'),
    args: [path.resolve(__dirname, '..', '..', 'backend', 'scripts', 'run_desktop_server.py')],
    cwd: path.resolve(__dirname, '..', '..', 'backend'),
  }
}

function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    function poll() {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/health',
          timeout: 1000,
        },
        (res) => {
          res.resume()
          if (res.statusCode === 200) {
            resolve()
            return
          }
          retry()
        },
      )

      req.on('error', retry)
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
    }

    function retry() {
      if (Date.now() > deadline) {
        reject(new Error('backend did not become healthy in time'))
        return
      }
      setTimeout(poll, 250)
    }

    poll()
  })
}

async function startBackend() {
  const port = await findFreePort()
  const webDist = resolveWebDist()
  const indexHtml = path.join(webDist, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`web build missing at ${indexHtml}; run npm run build:web first`)
  }

  const dataDir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDir, { recursive: true })

  const backend = resolveBackendCommand()
  if (!fs.existsSync(backend.command)) {
    throw new Error(`backend executable missing at ${backend.command}`)
  }

  const env = {
    ...process.env,
    REKORD_DATA_DIR: dataDir,
    REKORD_UPLOAD_DIR: path.join(dataDir, 'uploads'),
    REKORD_WAVEFORM_CACHE_DIR: path.join(dataDir, 'waveforms'),
    REKORD_DB_PATH: path.join(dataDir, 'rekord.db'),
    REKORD_WEB_DIST_DIR: webDist,
  }

  backendProcess = spawn(
    backend.command,
    [...backend.args, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--web-dist', webDist],
    {
      cwd: backend.cwd,
      env,
      stdio: app.isPackaged ? 'ignore' : 'inherit',
    },
  )

  backendProcess.on('exit', (code, signal) => {
    backendProcess = null
    if (!isQuitting) {
      dialog.showErrorBox(
        'Rekord Fox backend stopped',
        `The local backend process exited unexpectedly.\ncode=${code ?? 'null'} signal=${signal ?? 'null'}`,
      )
      app.quit()
    }
  })

  await waitForHealth(port)
  return `http://127.0.0.1:${port}`
}

function stopBackend() {
  if (!backendProcess) return
  backendProcess.kill('SIGTERM')
  backendProcess = null
}

async function createWindow(appUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    title: 'Rekord Fox',
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())
  await win.loadURL(appUrl)
}

app.on('before-quit', () => {
  isQuitting = true
  stopBackend()
})

app.whenReady().then(async () => {
  try {
    const appUrl = await startBackend()
    await createWindow(appUrl)
  } catch (error) {
    dialog.showErrorBox('Rekord Fox failed to start', error instanceof Error ? error.message : String(error))
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    startBackend()
      .then(createWindow)
      .catch((error) => {
        dialog.showErrorBox('Rekord Fox failed to start', error instanceof Error ? error.message : String(error))
        app.quit()
      })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
