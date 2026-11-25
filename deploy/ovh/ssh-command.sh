#!/usr/bin/env bash
set -euo pipefail
mode="${1:-}"
case "$mode" in
  status) command=status ;;
  deploy)
    [[ "${2:-}" =~ ^[0-9a-f]{40}$ ]]
    test -f "${3:-}"
    command="deploy $2"
    ;;
  *) exit 2 ;;
esac

for port in 22 2222 22; do
  result=0
  if [ "$mode" = deploy ]; then
    ssh -T -p "$port" -o BatchMode=yes -o StrictHostKeyChecking=yes \
      -o ConnectTimeout=12 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
      -i ~/.ssh/ovh ubuntu@57.129.195.190 "$command" < "$3" || result=$?
  else
    ssh -T -p "$port" -o BatchMode=yes -o StrictHostKeyChecking=yes \
      -o ConnectTimeout=12 -i ~/.ssh/ovh ubuntu@57.129.195.190 "$command" || result=$?
  fi
  if [ "$result" = 0 ]; then exit 0; fi
  # Retry connection failures only. Application/receiver failures need review.
  if [ "$result" != 255 ]; then exit "$result"; fi
done
exit "$result"
