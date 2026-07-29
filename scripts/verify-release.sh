#!/usr/bin/env bash
set -euo pipefail

repository_root="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  pwd
)"
cd "$repository_root"

fail() {
  echo "RELEASE CHECK FAILED: $*" >&2
  exit 1
}

echo "Checking source file names and developer paths..."

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile_command=(git ls-files --cached --others --exclude-standard)
else
  mapfile_command=(
    find .
    -type f
    -not -path './node_modules/*'
    -not -path './dist/*'
    -not -name '*.backup'
  )
fi

source_files="$("${mapfile_command[@]}")"

if printf '%s\n' "$source_files" | rg -i \
  '(^|/)(memory|config|cloudsave|state|character_cards|card_faces)(/|$)|(^|/)(core_config|token_usage|facts|persona|recent)\.json$|\.db(-[^/]*)?$|\.sqlite3?$|\.jsonl$'
then
  fail "the source tree contains a runtime-data or memory file"
fi

text_files="$(
  printf '%s\n' "$source_files" |
    rg '\.(js|mjs|json|md|svg|ya?ml|sh)$' |
    rg -v '(^|/)package-lock\.json$' || true
)"

mac_home_prefix="/""Users/"
linux_home_prefix="/""home/"
windows_home_prefix="[A-Za-z]:\\\\U""sers\\\\"
developer_path_pattern="${mac_home_prefix}[^/[:space:]]+|${linux_home_prefix}[^/[:space:]]+|${windows_home_prefix}[^\\\\[:space:]]+"

if [[ -n "$text_files" ]] && printf '%s\n' "$text_files" |
  xargs rg -n --no-heading \
    "$developer_path_pattern" \
    --
then
  fail "a source file contains an absolute user home path"
fi

app_asar="$(
  find dist -type f -path '*/Contents/Resources/app.asar' \
    -print -quit 2>/dev/null || true
)"

[[ -n "$app_asar" ]] || fail "no packaged app.asar was found under dist/"

echo "Checking packaged app.asar allowlist..."

actual_asar_files="$(
  ./node_modules/.bin/asar list "$app_asar" |
    sed '/\/$/d' |
    sort
)"
expected_asar_files="$(
  printf '%s\n' \
    '/main.js' \
    '/package.json' \
    '/preload.js' |
    sort
)"

if [[ "$actual_asar_files" != "$expected_asar_files" ]]; then
  echo "Expected app.asar files:" >&2
  printf '%s\n' "$expected_asar_files" >&2
  echo "Actual app.asar files:" >&2
  printf '%s\n' "$actual_asar_files" >&2
  fail "packaged app.asar contains files outside the allowlist"
fi

echo "Checking build output for personal runtime data..."

if find dist -type f \( \
  -iname 'core_config.json' -o \
  -iname 'token_usage.json' -o \
  -iname 'facts.json' -o \
  -iname 'persona.json' -o \
  -iname 'recent.json' -o \
  -iname 'time_indexed.db' -o \
  -iname '*.jsonl' -o \
  -iname '*.sqlite' -o \
  -iname '*.sqlite3' \
  \) -print -quit | rg .
then
  fail "build output contains a personal runtime-data file"
fi

echo "Release privacy and package checks passed."
