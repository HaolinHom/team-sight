import { main } from './main.mjs'
main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(error => {
  // Parser/native/network exceptions may contain secrets or config text. Print only our codes.
  const message = String(error?.message ?? '')
  console.error(/^([A-Z][A-Z_]+)(: [A-Za-z0-9 .;_<>/-]+)?$/.test(message) ? message : 'INSTALL_FAILED: inspect the protected local service logs; do not share credentials')
  process.exitCode = 1
})
