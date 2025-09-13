FROM node:20-alpine
WORKDIR /app

# Dependencias del sistema (opcional, por si compilas algo en el futuro)
RUN apk add --no-cache tini

COPY package.json ./
RUN npm ci --omit=dev

COPY src ./src

# volumen para la base de datos
VOLUME ["/app/data"]

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
