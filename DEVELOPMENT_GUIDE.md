# Development Guide

## Node.js via nvm

Official downloads: <https://nodejs.org/en/download>

Install `nvm`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
```

In lieu of restarting the shell:

```bash
\. "$HOME/.nvm/nvm.sh"
```

Download and install Node.js:

```bash
nvm install 24
```

Verify the Node.js version:

```bash
node -v # Should print "v24.14.1".
```

Download and install `pnpm`:

```bash
corepack enable pnpm
```

Verify the `pnpm` version:

```bash
pnpm -v
```

## Bun

Official installation docs: <https://bun.com/docs/installation>

Install Bun:

```bash
curl -fsSL https://bun.com/install | bash
```
