FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY index.html ./
COPY src ./src
COPY dist ./dist
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3450
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser PUPPETEER_SKIP_DOWNLOAD=1
# server needs ONLY these three at runtime; client deps live in the build stage.
# installed in a clean dir so npm can't resurrect the full tree from package.json
RUN npm install express@4 pdf-parse puppeteer-core --no-audit --no-fund
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3450
VOLUME ["/data"]
CMD ["node", "server/server.js"]
