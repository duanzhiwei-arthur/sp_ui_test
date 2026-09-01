#!/bin/zsh

set -euo pipefail

readonly repository="${GITHUB_REPOSITORY:-duanzhiwei-arthur/sp_ui_test}"
readonly workflow="${GITHUB_WORKFLOW_FILE:-ui-regression.yml}"
readonly branch="${GITHUB_REF_NAME:-main}"
readonly mode="${SCHEDULED_TEST_MODE:-all}"
readonly gh_cli="${GH_CLI_PATH:-/opt/homebrew/bin/gh}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] $*"
}

if [[ "$mode" != "safe" && "$mode" != "all" ]]; then
  log "SCHEDULED_TEST_MODE 仅支持 safe 或 all，当前值：$mode"
  exit 2
fi

if [[ ! -x "$gh_cli" ]]; then
  log "找不到 GitHub CLI：$gh_cli"
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  "$gh_cli" auth status --hostname github.com
  "$gh_cli" workflow view "$workflow" --repo "$repository" --ref "$branch" --yaml >/dev/null
  log "远端触发配置检查通过：$repository / $workflow / $branch / mode=$mode"
  exit 0
fi

if [[ "${1:-}" != "--force" ]]; then
  readonly weekday="$(date '+%u')"
  readonly current_minutes="$((10#$(date '+%H') * 60 + 10#$(date '+%M')))"
  readonly morning_start="$((11 * 60))"
  readonly evening_start="$((18 * 60 + 30))"
  readonly dispatch_window_minutes=15

  if (( weekday > 5 )) || ! (
    (( current_minutes >= morning_start && current_minutes < morning_start + dispatch_window_minutes )) ||
    (( current_minutes >= evening_start && current_minutes < evening_start + dispatch_window_minutes ))
  ); then
    log "当前不在工作日 11:00/18:30 后 ${dispatch_window_minutes} 分钟的触发窗口内，跳过补触发。"
    exit 0
  fi
fi

log "触发远端 UI 自动化：$repository / $workflow / $branch / mode=$mode"
for attempt in 1 2 3; do
  if "$gh_cli" workflow run "$workflow" \
    --repo "$repository" \
    --ref "$branch" \
    --field mode="$mode" \
    --field simulate_failure_record=false; then
    log "远端 workflow_dispatch 已提交。"
    exit 0
  fi

  log "第 $attempt 次提交失败。"
  if (( attempt < 3 )); then
    sleep 15
  fi
done

log "远端 workflow_dispatch 连续 3 次提交失败。"
exit 1
