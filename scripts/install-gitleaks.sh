#!/bin/sh
# Explicitly invoked installer. No install occurs during npm install or application startup.
set -eu
version=8.30.1
destination=${1:?Usage: sh scripts/install-gitleaks.sh DESTINATION}
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) platform=linux_x64 ;;
  Linux/aarch64|Linux/arm64) platform=linux_arm64 ;;
  Darwin/arm64) platform=darwin_arm64 ;;
  Darwin/x86_64) platform=darwin_x64 ;;
  *) echo 'Unsupported secret scanner platform.' >&2; exit 1 ;;
esac
umask 077
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
asset="gitleaks_${version}_${platform}.tar.gz"
base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
download() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --max-redirs 3 --tlsv1.2 --retry 2 --max-time 60 "$base/$1" --output "$temporary/$1"
}
download "$asset"
download "gitleaks_${version}_checksums.txt"
awk -v asset="$asset" '$2 == asset && length($1) == 64 && $1 !~ /[^a-f0-9]/ { print; count++ } END { if (count != 1) exit 1 }' \
  "$temporary/gitleaks_${version}_checksums.txt" > "$temporary/selected.sha256"
(cd "$temporary" && shasum -a 256 -c selected.sha256)
tar -xzf "$temporary/$asset" -C "$temporary" gitleaks
test "$("$temporary/gitleaks" version)" = "$version"
mkdir -p "$destination"
install -m 755 "$temporary/gitleaks" "$destination/gitleaks"
