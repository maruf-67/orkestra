import { log, heading } from "../utils/logger.js";

interface CompletionsOptions {
  shell?: string;
}

const ZSH_COMPLETIONS = `#compdef orkestra

_orkestra() {
  local -a commands
  commands=(
    'doctor:Check system capabilities and dependencies'
    'init:Create .orkestra.yml config file'
    'register:Register project with proxy, hosts, and SSL'
    'up:Start dev server with auto-registration'
    'down:Stop dev server'
    'restart:Restart dev server'
    'status:Show all projects and their state'
    'open:Open project in browser'
    'list:List all registered projects'
    'remove:Remove project and clean up everything'
    'logs:View dev server logs'
    'shell:Open shell with project environment variables'
    'db:Database management'
    'env:Environment variable management'
    'docker:Docker compose management'
    'completions:Generate shell completion scripts'
  )

  local -a up_opts
  up_opts=(
    '--dir[Project directory]:directory:_files -/'
    '--port[Dev server port]:port:'
    '--foreground[Run in foreground]'
    '--all[Start all registered projects]'
  )

  local -a down_opts
  down_opts=(
    '--dir[Project directory]:directory:_files -/'
    '--all[Stop all running servers]'
  )

  local -a status_opts
  status_opts=(
    '--json[Output as JSON]'
    '--verbose[Show detailed information]'
    '--watch[Auto-refresh every 2 seconds]'
  )

  local -a logs_opts
  logs_opts=(
    '--dir[Project directory]:directory:_files -/'
    '--follow[Follow logs in real-time]'
    '--since[Show logs since]:time:'
    '--stream[Filter by stream]:stream:(stdout stderr)'
    '--limit[Number of entries]:number:'
    '--list[List available log files]'
  )

  local -a register_opts
  register_opts=(
    '--dir[Project directory]:directory:_files -/'
    '--domain[Domain name]:domain:'
    '--port[Dev server port]:port:'
    '--proxy[Proxy provider]:proxy:(caddy nginx apache traefik)'
  )

  local -a shell_opts
  shell_opts=(
    '--dir[Project directory]:directory:_files -/'
  )

  local -a completions_opts
  completions_opts=(
    '--shell[Shell type]:shell:(zsh bash fish)'
  )

  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        up) _arguments $up_opts ;;
        down) _arguments $down_opts ;;
        status) _arguments $status_opts ;;
        logs) _arguments $logs_opts ;;
        register) _arguments $register_opts ;;
        shell) _arguments $shell_opts ;;
        completions) _arguments $completions_opts ;;
      esac
      ;;
  esac
}

_orkestra "$@"
`;

function getBashCompletions(): string {
  return `#!/bin/bash

_orkestra_completions() {
    local cur prev commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="doctor init register up down restart status open list remove logs shell db env docker completions"

    if [[ "\${cur}" == -* ]]; then
        case "\${prev}" in
            up)
                COMPREPLY=( $(compgen -W "--dir --port --foreground --all -d -f -a" -- "\${cur}") )
                ;;
            down)
                COMPREPLY=( $(compgen -W "--dir --all -d -a" -- "\${cur}") )
                ;;
            status)
                COMPREPLY=( $(compgen -W "--json --verbose --watch -v -w" -- "\${cur}") )
                ;;
            logs)
                COMPREPLY=( $(compgen -W "--dir --follow --since --stream --limit --list -d -f -n -l" -- "\${cur}") )
                ;;
            register)
                COMPREPLY=( $(compgen -W "--domain --port --proxy --dir -d" -- "\${cur}") )
                ;;
            shell)
                COMPREPLY=( $(compgen -W "--dir -d" -- "\${cur}") )
                ;;
            completions)
                COMPREPLY=( $(compgen -W "--shell" -- "\${cur}") )
                ;;
            *)
                COMPREPLY=( $(compgen -W "--help --version" -- "\${cur}") )
                ;;
        esac
    else
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    fi
}

complete -F _orkestra_completions orkestra
`;
}

const FISH_COMPLETIONS = `# Fish completions for orkestra

# Helper function to add completions
function __orkestra_needs_command
    set cmd (commandline -opc)
    if test (count $cmd) -eq 1
        return 0
    end
    return 1
end

function __orkestra_using_command
    set cmd (commandline -opc)
    if test (count $cmd) -gt 1
        if test $cmd[2] = $argv[1]
            return 0
        end
    end
    return 1
end

# Global options
complete -c orkestra -s h -l help -d 'Show help'
complete -c orkestra -s v -l version -d 'Show version'

# Commands
complete -c orkestra -n __orkestra_needs_command -a doctor -d 'Check system capabilities'
complete -c orkestra -n __orkestra_needs_command -a init -d 'Create .orkestra.yml config'
complete -c orkestra -n __orkestra_needs_command -a register -d 'Register project'
complete -c orkestra -n __orkestra_needs_command -a up -d 'Start dev server'
complete -c orkestra -n __orkestra_needs_command -a down -d 'Stop dev server'
complete -c orkestra -n __orkestra_needs_command -a restart -d 'Restart dev server'
complete -c orkestra -n __orkestra_needs_command -a status -d 'Show project status'
complete -c orkestra -n __orkestra_needs_command -a open -d 'Open in browser'
complete -c orkestra -n __orkestra_needs_command -a list -d 'List projects'
complete -c orkestra -n __orkestra_needs_command -a remove -d 'Remove project'
complete -c orkestra -n __orkestra_needs_command -a logs -d 'View logs'
complete -c orkestra -n __orkestra_needs_command -a shell -d 'Open shell with env vars'
complete -c orkestra -n __orkestra_needs_command -a db -d 'Database management'
complete -c orkestra -n __orkestra_needs_command -a env -d 'Environment variables'
complete -c orkestra -n __orkestra_needs_command -a docker -d 'Docker management'
complete -c orkestra -n __orkestra_needs_command -a completions -d 'Generate completions'

# up options
complete -c orkestra -n __orkestra_using_command up -l dir -d 'Project directory' -r
complete -c orkestra -n __orkestra_using_command up -l port -d 'Dev server port'
complete -c orkestra -n __orkestra_using_command up -s f -l foreground -d 'Run in foreground'
complete -c orkestra -n __orkestra_using_command up -s a -l all -d 'Start all projects'

# down options
complete -c orkestra -n __orkestra_using_command down -l dir -d 'Project directory' -r
complete -c orkestra -n __orkestra_using_command down -s a -l all -d 'Stop all servers'

# status options
complete -c orkestra -n __orkestra_using_command status -l json -d 'Output as JSON'
complete -c orkestra -n __orkestra_using_command status -s v -l verbose -d 'Detailed info'
complete -c orkestra -n __orkestra_using_command status -s w -l watch -d 'Auto-refresh'

# logs options
complete -c orkestra -n __orkestra_using_command logs -l dir -d 'Project directory' -r
complete -c orkestra -n __orkestra_using_command logs -s f -l follow -d 'Follow logs'
complete -c orkestra -n __orkestra_using_command logs -l since -d 'Show since time' -r
complete -c orkestra -n __orkestra_using_command logs -l stream -d 'Filter by stream' -xa 'stdout stderr'
complete -c orkestra -n __orkestra_using_command logs -s n -l limit -d 'Number of entries'
complete -c orkestra -n __orkestra_using_command logs -s l -l list -d 'List log files'

# register options
complete -c orkestra -n __orkestra_using_command register -l dir -d 'Project directory' -r
complete -c orkestra -n __orkestra_using_command register -l domain -d 'Domain name' -r
complete -c orkestra -n __orkestra_using_command register -l port -d 'Dev server port'
complete -c orkestra -n __orkestra_using_command register -l proxy -d 'Proxy provider' -xa 'caddy nginx apache traefik'

# shell options
complete -c orkestra -n __orkestra_using_command shell -l dir -d 'Project directory' -r

# completions options
complete -c orkestra -n __orkestra_using_command completions -l shell -d 'Shell type' -xa 'zsh bash fish powershell'
`;

function getPowerShellCompletions(): string {
  return `# PowerShell completions for orkestra

$OrkestraCommands = @(
    'doctor',
    'init',
    'remove',
    'list',
    'up',
    'down',
    'restart',
    'status',
    'logs',
    'open',
    'db',
    'env',
    'docker',
    'shell',
    'completions'
)

$OrkestraOptions = @{
    'up'         = @('--dir', '--port', '--foreground', '--all')
    'down'       = @('--dir', '--all')
    'status'     = @('--json', '--verbose', '--watch')
    'logs'       = @('--dir', '--follow', '--since', '--stream', '--limit', '--list')
    'init'       = @('--dir', '--domain', '--port', '--proxy')
    'register'   = @('--dir', '--domain', '--port', '--proxy')
    'shell'      = @('--dir')
    'completions' = @('--shell')
    'db'         = @('--action', '--name', '--dir')
    'env'        = @('--set', '--get', '--dir')
    'docker'     = @('--action', '--dir')
}

Register-ArgumentCompleter -CommandName 'orkestra' -ScriptBlock {
    param($commandName, $commandAst, $cursorPosition)

    $tokens = $commandAst.Extent.Text.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)

    if ($tokens.Count -le 1) {
        return $OrkestraCommands | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new(
                $_,
                $_,
                'ParameterValue',
                $_
            )
        }
    }

    $command = $tokens[1]
    $lastToken = $tokens[-1]

    if ($OrkestraOptions.ContainsKey($command)) {
        return $OrkestraOptions[$command] | Where-Object { $_ -like "$lastToken*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new(
                $_,
                $_,
                'ParameterValue',
                $_
            )
        }
    }

    return @()
}
`;
}

export function completions(options: CompletionsOptions) {
  const shell = options.shell || process.env.SHELL?.split("/").pop() || "powershell";

  let script: string;

  switch (shell) {
    case "zsh":
      script = ZSH_COMPLETIONS;
      break;
    case "fish":
      script = FISH_COMPLETIONS;
      break;
    case "powershell":
      script = getPowerShellCompletions();
      break;
    case "bash":
    default:
      script = getBashCompletions();
      break;
  }

  console.log(script);
}
