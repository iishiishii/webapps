# Repository instructions

## Test browser apps through the public reverse proxy

When a user needs an interactive remote preview, use this host's existing HTTPS Caddy site. Prefer a narrow app path over T3 port forwarding or a temporary public tunnel.

1. Build the app's production bundle. For Zarro, run `pnpm --filter zarro build`.
2. Serve the build on loopback. For Zarro, run Vite preview on `127.0.0.1:5173` as the named transient systemd unit `zarro-preview-prototype.service`.
3. Route only `/zarro/*` to `127.0.0.1:5173` in `/etc/caddy/Caddyfile`. Keep the catch-all route pointed at T3 on `127.0.0.1:3773`.
4. Back up the active Caddy file before an edit. Run `sudo caddy validate --config /etc/caddy/Caddyfile` before `sudo systemctl reload caddy`.
5. Verify the public HTTPS app URL, a built asset URL, and the target workflow in the shared browser.

Keep preview servers bound to loopback. Use a different path and port for another app so its preview cannot replace the T3 route or another active preview.
