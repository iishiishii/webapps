#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(dirname "$script_dir")"
env_dir="${MUSCLEMAP_CONVERSION_ENV:-$app_dir/.tmp_model_env}"

if [[ ! -x "$env_dir/bin/python" ]]; then
  "$script_dir/setup_conversion_env.sh"
fi

"$env_dir/bin/python" "$script_dir/convert_model.py" \
  --model-id wholebody \
  --model-version 1.4 \
  --precision fp32 \
  "$@"
