# Pinloom deployment

URL: https://playground.24-144-111-117.sslip.io/

This private self-hosted playground uses Nginx Basic Auth and a Let's Encrypt
certificate. Nginx proxies the application at 127.0.0.1:3080. The application
runs in the pinned upstream Docker image
`ghcr.io/davidmonterocrespo24/velxio@sha256:9b5d3da22691449a0f8729b73cb63cf75a211d58884999d2b4e9a8ff61995d27`
with a locally built Pinloom frontend bind-mounted read-only from
`/home/saimanoj/velxio-playground/releases/25f3251c/dist`.

The server currently has a 48 GiB root filesystem, 2 GiB RAM, 6 GiB swap,
and 1 vCPU. The container has one heavy and one light compile slot, a 1.4 GiB
memory limit, 1 GiB ccache cap, and persistent data/build volumes. A real
Arduino Uno compile passed in 2.6 s. The first ESP32 build hit the 600 s
backend timeout after roughly 54% of ESP-IDF steps. Its incremental output
is retained; subsequent compiles reuse the build directory and ccache.

The frontend is built on the Mac with `cd frontend && npm run build:docker`.
Upload assets first, then HTML, to the existing release directory using rsync
via the trusted SSH identity. This updates the mounted frontend without
restarting the compiler container. The served `/pinloom-source.tar.gz` must be
regenerated from the same source revision and uploaded with each deployment.
`/SOURCE.txt` explains the AGPL-3.0 source offer and upstream attribution.

The ESP32 buzzer pitch fix also changes `backend/app/services/esp32_worker.py`.
For this pinned container, back up `/app/app/services/esp32_worker.py`, copy in
the patched file with `docker cp`, and restart only `velxio-playground` if
needed. The container's writable layer survives `docker restart`; recreating
the container from the original upstream image requires reapplying this patch
or baking it into a replacement pinned image. Roll back by copying the backup
into the container. The matching frontend reads the reported LEDC frequency.

Rollback: restore the previous frontend release directory contents and verify
`/`, `/editor/`, `/health`, and `/api/compile/status/<known-job>` over HTTPS.
For Nginx changes, run `sudo nginx -t` before `sudo systemctl reload nginx`;
verify existing vhosts afterward. Do not alter SSH, firewall, or other vhosts.

The full ESP32 lesson, Uno/Pico emulation, 3D view, portable project round
trips, and the requested 477-entry catalog have not passed end-to-end
acceptance. The public metadata has 157 entries, not 477; hosted-only boards
and assets are absent from the self-hosted source. The existing image runs
compilation jobs inside the app container with concurrency and memory limits,
but stronger per-job isolation and network restrictions remain outstanding.
Strict `npm run build` has pre-existing upstream TypeScript errors;
`npm run build:docker` succeeds.

## Private project storage

The File menu's Save to Droplet action writes a complete `.vlx` payload to a
separate Python service at 127.0.0.1:3081. Nginx proxies only
`/api/local-projects` to it under the same Basic Auth gate. The service is
`pinloom-project-store.service` (User=saimanoj) and persists files in
`/home/saimanoj/velxio-playground/projects` (mode 0700). Each save replaces
one file atomically; Open from Droplet lists and reloads it. Export `.vlx`
continues to download an offline backup. The browser frontend must be built
with `VITE_PINLOOM_SERVER_SAVE=1` to enable these controls.

For this service, deploy `deployment/project_store.py` as
`/home/saimanoj/velxio-playground/project_store.py`, install
`deployment/pinloom-project-store.service` under `/etc/systemd/system`, run
`systemctl daemon-reload` and `systemctl enable --now pinloom-project-store`.
The current Certbot-managed Nginx vhost is tracked in
`deployment/nginx/playground.24-144-111-117.sslip.io.conf`; validate with
`nginx -t` before a graceful reload. To roll back storage routing, restore the
prior playground-only vhost, validate, reload, and stop the project-store
service. Preserve the projects directory when rolling back.

Saved server projects use `/editor?project=<uuid>` so refresh fetches that
snapshot instead of the default ESP32 example. The `.vlx` payload carries
board and component positions, wire endpoint pin names and waypoints, visual
stacking order, and canvas pan/zoom. Older `.vlx` files without camera data
open at the default view. The root URL still opens the ESP32 lesson.

## MCP over HTTPS (Claude Code connects here directly)

Claude Code can talk to the playground's MCP server without a local checkout.
The server is `backend/mcp_sse_server.py` (SSE transport), run by
`pinloom-mcp.service` on 127.0.0.1:8002 and exposed by nginx at `/mcp/` behind
its **own** login (`/etc/nginx/pinloom-mcp.htpasswd`, separate from the site's).
It has no authentication of its own: never bind it to a public address.

Tools: `define_part`, `list_parts`, `delete_part`, `export_parts_for_deploy`, plus
the circuit tools. With `VELXIO_AUTO_EXPORT=1` every part change is written to
`/var/lib/pinloom-parts/index.json`, which nginx serves as `/parts/index.json`
(falling back to the build's own copy until a first part exists), so a new part
is in the Add Component dialog the next time the editor opens it. No rebuild.

Limits: `compile_project` and `run_project` need `arduino-cli` on the host and
will report an error here; compile in the editor as before. A part can carry C
that is compiled when someone presses Run, so treat the MCP password like a
deploy key. Rotate it with `htpasswd` and reload nginx.

Install (once):

    sudo apt install -y apache2-utils python3-venv
    cd /home/saimanoj/velxio-playground/src && git pull
    python3 -m venv ../mcp-venv && ../mcp-venv/bin/pip install -r backend/requirements.txt
    sudo cp deployment/pinloom-mcp.service /etc/systemd/system/
    sudo htpasswd -c /etc/nginx/pinloom-mcp.htpasswd claude     # use a long random password
    # add the two `location` blocks from deployment/nginx/*.conf to the live vhost
    sudo nginx -t && sudo systemctl reload nginx
    sudo systemctl daemon-reload && sudo systemctl enable --now pinloom-mcp
    systemctl status pinloom-mcp --no-pager

After deploying a frontend to a new `releases/<id>`, update
`VELXIO_SHIPPED_PARTS_FILE` in the unit to that release and restart the service.

Connect (on the machine running Claude Code):

    claude mcp add --transport sse velxio \
      https://playground.24-144-111-117.sslip.io/mcp/sse \
      --header "Authorization: Basic $(printf 'claude:YOUR_PASSWORD' | base64)"
    claude mcp list

