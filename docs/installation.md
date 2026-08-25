# Installation Guide

Orkestra works on Linux, macOS, and Windows. This guide covers installation for each platform.

## Prerequisites

- **Node.js** 22 or higher
- **npm**, **pnpm**, or **yarn**

## Installing Orkestra

### Using npm

```bash
npm install -g orkestra
```

### Using pnpm

```bash
pnpm add -g orkestra
```

### Using yarn

```bash
yarn global add orkestra
```

## Platform-Specific Setup

### Linux (Ubuntu/Debian)

```bash
# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Caddy (recommended proxy)
sudo apt update
sudo apt install -y caddy

# Install mkcert (for SSL)
sudo apt install -y mkcert
sudo mkcert -install

# Install Orkestra
npm install -g orkestra
```

### Linux (Fedora/RHEL)

```bash
# Install Caddy
sudo dnf install -y caddy

# Install mkcert
sudo dnf install -y mkcert
sudo mkcert -install

# Install Orkestra
npm install -g orkestra
```

### macOS

```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Caddy
brew install caddy

# Install mkcert
brew install mkcert
mkcert -install

# Install Orkestra
npm install -g orkestra
```

### Windows

```powershell
# Install Chocolatey (if not installed)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Caddy
choco install caddy -y

# Install mkcert
choco install mkcert -y
mkcert -install

# Install Orkestra
npm install -g orkestra
```

## Smart Installer

When you run `orkestra init`, it will automatically detect missing tools and offer to install them:

```
$ orkestra init

Initialize Project
──────────────────
✓ Framework: nuxt ^4.5.0
⚠ No proxy detected (Caddy, Nginx, Apache, or Traefik)
? Caddy is not installed. Install it now? (Y/n) Y
Installing Caddy via: brew install caddy
✓ Caddy installed successfully
✓ Project registered successfully!
```

## Verifying Installation

```bash
# Check Orkestra version
orkestra --version

# Check system capabilities
orkestra doctor
```

## Shell Completions

### ZSH

```bash
orkestra completions --shell zsh > ~/.zfunc/_orkestra
echo 'fpath+=~/.zfunc' >> ~/.zshrc
echo 'autoload -Uz compinit && compinit' >> ~/.zshrc
source ~/.zshrc
```

### Bash

```bash
orkestra completions --shell bash > /etc/bash_completion.d/orkestra
source /etc/bash_completion.d/orkestra
```

### Fish

```bash
orkestra completions --shell fish > ~/.config/fish/completions/orkestra.fish
```

### PowerShell

```powershell
orkestra completions --shell powershell > $PROFILE
. $PROFILE
```

## Uninstalling

```bash
npm uninstall -g orkestra
```

## Troubleshooting Installation

### Command not found

After installation, if `orkestra` is not found:

```bash
# Check npm global bin directory
npm config get prefix

# Add to PATH (Linux/macOS)
export PATH="$(npm config get prefix)/bin:$PATH"

# Add to PATH permanently
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Permission denied (Linux/macOS)

```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Windows PowerShell execution policy

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
