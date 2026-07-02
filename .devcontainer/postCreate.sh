#!/bin/bash
set -euo pipefail

ROOT="${WORKSPACE_FOLDER:-$PWD}"

# Prevent interactive Corepack prompts in non-interactive devcontainer setup.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

resolve_user_home() {
	local user_home=""

	if command -v getent >/dev/null 2>&1; then
		user_home="$(getent passwd "${USER}" | cut -d: -f6)"
	fi

	if [[ -z "${user_home}" ]]; then
		user_home="${HOME}"
	fi

	echo "${user_home}"
}

configure_pnpm_store_dir() {
	local user_home
	user_home="$(resolve_user_home)"

	if [[ -z "${PNPM_STORE_DIR:-}" || "${PNPM_STORE_DIR}" == /Users/* ]]; then
		export PNPM_STORE_DIR="${user_home}/.local/share/pnpm/store"
	fi

	mkdir -p "${PNPM_STORE_DIR}"
}

configure_corepack_home() {
	local preferred_home="${HOME}/.local/share/corepack"

	# Some feature setups export COREPACK_HOME under /usr/local, which is not
	# writable for non-root users like vscode.
	if [[ -n "${COREPACK_HOME:-}" ]]; then
		mkdir -p "${COREPACK_HOME}" >/dev/null 2>&1 || true
	fi

	if [[ -z "${COREPACK_HOME:-}" || ! -w "${COREPACK_HOME}" ]]; then
		export COREPACK_HOME="${preferred_home}"
	fi

	mkdir -p "${COREPACK_HOME}"
}

detect_pm() {
	local pm=""

	if [[ -f "$ROOT/package.json" ]]; then
		if command -v jq >/dev/null 2>&1; then
			pm="$(jq -r '.packageManager // empty' "$ROOT/package.json" 2>/dev/null | cut -d'@' -f1)"
		elif command -v node >/dev/null 2>&1; then
			pm="$(node -e "const fs=require('node:fs'); try { const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write((pkg.packageManager||'').split('@')[0]); } catch {}" "$ROOT/package.json")"
		fi
	fi

	if [[ -n "$pm" ]]; then
		echo "$pm"
		return
	fi

	if [[ -f "$ROOT/pnpm-lock.yaml" ]]; then
		echo "pnpm"
	elif [[ -f "$ROOT/yarn.lock" ]]; then
		echo "yarn"
	elif [[ -f "$ROOT/bun.lock" || -f "$ROOT/bun.lockb" ]]; then
		echo "bun"
	elif [[ -f "$ROOT/package-lock.json" ]]; then
		echo "npm"
	else
		echo "npm"
	fi
}

ensure_pm_available() {
	local pm="$1"
	if command -v "$pm" >/dev/null 2>&1; then
		return
	fi

	if command -v corepack >/dev/null 2>&1; then
		case "$pm" in
			pnpm|yarn)
				echo "Enabling $pm via Corepack..."
				corepack enable
				corepack prepare "$pm@latest" --activate
				return
				;;
		esac
	fi

	case "$pm" in
		pnpm)
			echo "Installing pnpm globally..."
			npm install -g pnpm
			;;
		yarn)
			echo "Installing yarn globally..."
			npm install -g yarn
			;;
		bun)
			echo "bun is not installed. Add a bun feature or preinstall bun in the image."
			return 1
			;;
		npm)
			# npm ships with Node.js, so this should only happen if Node is missing.
			echo "npm is unavailable. Ensure Node.js feature installs successfully."
			return 1
			;;
		*)
			echo "Unsupported package manager: $pm"
			return 1
			;;
	esac
}

install_deps() {
	local pm="$1"
	echo "Installing dependencies with $pm..."

	case "$pm" in
		pnpm)
			mkdir -p "${PNPM_STORE_DIR}"
			pnpm config set --global store-dir "${PNPM_STORE_DIR}"
			pnpm install --config.confirmModulesPurge=false --store-dir "${PNPM_STORE_DIR}"
			;;
		yarn)
			yarn install
			;;
		bun)
			bun install
			;;
		npm)
			if [[ -f "$ROOT/package-lock.json" ]]; then
				npm ci
			else
				npm install
			fi
			;;
		*)
			echo "Unsupported package manager: $pm"
			return 1
			;;
	esac
}

PM="$(detect_pm)"
echo "Detected package manager: $PM"
configure_corepack_home
configure_pnpm_store_dir
echo "Using COREPACK_HOME: ${COREPACK_HOME}"
echo "COREPACK_ENABLE_DOWNLOAD_PROMPT=${COREPACK_ENABLE_DOWNLOAD_PROMPT}"
echo "PNPM_STORE_DIR=${PNPM_STORE_DIR}"
ensure_pm_available "$PM"
install_deps "$PM"

if command -v claude >/dev/null 2>&1; then
	echo "Registering Claude Code plugin marketplaces..."
	claude plugin marketplace add anthropics/claude-plugins-official
	claude plugin marketplace add spencerbeggs/bot
	claude plugin marketplace add savvy-web/systems
else
	echo "Claude CLI not found; skipping plugin marketplace registration."
fi

echo "Dev container setup complete."
