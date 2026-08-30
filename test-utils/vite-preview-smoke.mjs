// Shared plumbing for raw-playwright browser smokes that drive the production
// build via `vite preview`: detached server spawn + process-group cleanup, a
// port poll that detects --strictPort clashes, a Chrome launch with the
// SwiftShader/WebGPU flags, page/console error collection, and uniform
// fail/pass reporting.
//
// GPU-less environments (GitHub's Linux runners expose no usable WebGPU
// adapter): `expectWebGpuFallback` is true when `<fallbackEnvVar>=1` or on a
// Linux CI runner, and the browser is then launched with the GPU and software
// rasterizer disabled so the app's unsupported-WebGPU experience is what
// actually gets exercised — the `run` callback branches on it to assert that
// fallback instead of the full pipeline.
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export async function runVitePreviewSmoke({
  // playwright's chromium, passed in by the app so it resolves against the
  // app's own dependencies (test-utils has no playwright dependency).
  chromium,
  // App root: cwd for `vite preview`.
  root,
  basePath = '/',
  port = 4173,
  // App-specific opt-in env var, e.g. 'BROWSERQC_EXPECT_WEBGPU_FALLBACK'.
  fallbackEnvVar,
  // Status label dumped in failure diagnostics.
  statusSelector = '#statusMsg',
  // Where smoke-fail.png lands.
  artifactsDir = join(root, 'test'),
  run,
}) {
  const url = `http://localhost:${port}${basePath}`
  const expectWebGpuFallback = Boolean(
    (fallbackEnvVar && process.env[fallbackEnvVar] === '1')
    || (process.platform === 'linux' && process.env.CI === 'true'),
  )

  // --- boot vite preview ---
  // detached so the child is its own process-group leader; killing -pid then reaps
  // the whole group (vite + its esbuild children). A plain preview.kill() would only
  // signal the `npx` wrapper and orphan the actual server, leaking the port.
  const preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
    detached: true,
  })
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try { process.kill(-preview.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(130) })
  process.on('SIGTERM', () => { cleanup(); process.exit(143) })

  // --strictPort makes vite exit non-zero on a port clash; catch that so the test
  // fails fast instead of polling a port served by some other (stale) process.
  let previewExited = false
  let previewExitCode = null
  preview.on('exit', (code) => { previewExited = true; previewExitCode = code })

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  // poll the server until it answers
  async function waitForServer(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (previewExited) {
        throw new Error(`vite preview exited (code ${previewExitCode}) before ready — port ${port} clash?`)
      }
      let ok = false
      try {
        ok = (await fetch(url)).ok
      } catch { /* not up yet */ }
      if (ok) {
        // The port answered — but confirm it's OUR preview, not a STALE server that won the
        // port and forced our --strictPort child to exit (which would silently validate a
        // stale build). A strictPort bind failure exits the child within a few hundred ms,
        // so settle briefly and re-check before trusting the server.
        await wait(500)
        if (previewExited) {
          throw new Error(
            `port ${port} is served by another process — our --strictPort preview exited (code ${previewExitCode}); refusing to test a stale server`,
          )
        }
        return
      }
      await wait(300)
    }
    throw new Error('vite preview did not come up')
  }

  let browser
  const consoleErrors = []
  const pageErrors = []
  const allowedConsoleErrors = []
  const fail = async (msg, page) => {
    console.error('\n❌ SMOKE FAIL:', msg)
    if (page) {
      const status = await page.$eval(statusSelector, (el) => el.textContent || '').catch(() => '')
      if (status) console.error('Last app status:', status)
      if (pageErrors.length) console.error('Page errors:\n  ' + pageErrors.join('\n  '))
      if (consoleErrors.length) console.error('Console errors:\n  ' + consoleErrors.join('\n  '))
      await page.screenshot({ path: join(artifactsDir, 'smoke-fail.png') }).catch(() => {})
    }
    if (browser) await browser.close().catch(() => {})
    cleanup()
    process.exit(1)
  }

  try {
    await waitForServer()
    // Use the system Google Chrome (channel) rather than Playwright's bundled
    // browser — it has full WebGPU and avoids a separate browser download. The
    // swiftshader/angle flags are a software-rendering fallback for headless;
    // in fallback mode the GPU is forced off entirely so the run is deterministic.
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      args: [
        '--use-gl=angle',
        '--enable-unsafe-swiftshader',
        ...(expectWebGpuFallback ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
        '--window-size=1280,960',
      ],
    })
    const page = await browser.newPage()
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await page.goto(url, { waitUntil: 'domcontentloaded' })

    await run({
      page,
      url,
      fail,
      expectWebGpuFallback,
      consoleErrors,
      pageErrors,
      // A handled, expected underlying failure (e.g. NiiVue's adapter error in
      // fallback mode) can be allowlisted by substring; everything else stays fatal.
      allowConsoleError: (substring) => allowedConsoleErrors.push(substring),
    })

    // Fatal on any uncaught page error OR non-allowlisted console.error. The apps
    // are expected to run clean; a console error means a real regression. If a
    // benign third-party error ever appears, narrow it with an explicit
    // allowConsoleError() in the app's run callback rather than downgrading.
    if (pageErrors.length) await fail('uncaught page errors:\n  ' + pageErrors.join('\n  '), page)
    const unexpectedErrors = consoleErrors.filter(
      (message) => !allowedConsoleErrors.some((allowed) => message.includes(allowed)),
    )
    if (unexpectedErrors.length) await fail('console.error output:\n  ' + unexpectedErrors.join('\n  '), page)
    console.log('✓ no unexpected console.error output')

    console.log('\n✅ SMOKE PASS')
    await browser.close()
    cleanup()
    process.exit(0)
  } catch (e) {
    await fail(e?.stack || String(e))
  }
}
