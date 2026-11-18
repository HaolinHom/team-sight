import { applyDocumentTheme, applyHostStyleVariables, type App } from '@modelcontextprotocol/ext-apps'
export function followHostTheme(app: App) {
  const apply = () => {
    const context = app.getHostContext()
    if (context?.theme) applyDocumentTheme(context.theme)
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables)
  }
  app.onhostcontextchanged = apply
  apply()
}
