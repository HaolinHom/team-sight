#!/usr/bin/env bash
# 通过 iTerm 执行命令，并把输出落盘，便于用户实时观察与后续取证。
#
# 用法:
#   scripts/iterm-run.sh <日志路径> <命令字符串>
#
# 说明:
#   - 命令在 iTerm 新建 tab 中执行（无窗口时先创建窗口）
#   - 输出通过 tee 写入日志文件，日志末尾附带 "__EXIT=<code>"
#   - 日志默认放在仓库之外，避免污染工作区
set -euo pipefail

LOG="${1:?用法: scripts/iterm-run.sh <日志路径> <命令字符串>}"
CMD="${2:?用法: scripts/iterm-run.sh <日志路径> <命令字符串>}"

mkdir -p "$(dirname "${LOG}")"

RUN_DIR="$(cd "$(dirname "${LOG}")" && pwd)"
RUN_ID="$(basename "${LOG}" .log)"
WRAPPER="${RUN_DIR}/${RUN_ID}.sh"

: > "${LOG}"

{
  echo '#!/usr/bin/env bash'
  echo 'set -o pipefail'
  printf 'cd %q\n' "${PWD}"
  printf '{ %s\n} 2>&1 | tee -a %q\n' "${CMD}" "${LOG}"
  printf 'echo "__EXIT=${PIPESTATUS[0]}" | tee -a %q\n' "${LOG}"
} > "${WRAPPER}"
chmod +x "${WRAPPER}"

osascript <<APPLESCRIPT
tell application "iTerm"
  activate
  if (count of windows) = 0 then
    create window with default profile
  else
    tell current window to create tab with default profile
  end if
  tell current session of current window
    write text "bash '${WRAPPER}'"
  end tell
end tell
APPLESCRIPT

echo "log=${LOG}"
echo "wrapper=${WRAPPER}"
echo "wait: until grep -q '^__EXIT=' ${LOG}"
