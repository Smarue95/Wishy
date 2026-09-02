# Wishy — despliegue en Netlify (para no programadores)

Cambiamos de Vercel a Netlify porque el registro de Vercel se quedó
trabado con un error de su lado. Hace exactamente lo mismo.

## Paso 1: Sube el código a GitHub
1. Descomprime este zip en tu computador.
2. En github.com, crea un repositorio nuevo (por ejemplo `wishy`).
3. Usa la opción de "subir archivos existentes" y arrastra ahí toda la
   carpeta descomprimida (con las subcarpetas `netlify/` y `public/`
   incluidas). Dale **Commit changes**.

## Paso 2: Crear la base de datos en Upstash
Esto guarda la lista, el sorteo y las fechas del grupo.
1. Ve a upstash.com → **Sign Up** (puedes usar GitHub o correo).
2. Dale a **Create Database** → elige **Redis** → ponle un nombre y deja
   la región por defecto → **Create**.
3. En la página de tu base de datos, busca la sección **REST API** y
   copia dos valores: **UPSTASH_REDIS_REST_URL** y
   **UPSTASH_REDIS_REST_TOKEN**. Los vas a pegar en el Paso 4.

## Paso 3: Crear cuenta en Netlify y publicar el sitio
1. Ve a app.netlify.com → **Sign up** (con GitHub es lo más fácil).
2. Dale a **Add new site** → **Import an existing project** →
   **GitHub** → autoriza el acceso → elige tu repositorio `wishy`.
3. En la configuración de build, déjala tal cual viene (Netlify detecta
   `netlify.toml` automáticamente) → **Deploy site**.
4. En un par de minutos te da un link tipo
   `https://nombre-random.netlify.app`. Puedes cambiarle el nombre en
   **Site settings → Change site name**.

## Paso 4: Agregar las variables de entorno
1. En tu sitio en Netlify → **Site configuration** → **Environment
   variables** → **Add a variable**.
2. Agrega estas 4, una por una:
   - `KV_REST_API_URL` = el valor de UPSTASH_REDIS_REST_URL que copiaste
   - `KV_REST_API_TOKEN` = el valor de UPSTASH_REDIS_REST_TOKEN
   - `VAPID_PUBLIC_KEY` = (lo generas en el Paso 5)
   - `VAPID_PRIVATE_KEY` = (lo generas en el Paso 5)

## Paso 5: Generar las llaves de notificación
En una terminal de tu computador:
```
npx web-push generate-vapid-keys
```
Copia el **Public Key** y el **Private Key** que te muestra, y complétalos
en las dos variables que dejaste pendientes en el Paso 4.

## Paso 6: Volver a desplegar
En Netlify → pestaña **Deploys** → botón **Trigger deploy** →
**Deploy site**. Así toma las variables de entorno que acabas de agregar.

## Paso 7: Probar
1. Abre el link de tu sitio desde el celular.
2. Usa "Agregar a pantalla de inicio" en el navegador para que quede
   como ícono.
3. Entra a la pestaña **Endulzar**, dale **Activar** en notificaciones y
   acepta el permiso.
4. Todos los días a las 8:00 a.m. hora Colombia, el sistema revisa solo
   si a algún grupo le toca endulzar o revelar, y manda el aviso aunque
   nadie tenga la app abierta.

## Si algo no funciona
- Si la app no guarda nada: revisa que las variables `KV_REST_API_URL`
  y `KV_REST_API_TOKEN` estén bien copiadas desde Upstash (sin espacios).
- Si las notificaciones no llegan: confirma las dos variables VAPID y
  que hiciste "Trigger deploy" después de agregarlas.
- En iPhone, las notificaciones solo funcionan si la app está agregada
  a la pantalla de inicio (no sirve abierta solo en Safari) y con
  iOS 16.4 o más reciente — es una limitación de Apple.
- Si quieres cambiar la hora del aviso diario, edita en
  `netlify/functions/send-reminders.js` la línea con
  `schedule('0 13 * * *', ...)` (horario UTC; 13:00 UTC = 8:00 a.m.
  en Colombia).
