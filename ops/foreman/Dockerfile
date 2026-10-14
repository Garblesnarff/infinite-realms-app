# Sandbox image for the #586 hands-off pilot (catjam-runner + realms-reviewer).
#
#   docker build --build-arg FOREMAN_UID="$(id -u foreman)" -t realms-foreman:pilot ops/foreman
#
# opencode and Claude Code live ONLY in this image, never on the host.
# Two identities inside the container:
#   root     - the controller (catjam-runner.sh / review.sh). Holds GH_TOKEN,
#              ANTHROPIC_API_KEY and SLACK_WEBHOOK_URL from --env-file. Runs
#              git/gh with an explicit root-owned GIT_DIR and never executes
#              repo code.
#   foreman  - same uid as the host user. Runs every piece of repo or model
#              code (bun install, opencode, typecheck, tests, claude -p) via
#              setpriv with a scrubbed environment. It cannot read root's
#              /proc/<pid>/environ or the root-only state dir.
FROM node:22-bookworm-slim

ARG FOREMAN_UID=1500
ARG GH_VERSION=2.74.0
ARG BUN_VERSION=1.3.4
ARG OPENCODE_VERSION=1.19.0
ARG CLAUDE_CODE_VERSION=2.1.299

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git jq util-linux procps unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /tmp \
 && install -m 755 "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh_*

RUN npm install -g "bun@${BUN_VERSION}" "opencode-ai@${OPENCODE_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

RUN useradd -o -u "${FOREMAN_UID}" -m -d /home/foreman -s /bin/bash foreman \
 && git config --system safe.directory '*' \
 && git config --system core.hooksPath /dev/null \
 && git config --system user.name 'catjam-runner' \
 && git config --system user.email 'catjam-runner@users.noreply.github.com'

COPY catjam-runner.sh review.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/catjam-runner.sh /usr/local/bin/review.sh

ENV FOREMAN_WORK=/work
WORKDIR /work
