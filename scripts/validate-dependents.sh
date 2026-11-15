#!/bin/sh
# claude plugin validate runs no type check in a mod that declares `dependencies`
# (measured on 2.1.325: a planted type error passed). This script validates such a
# mod in a temporary copy that has no `dependencies`, holds each dependency's
# contract under types/<dependency>.d.ts and imports it as a type at the top of
# every hooks and tests file, which is what a consumer without the dependency does.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for manifest in "$root"/plugins/*/.claude-plugin/plugin.json; do
  deps=$(jq -r '.dependencies // [] | .[]' "$manifest")
  [ -n "$deps" ] || continue
  dir=$(dirname "$(dirname "$manifest")")
  mod=$(basename "$dir")
  copy="$work/$mod"
  mkdir "$copy"
  (cd "$dir" && tar -cf - --exclude node_modules --exclude .claude .) | (cd "$copy" && tar -xf -)
  jq 'del(.dependencies)' "$manifest" > "$copy/.claude-plugin/plugin.json.new"
  mv "$copy/.claude-plugin/plugin.json.new" "$copy/.claude-plugin/plugin.json"
  mkdir -p "$copy/types"
  for dep in $deps; do
    cp "$root/plugins/$dep/types/index.d.ts" "$copy/types/$dep.d.ts"
    for file in "$copy"/hooks/register.ts "$copy"/hooks/register.tsx "$copy"/tests/*.test.ts "$copy"/tests/*.test.tsx; do
      [ -f "$file" ] || continue
      { printf "import type {} from '../types/%s'\n" "$dep"; cat "$file"; } > "$file.new"
      mv "$file.new" "$file"
    done
  done
  echo "validating $mod without its dependencies ($deps)"
  claude plugin validate --strict "$copy"
done
