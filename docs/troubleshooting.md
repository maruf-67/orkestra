# Troubleshooting

Common issues and solutions for Orkestra.

## Installation Issues

### Command not found after install

**Problem:** `orkestra: command not found`

**Solution:**
```bash
# Check npm global bin directory
npm config get prefix

# Add to PATH (Linux/macOS)
export PATH="$(npm config get prefix)/bin:$PATH"

# Make permanent
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Permission denied (Linux/macOS)

**Problem:** `EACCES: permission denied`

**Solution:**
```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Reinstall
npm install -g orkestra
```

### Windows PowerShell execution policy

**Problem:** `running scripts is disabled on this system`

**Solution:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Proxy Issues

### No proxy detected

**Problem:** `No proxy detected (Caddy, Nginx, Apache, or Traefik)`

**Solution:**
```bash
# Install Caddy (recommended)
# macOS
brew install caddy

# Linux (Ubuntu/Debian)
sudo apt install -y caddy

# Linux (Fedora)
sudo dnf install -y caddy

# Windows
choco install caddy -y

# Or let Orkestra install it automatically
orkestra init  # Will offer to install Caddy
```

### Caddy not starting

**Problem:** `Caddy failed to start`

**Solution:**
```bash
# Check if Caddy is installed
which caddy

# Check if port 80/443 is in use
sudo lsof -i :80
sudo lsof -i :443

# Restart Caddy
sudo systemctl restart caddy
```

### Hosts file permission denied

**Problem:** `Failed to write /etc/hosts`

**Solution:**
```bash
# Orkestra needs sudo access for hosts file
# Run with sudo or ensure your user has sudo access

# Manual fix
sudo sh -c 'echo "127.0.0.1 my-app.dev.com" >> /etc/hosts'
```

---

## SSL Issues

### mkcert not installed

**Problem:** `mkcert is required for SSL certificates`

**Solution:**
```bash
# Install mkcert
# macOS
brew install mkcert

# Linux
sudo apt install -y mkcert

# Windows
choco install mkcert -y

# Trust the local CA
mkcert -install
```

### SSL certificate errors

**Problem:** `ERR_CERT_AUTHORITY_INVALID` in browser

**Solution:**
```bash
# Reinstall the local CA
mkcert -install

# Clear browser certificate cache
# Chrome: chrome://settings/certificates
```

### Caddy can't read certificates

**Problem:** `permission denied` on certificate files

**Solution:**
```bash
# Copy certs to Caddy's directory
sudo cp ~/.orkestra/certs/*.pem /etc/caddy/certs/
sudo chmod 644 /etc/caddy/certs/*.pem

# Or use the correct directory for your OS
# Linux: /etc/caddy/certs/
# macOS: ~/Library/Application Support/Caddy/certs/
# Windows: ~/AppData/Roaming/Caddy/certs/
```

---

## Server Issues

### Port already in use

**Problem:** `listen EADDRINUSE: address already in use :::3000`

**Solution:**
```bash
# Find what's using the port
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
orkestra up --port 3001
```

### Server won't start

**Problem:** `Cannot start server without framework detection`

**Solution:**
```bash
# Ensure you're in a project directory
cd ~/projects/my-app

# Check for package.json or other config files
ls -la

# If no framework detected, set startCommand in .orkestra.yml
echo 'startCommand: "pnpm dev"' >> .orkestra.yml
```

### Server starts but URL doesn't work

**Problem:** `This site can't be reached`

**Solution:**
```bash
# Check if server is running
orkestra status

# Check if port is correct
orkestra status --verbose

# Try localhost directly
curl http://localhost:3000

# Check hosts file
cat /etc/hosts | grep my-app
```

---

## Logging Issues

### No logs appearing

**Problem:** `No log files found`

**Solution:**
```bash
# Logs are only captured in background mode
# Make sure you're not using --foreground flag

# Start server in background
orkestra up

# Check logs
orkestra logs
```

### Logs are empty

**Problem:** Server is running but no log output

**Solution:**
```bash
# Check if logs directory exists
ls -la .orkestra/logs/

# Check if server is actually running
orkestra status

# Try running in foreground to see output
orkestra up -f
```

---

## Health Monitoring Issues

### Server keeps restarting

**Problem:** Server crashes and restarts multiple times

**Solution:**
```bash
# Check logs for errors
orkestra logs --stream stderr

# Stop the server
orkestra down

# Fix the issue, then restart
orkestra up
```

### Health monitoring not working

**Problem:** Server crashes but doesn't restart

**Solution:**
```bash
# Health monitoring only works in background mode
# Make sure you're not using --foreground flag

# Start in background
orkestra up

# Check if health monitor is active
orkestra status --verbose
```

---

## Platform-Specific Issues

### Windows: PowerShell can't run scripts

**Problem:** `cannot be loaded because running scripts is disabled`

**Solution:**
```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### macOS: Permission denied for /etc/hosts

**Problem:** `EACCES: permission denied, open '/etc/hosts'`

**Solution:**
```bash
# Grant Terminal full disk access
# System Preferences → Security & Privacy → Privacy → Full Disk Access
# Add Terminal.app
```

### Linux: Caddy service not found

**Problem:** `Failed to restart caddy: Unit caddy.service not found`

**Solution:**
```bash
# Install Caddy properly
sudo apt install -y caddy

# Or use snap
sudo snap install caddy

# Or install manually
curl -OL https://github.com/caddyserver/caddy/releases/download/v2.7.6/caddy_2.7.6_linux_amd64.tar.gz
tar -xzf caddy_2.7.6_linux_amd64.tar.gz
sudo mv caddy /usr/local/bin/
```

---

## Getting Help

If you're still having issues:

1. Run `orkestra doctor` to check your setup
2. Check the [GitHub Issues](https://github.com/maruf-67/orkestra/issues)
3. Create a new issue with:
   - Your OS and version
   - Node.js version (`node --version`)
   - Orkestra version (`orkestra --version`)
   - Full error message
   - Steps to reproduce
