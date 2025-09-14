FROM node:20-alpine
WORKDIR /app

# utilería mínima
RUN apk add --no-cache tini

# copia package.json y (si existiera) package-lock.json
COPY package*.json ./

# ✔ instala dependencias de producción sin requerir lockfile preexistente
RUN npm install --omit=dev --no-audit --no-fund

# ✅ Descarga Redoc al build (offline en runtime)
RUN mkdir -p public/redoc \
 && curl -fsSL https://cdn.redoc.ly/redoc/stable/bundles/redoc.standalone.js \
    -o public/redoc/redoc.standalone.js

# 👇 esta línea para incluir el spec
COPY openapi.yaml ./

# copia el código
COPY src ./src
COPY public ./public

# volumen para la base de datos
VOLUME ["/app/data"]

ENV NODE_ENV=production

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/sbin/tini","-g","--"]
CMD ["npm", "start"]
