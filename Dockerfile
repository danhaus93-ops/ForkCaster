FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci: install EXACTLY what the lockfile records, and fail loudly if lock and manifest disagree
RUN npm ci --no-audit --no-fund
COPY index.html ./
COPY src ./src
COPY sw.js ./
COPY dist ./dist
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3450
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser PUPPETEER_SKIP_DOWNLOAD=1
# server needs ONLY these four at runtime; client deps live in the build stage.
# installed in a clean dir so npm can't resurrect the full tree from package.json.
# EXACT pins matching package-lock — a floating puppeteer-core major broke chromium flags is
# exactly the class of rebuild-time surprise this prevents
RUN npm install express@4.22.2 pdf-parse@1.1.1 puppeteer-core@25.3.0 web-push@3.6.7 --no-audit --no-fund
COPY package.json ./
COPY server ./server
COPY tools ./tools
COPY --from=build /app/dist ./dist
EXPOSE 3450
VOLUME ["/data"]
CMD ["node", "server/server.js"]
