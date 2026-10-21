FROM node:24.22.1-bookworm-slim

RUN mkdir -p /app
WORKDIR /app
COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts

COPY index.js config.json ./

RUN groupadd -r app && useradd -r -g app app
USER app

ENTRYPOINT ["node", "index.js"]


