import { VERSION } from "../version.js";

export const HELP = `cleamail ${VERSION} - a local-first email agent

Usage
  cleamail <command> [options]

Commands
  init                 Connect a mailbox and check that Ollama is running
  run                  Fetch recent mail into the local database
  status               Show the account, the database and the last sync
  logout               Remove the stored credential from the OS keychain
  start                Run the background service          (phase 3)
  undo                 Reverse the last applied actions    (phase 3)
  eval                 Measure accuracy on the eval set    (phase 2)

Options for run
  --since <window>     7d, 24h or an ISO date. Default: 7d
  --max <n>            Messages per page, 1 to 500. Default: 100
  --dry-run            Change nothing in the mailbox. Always on in this phase

Global options
  --help               Show this help
  --version            Show the version

Everything runs on your machine. Email content never leaves it.`;
