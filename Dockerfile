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
COPY package.json ./
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser PUPPETEER_SKIP_DOWNLOAD=1
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3450
VOLUME ["/data"]
CMD ["node", "server/server.js"]
