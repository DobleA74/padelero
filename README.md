# 🎾 Padelero

Ranking simple para una peña de pádel. Cargás resultados, arma el ranking solo, y te ayuda a organizar quién juega con quién en la cancha.

**En vivo:** https://padelero-tau.vercel.app

## Stack

- **Backend:** Express (Node, ESM)
- **Base de datos:** Turso (libSQL / SQLite en la nube), vía `@libsql/client`
- **Frontend:** HTML/CSS/JS vanilla, sin build step
- **Deploy:** Vercel (función serverless en `api/index.js`, mismo `app.js` que corre local)

## Cómo correrlo local

```bash
npm install
cp .env.example .env   # completar con tus credenciales de Turso
npm start
```

Abre en `http://localhost:3000`.

### Variables de entorno (`.env`)

| Variable | Para qué |
|---|---|
| `TURSO_DATABASE_URL` | URL de la base Turso (o `file:./local.db` para probar con SQLite local) |
| `TURSO_AUTH_TOKEN` | Token de auth de Turso (vacío si usás un archivo local) |
| `APP_PIN` | PIN compartido para poder agregar/editar/borrar jugadores y partidos. Si no está seteada, no se pide PIN (útil en dev) |

## Cómo se calcula el ranking

- Victoria 2-0 → 3 pts · Victoria 2-1 → 2 pts · Derrota 1-2 → 1 pt · Derrota 0-2 → 0 pts.
- Cada jugador suma según **su propio resultado**, sin importar con quién jugó ese partido puntual.
- La pareja con más victorias juntos en un mismo día suma **+2 pts extra cada uno** (si hay empate en victorias, no se otorga el bonus).
- Cada remate ganador por la reja de 3 o 4 metros suma **+1 pt** para quien lo hizo.
- El ranking es **global** (histórico completo) por default. Se puede filtrar por rango de fechas sin perder el histórico.

## Funcionalidades

- **Ranking** con % de victorias y racha actual (🔥 ganando / 🧊 perdiendo).
- **Mejores duplas**: parejas con más de 3 partidos juntas, ordenadas por % de victorias.
- **Filtro por fechas**: ranking, historial y duplas se pueden acotar a un rango, con vuelta a "global" en un click.
- **Ronda de hoy**: marcás quién está presente (queda guardado como asistencia real en la base, por fecha) y se arman las parejas iniciales balanceadas por ranking. La pareja que gana sigue en cancha con un **máximo de 2 partidos seguidos**; al llegar al tope, pasa al final de la cola junto con los que perdieron y se arma una pareja nueva balanceada. El estado de la ronda vive en el servidor, así que todos los celulares que tengan la app abierta ven la misma cancha/cola (se actualiza solo cada pocos segundos).
- **Editar** jugadores (renombrar) y partidos (corregir equipos, marcador, remates, fecha) sin tener que borrar y recargar.
- **Compartir por WhatsApp** el resultado de un partido con un click.
- **PIN compartido** para las acciones que modifican datos (agregar/editar/borrar jugador o partido); ver el ranking es siempre libre.
- Avatares con iniciales y color generados a partir del nombre.

## Estructura

```
app.js            Rutas Express + validaciones
db.js             Acceso a Turso (schema, queries)
rotation.js       Algoritmo de la "ronda de hoy" (parejas balanceadas, tope de 2 victorias)
server.js         Entry point para correr local
api/index.js      Entry point para Vercel (serverless)
public/           Frontend (index.html, app.js, style.css)
```

## Deploy

```bash
vercel --prod
```

El schema de la base (tablas `players`, `matches`, `attendance`, `rotation_state`) se crea solo la primera vez que la app recibe una request — no hace falta correr migraciones a mano. Si agregás una variable de entorno nueva (como `APP_PIN`), hay que cargarla también en Vercel:

```bash
vercel env add NOMBRE_VARIABLE production
```
