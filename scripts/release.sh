#!/usr/bin/env bash
set -euo pipefail
v="${1:?usage: scripts/release.sh X.Y.Z}"
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='$v';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
sed -i.bak -E "s/^SAI_DEFAULT_VERSION=\"[^\"]+\"/SAI_DEFAULT_VERSION=\"$v\"/" install.sh && rm install.sh.bak
sed -i.bak -E "s/^\\\$defaultVersion = '[^']+'/\$defaultVersion = '$v'/" install.ps1 && rm install.ps1.bak
sed -i.bak -E "s#/v[0-9]+\.[0-9]+\.[0-9]+/install\.#/v$v/install.#g" install.sh install.ps1 README.md 2>/dev/null; rm -f install.sh.bak install.ps1.bak README.md.bak
bunx vitest run
git add -A && git commit -m "chore(release): v$v" && git tag "v$v"
echo "tagged v$v; push with: git push && git push --tags"
