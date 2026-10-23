FROM diygod/rsshub:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libxfixes3 && rm -rf /var/lib/apt/lists/*
# Base image prunes the Playwright CLI; install the matching version before downloading Chromium.
RUN npm install -g playwright@1.60.0 && playwright install chromium
RUN mkdir -p /home/node/.cache && cp -r /root/.cache/ms-playwright /home/node/.cache/ && chown -R node:node /home/node/.cache
USER node
