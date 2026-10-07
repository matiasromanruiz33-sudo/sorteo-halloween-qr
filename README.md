# Sorteo Nocturno

Panel privado y responsive para gestionar fiestas, realizar sorteos de entradas gratuitas, registrar entradas vendidas y validar códigos QR de un solo uso.

## Funciones

- Cuenta administradora única con acceso simultáneo desde varios dispositivos.
- CRUD de eventos, participantes y entradas vendidas.
- Sorteo aleatorio con generación automática de QR para ganadores.
- Entradas vendidas vinculadas a cada evento.
- Revocación y regeneración de códigos.
- Escáner autenticado con validación global en tiempo real.

## Desarrollo

```bash
npm install
npm run dev
```

## Firebase

El estado global se guarda en Cloud Firestore. La configuración pública de la aplicación está en `src/firebase-config.js` y las reglas restringidas al administrador están en `firestore.rules`.

```bash
npx firebase-tools deploy --only firestore:rules
```

## Publicación

Cada cambio enviado a la rama `main` se compila y publica automáticamente en GitHub Pages mediante `.github/workflows/deploy.yml`.
