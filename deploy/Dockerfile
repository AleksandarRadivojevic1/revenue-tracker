# revenue-tracker — single Node service: Express API + built Vite front-end,
# storing data in a SQLite file via Node's built-in `node:sqlite`.
#
# Build context is the REPO ROOT:
#   docker build -f deploy/Dockerfile -t revenue-tracker .
#
# There are NO native modules (node:sqlite is built into Node), so nothing is
# compiled and there is no glibc/prebuild arch trap — an x86 build is
# representative of the arm64 Pi. node:sqlite runs unflagged on node:24.

# --------------------------------------------------------------- build ------
FROM node:24-slim AS build
WORKDIR /app
# Do NOT set NODE_ENV=production here: npm ci would skip devDependencies (Vite),
# and it would shrink React into its dev build. Default env → full deps, and
# `vite build` compiles React in production mode (small, minified bundle).
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build          # → /app/dist (static front-end)

# ---------------------------------------------------------- prod deps -------
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev      # runtime needs only express

# ------------------------------------------------------------- runtime ------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=UTC

# Fixed uid so the read-write data mount can be reasoned about on the host.
# The compose file overrides this with the host account's uid anyway.
RUN useradd --uid 10003 --create-home --shell /usr/sbin/nologin revtracker

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./

USER revtracker
EXPOSE 3000

# DB_PATH / REV_BACKUP_DIR / REV_TRACKER_PASSWORD are supplied at run time.
CMD ["node", "server/index.js"]
