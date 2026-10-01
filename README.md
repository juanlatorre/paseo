<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="TePaseo logo">
</p>

<h1 align="center">TePaseo</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/juanlatorre/paseo/stargazers">
    <img src="https://img.shields.io/github/stars/juanlatorre/paseo?style=flat&logo=github" alt="GitHub stars">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents.</p>

> **TePaseo is a fork of [Paseo](https://github.com/getpaseo/paseo)** by [@boudra](https://github.com/boudra). It adds:
>
> - **Subagents nested in the sidebar.** Workspaces an agent launched fold under that agent's row, with a status dot per subagent, so you review the orchestrator instead of every worker.
> - **Agent icon on workspace rows.** Each row shows which agent runs in it.
> - **Steadier usage readings.** A rate-limited usage refresh (HTTP 429) keeps the last good reading instead of showing an error.
>
> Everything else, including the CLI, packages, and docs, is Paseo's. The CLI is still `paseo`.

<p align="center">
  <img src="https://paseo.sh/hero-mockup.png" alt="TePaseo app screenshot" width="100%">
</p>

<p align="center">
  <img src="https://paseo.sh/mobile-mockup.png" alt="TePaseo mobile app" width="100%">
</p>

Run agents in parallel on your own machines. Ship from your phone or your desk.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** TePaseo doesn't have any telemetry, tracking, or forced log-ins.

## Plugins

Add themes, workspace panels, commands, settings screens, and coding-agent providers with trusted
TypeScript plugins. Install from npm, Git, or a local directory with `paseo plugin install <source>`.

Start with the [plugin quickstart](https://paseo.sh/docs/plugins). Plugins run with access to your daemon
machine and inside connected clients; install only code you trust.

## Getting Started

TePaseo runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)
- [Antigravity](https://paseo.sh/docs/supported-providers#antigravity)
- [Muse Code](https://paseo.sh/docs/muse-code)

### Desktop app (recommended)

TePaseo doesn't publish builds yet. Build the desktop app from source (Node.js version in `.tool-versions`):

```bash
git clone https://github.com/juanlatorre/paseo.git tepaseo
cd tepaseo
npm ci
npm run build:desktop
```

The app lands in `packages/desktop/release/`. It isn't signed, so macOS blocks the first launch: right-click the app and choose **Open**. Open the app and the daemon starts automatically.

Want the official, signed build instead? Get Paseo from [paseo.sh/download](https://paseo.sh/download).

To connect from your phone, open **Settings → your host → Pair Device**.

### CLI / headless

Install the CLI and start the daemon:

```bash
npm install -g @getpaseo/cli
paseo
```

The daemon starts locally, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. This path is useful for servers and remote machines.

For full setup and configuration, see Paseo's docs, which apply to TePaseo as is:

- [Docs](https://paseo.sh/docs)
- [Connectivity guide](https://paseo.sh/docs/connectivity)
- [Configuration reference](https://paseo.sh/docs/configuration)

### Docker

Run the daemon and self-hosted web UI in Docker. This image is upstream Paseo's, without TePaseo's changes:

```bash
docker run -d --name paseo \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/getpaseo/paseo:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/paseo` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
paseo run --provider claude/opus-4.6 "implement user authentication"
paseo run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

paseo ls                           # list running agents
paseo attach abc123                # stream live output
paseo send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
paseo run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](https://paseo.sh/docs/cli) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@getpaseo/client`:

```ts
import { createPaseoClient } from "@getpaseo/client";

const client = createPaseoClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](https://paseo.sh/docs/sdk/quickstart), [recipes](https://paseo.sh/docs/sdk/recipes), and [API reference](https://paseo.sh/docs/sdk/reference).

## Skills

Skills teach your agent to use TePaseo to orchestrate other agents.

```bash
npx skills add getpaseo/paseo
```

Then use them in any agent conversation:

- `/paseo-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/paseo-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/paseo-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `paseo` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Marketing site and documentation (`paseo.sh`)

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## Support Paseo

TePaseo exists because of Paseo, which is built by one person and funded by the people who use it. Support that work on [GitHub Sponsors](https://github.com/sponsors/boudra), or join the [Discord](https://discord.gg/jz8T2uahpH) and [Reddit](https://www.reddit.com/r/PaseoAI/).

## Related projects

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — official distributed relay, written in Elixir
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code extension

## License

Apache-2.0, same as Paseo.
