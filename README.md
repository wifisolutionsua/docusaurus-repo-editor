# Docusaurus Repo Editor

A small self-hosted editor for a Git-backed Docusaurus site. It checks out the real
documentation repository, runs that repository's Docusaurus development server,
and places a source editor beside the live preview.

## Included

- Markdown and MDX file tree
- CodeMirror source editor with Docusaurus admonition and tabs helpers
- Real Docusaurus preview, including the repository theme and components
- Create, rename, move, and delete documents
- Media library, uploads, and automatic relative Markdown image paths
- Git status, pull, commit, and push
- HTTP Basic authentication
- Docker image and persistent repository volume

## Run locally with Docker

1. Create `compose.yaml`:

   ```yaml
   services:
     editor:
       image: ghcr.io/your-account/docusaurus-repo-editor:latest
       restart: unless-stopped
       ports:
         - "${EDITOR_BIND_ADDRESS:-0.0.0.0}:${EDITOR_PORT:-3000}:3000"
       environment:
         EDITOR_USERNAME: ${EDITOR_USERNAME:-admin}
         EDITOR_PASSWORD: ${EDITOR_PASSWORD:?Set EDITOR_PASSWORD in .env}
         AUTO_PULL: ${AUTO_PULL:-true}
       volumes:
         - repository-data:/data

   volumes:
     repository-data:
   ```

2. Create the environment file:

   ```bash
   cp .env.example .env
   ```

3. Set a strong `EDITOR_PASSWORD`, then start the service:

   ```bash
   docker compose up -d
   ```

4. Open `http://localhost:3000/editor` and sign in.

5. The Settings screen shows a generated public deploy key. Copy it and open the
   GitHub repository you want to edit:

   **Settings → Deploy keys → Add deploy key**

   Paste the key and enable **Allow write access**.

6. Copy the repository SSH URL from GitHub, for example:

   ```text
   git@github.com:owner/documentation.git
   ```

   Paste it into the editor Settings screen, choose the branch, and click
   **Connect repository**.

The first connection clones the documentation repository and installs its
dependencies. It uses `npm ci` when a valid npm lockfile exists and falls back
to `npm install` otherwise. This can take a few minutes. The repository and its
installed dependencies stay in the `repository-data` volume across container
restarts.

When no lockfile exists, npm may create `package-lock.json`, which will appear as
a repository change that can be committed or removed.

The generated private deploy key is stored only in `/data/ssh` inside the
persistent Docker volume. Compose contains no repository URL, PAT, or Git private
key. Recreating the volume creates a new key that must be added to GitHub again.

## Published Docker image

The GitHub Actions workflow in `.github/workflows/docker-publish.yml` publishes
multi-architecture images to GitHub Container Registry:

```text
ghcr.io/OWNER/REPOSITORY:latest
```

Supported platforms:

- `linux/amd64`
- `linux/arm64` for 64-bit Raspberry Pi OS

Publishing happens on:

- pushes to `main`
- version tags such as `v1.0.0`
- manual runs from the GitHub Actions page

Pull requests build the image without publishing it.

After the first successful workflow run, open the package on GitHub and change
its visibility to **Public** if anonymous Docker pulls should be allowed. Then:

```bash
docker pull ghcr.io/OWNER/REPOSITORY:latest
```

Docker automatically selects the correct Raspberry Pi image. To verify the
machine architecture:

```bash
uname -m
docker info --format '{{.Architecture}}'
```

No registry secret is required. The workflow publishes with the repository's
built-in `GITHUB_TOKEN` and `packages: write` permission.

## VPS deployment

By default, Compose exposes the editor on all interfaces. Open:

```text
http://YOUR_VPS_IP:3000/editor
```

Allow TCP port `3000` in the VPS provider firewall and the server firewall.

For production, put Caddy, Nginx, or another TLS reverse proxy in front of the
editor and set `EDITOR_BIND_ADDRESS=127.0.0.1`. Proxy the whole origin, not only
`/editor`: the Docusaurus preview uses routes such as `/docs/...`, `/assets/...`,
and a WebSocket for hot reload.

Example Caddy configuration:

```caddyfile
editor.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Keep `.env` readable only by the deployment user:

```bash
chmod 600 .env
```

Only configure repositories whose code you trust. The editor runs the target
repository's `npm ci` lifecycle scripts and Docusaurus development server.
Editor credentials are removed from those child-process environments, but
arbitrary dependency scripts still execute inside the container.

## Git behavior

- **Pull** runs `git pull --ff-only`.
- **Publish** stages all repository changes, creates one commit, and pushes the
  configured branch.
- Git authentication uses the repository-scoped SSH deploy key generated in
  Settings.
- The editor refuses to start in production when `EDITOR_PASSWORD` is empty.

For repositories that require pull requests, choose a dedicated editing branch
in Settings and create the PR in GitHub after publishing.

## Media paths

Uploads default to an `img` folder beside the current document. For example,
editing `docs/admin/admin-tutorial.md` defaults to `docs/admin/img`, producing:

```md
![image name](./img/image-name.png)
```

Files uploaded below `static/` are inserted as root paths such as
`/img/image-name.png`.

## Development checks

```bash
npm install
npm run build
npm run check
```

Node.js 20 or newer is required.

## License

This project is open source under the [MIT License](LICENSE), the same license
used by Docusaurus.
