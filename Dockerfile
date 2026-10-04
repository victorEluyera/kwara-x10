# ---------- build the React client ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
RUN npm ci && npm ci --prefix client

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# /data is where a persistent volume should be mounted. Without one the
# uploaded files are ephemeral. PostgreSQL is configured through DATABASE_URL.
RUN mkdir -p /data/uploads
ENV KWARA_UPLOADS=/data/uploads
ENV PORT=4000

EXPOSE 4000
CMD ["node", "server/index.js"]
