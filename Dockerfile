FROM node:20-alpine
WORKDIR /app

# utilería mínima
RUN apk add --no-cache tini

# copia package.json y (si existiera) package-lock.json
COPY package*.json ./

# ✔ instala dependencias de producción sin requerir lockfile preexistente
RUN npm install --omit=dev --no-audit --no-fund

# copia el código
COPY src ./src

# volumen para la base de datos
VOLUME ["/app/data"]

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
