import { windowsAgent } from './windows-agent.mjs'

windowsAgent(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)), error => {
  console.error(/^(?:CODEX|PAYLOAD|SERVICE|INSTANCE|DATA|SETTINGS|INSTALLER|INVALID|LINK|LOCAL)_[A-Z_]+(?::|$)/.exec(error.message)?.[0].replace(/:$/, '') ?? 'WINDOWS_AGENT_OPERATION_FAILED')
  process.exitCode = 1
})
