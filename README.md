# Allowlist API

CRUD + validación de usuarios (username, email, panelUrl, token) para integraciones con Mattermost/Cloudron.

## Run

```bash
docker compose up --build -d
# API_KEY por header: X-API-Key: mi-super-clave
```

### Endpoints
```
* GET /health
* GET /openapi.json

* POST /entries (upsert por email)
body: { "username": "...", "email": "...", "panelUrl": "https://my.demo...", "token": "..." }

* GET /entries?email=&username=&domain=&limit=&offset=
* GET /entries/:id
* PUT /entries/:id (campos parciales)
* DELETE /entries/:id
* GET /validate?email=&username= → { ok:true|false, match|reason }
```
### Seguridad
* Header X-API-Key obligatorio (excepto /health y /openapi.json).
* Opcional: cifrado de token con ENC_KEY (AES-256-GCM).

### Notas de rendimiento (SQLite)
- Habilitado WAL para múltiples lectores concurrentes.
- busy_timeout y synchronous=NORMAL para escrituras estables.
- Índices por username y dominio del correo.
- Writes siguen siendo serializadas; lecturas no bloquean lecturas.
---

### 🧪 Probar rápido

```bash
# crear/upsert
curl -s -XPOST http://localhost:8080/entries \
  -H 'X-API-Key: mi-super-clave' -H 'Content-Type: application/json' \
  -d '{"username":"root","email":"root@demo.cloudron.io","panelUrl":"https://my.demo.cloudron.io","token":"TOKEN_DEMO"}' | jq

# validar
curl -s "http://localhost:8080/validate?email=root@demo.cloudron.io&username=root" \
  -H 'X-API-Key: mi-super-clave' | jq
```

## 🔌 Integración n8n (mínima)

1. HTTP (Mattermost → get user/email)
2. Function (extraer email, username)
3. HTTP GET http://allowlist:8080/validate?email={{$json.email}}&username={{$json.username}}
   Header: X-API-Key: mi-super-clave
4. IF {{$json.ok}} → permitido; si no, bloquea.
> Esta ruta evita la trenza de merges y el error “Referenced node is unexecuted” que vimos en tus workflows previos.

## 📈 Siguientes mejoras opcionales
- Rate limiting (p. ej. express-rate-limit) si expones públicamente.
- Rotación de ENC_KEY con doble lectura (key actual + key anterior).
- Backups del volumen ./data.
- Endpoint POST /bulk para alta masiva.
- Filtro por dominio en /validate (si quieres forzar @empresa.com).
- Web UI súper simple (HTML) para CRUD manual.
