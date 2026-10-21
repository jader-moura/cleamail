import { VERSION } from "../version.js";

export const HELP = `cleamail ${VERSION} - a local-first email agent

Usage
  cleamail <command> [options]

Commands
  init                 Connect a mailbox and check that Ollama is running
  run                  Fetch recent mail and report what cleamail thinks of it
  status               Show the account, the database and the last sync
  logout               Remove the stored credential from the OS keychain
  start                Run the background service          (phase 3)
  undo                 Reverse the last applied actions    (phase 3)
  eval                 Measure accuracy on the eval set    (phase 2)

Options for run
  --since <window>     7d, 24h or an ISO date. Default: 7d
  --max <n>            Messages per page, 1 to 500. Default: 100
  --dry-run            Change nothing in the mailbox. Always on in this phase
  --no-classify        Fetch only, without waiting on the model

Environment
  CLEAMAIL_MODEL       Ollama model for classification. Default: qwen2.5:7b
  CLEAMAIL_OLLAMA_URL  Ollama address. Must be on this machine
  CLEAMAIL_DB          Path to the local database

Global options
  --help               Show this help
  --version            Show the version

Everything runs on your machine. Email content never leaves it.`;
