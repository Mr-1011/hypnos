#!/bin/bash
# Hypnos: the three sensor programs, each started again if it exits, and the page.
#   ./run.sh          then open http://localhost:5300
#   ./run.sh --sim    the kit's pretend band in place of the real one
# Ctrl-C ends everything. A program that is restarted mid-night appends to its own recording.
cd "$(dirname "$0")" || exit 1
trap 'kill 0' EXIT
keep() {
  while true; do
    .venv/bin/python "$@"
    echo "run: $1 exited ($?), starting it again in 2 s"
    sleep 2
  done
}
keep sensors/live_muse.py &
keep sensors/live_polar.py &
keep sensors/live_band.py "$@" &
(cd dashboard && npm run dev) &
wait
