#!/bin/bash
# BotPress control. Runs inside Ubuntu-24.04 as user rakazo (used by BotPress.exe; also usable by hand):
#   wsl -d Ubuntu-24.04 -- bash /mnt/d/botpress/botpress.sh status|start|revive|stop|logs [service]|backup|newsdesk
# Rakazo itself is rakazo.sh (shared with BotTeam); this wraps it and adds the "botpress-newsdesk" container: the news-desk
# MCP server, living in rakazo-worker-1's network namespace so the bots reach it at http://localhost:7790/mcp.
# newsdesk = only the ensure step; it also runs on every status poll (BotPress.exe asks every 3 s), so a worker that restarted in
# place heals within seconds. A failing newsdesk never fails start/revive/status: Rakazo must still come up.
set -u
ND=botpress-newsdesk
IMAGE=ghcr.io/elie222/rakazo/app:v0.1.6

# a recreated worker (new id) or one restarted in place (same id, new StartedAt) leaves ND on a dead namespace ->
# recreate unless it runs, is joined to this worker id and was started after it (same test rakazo.sh uses for memhub-proxy)
newsdesk() {
  read -r w ws wr <<<"$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.State.Running}}' rakazo-worker-1 2>/dev/null)"
  [ "$wr" = true ] || return 0 # no worker or Rakazo stopped: nothing to join ("docker run --network container:" would fail on every poll)
  read -r m ms r <<<"$(docker inspect -f '{{.HostConfig.NetworkMode}} {{.State.StartedAt}} {{.State.Running}}' $ND 2>/dev/null)"
  [ "$m" = "container:$w" ] && [ "$r" = true ] && [[ "$ms" > "$ws" ]] && return 0
  docker rm -f $ND >/dev/null 2>&1
  mkdir -p /mnt/d/botpress/news # else docker creates it root-owned and the news desk (uid 1000) cannot write
  docker run -d --pull never --name $ND --restart unless-stopped --network container:rakazo-worker-1 --user 1000:1001 \
    -e NEWS_DIR=/news --entrypoint node -v /mnt/d/botpress/newsdesk:/app:ro -v /mnt/d/botpress/news:/news \
    $IMAGE /app/server.mjs >/dev/null || echo "WARN newsdesk: docker run failed"
  return 0
}

cmd=${1:-status}
case "$cmd" in
  newsdesk) newsdesk; exit 0 ;;
  status|start|revive|stop|logs|backup) ;;
  *) echo "usage: botpress.sh status|start|revive|stop|logs [service]|backup|newsdesk"; exit 2 ;;
esac
bash /mnt/d/localai/botadmin/rakazo.sh "$@"; rc=$?
case "$cmd" in
  start|revive) newsdesk ;;
  # after Rakazo, not before: stopped first, a status poll (which re-ensures) would recreate it while the worker is still going down
  stop) docker stop $ND >/dev/null 2>&1 ;;
  status) newsdesk; s=$(docker inspect -f '{{.State.Status}}' $ND 2>/dev/null); echo "NEWSDESK ${s:-missing}" ;; # prints an empty line when missing
esac
exit $rc
