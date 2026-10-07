# Sorteo Nocturno

Aplicación web responsive para crear participantes, generar pases QR únicos y validar cada pase una sola vez desde cualquier dispositivo.

## Desarrollo

```bash
npm install
npm run dev
```

## Firebase

El estado global se guarda en Cloud Firestore. La configuración pública de la aplicación está en `src/firebase-config.js` y las reglas de seguridad están en `firestore.rules`.

```bash
npx firebase-tools deploy --only firestore:rules
```

## Publicación

Cada cambio enviado a la rama `main` se compila y publica automáticamente en GitHub Pages mediante `.github/workflows/deploy.yml`.
