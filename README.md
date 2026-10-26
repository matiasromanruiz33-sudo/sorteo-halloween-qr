# Sorteo Nocturno

Panel privado y responsive para gestionar fiestas, realizar sorteos de entradas gratuitas, registrar entradas vendidas y validar códigos QR de un solo uso.

## Funciones

- Cuenta organizadora con acceso simultáneo desde varios dispositivos y perfil exclusivo de escaneo.
- CRUD de eventos, participantes y entradas vendidas.
- Sorteo aleatorio con generación automática de QR para ganadores.
- Entradas vendidas vinculadas a cada evento.
- Revocación y regeneración de códigos.
- Escáner autenticado con validación global en tiempo real.
- Módulo integrado **Gestión**: inventario, compras, ventas, inversiones, gastos, pagos y caja por evento.
- Perfil operativo verificado con asignaciones y permisos financieros controlados desde Firestore.
- Auditoría inmutable, estadísticas y exportaciones PDF/XLSX. Ver [guía financiera](docs/gestion-financiera.md).
- Auditoría central del sistema para el organizador: logs de eventos, participantes, sorteos, QR, sesiones, permisos y movimientos financieros, con filtros y descargas PDF/Excel. Ver [guía de auditoría](docs/auditoria.md).

## Desarrollo

```bash
npm install
npm run dev
```

## Firebase

El estado global se guarda en Cloud Firestore. La configuración pública está en `src/firebase-config.js`. `firestore.rules` conserva los permisos originales de organizador/escáner y añade acceso financiero por usuario verificado y evento asignado.

```bash
npx firebase-tools deploy --only firestore:rules
```

## Publicación

Cada cambio enviado a la rama `main` se compila y publica automáticamente en GitHub Pages mediante `.github/workflows/deploy.yml`.

Las reglas de Firestore se despliegan por separado con el comando anterior.

## Pruebas de gestión

Requieren Java 21+ para el emulador y Chrome para la prueba de interfaz (`CHROME_PATH` permite indicar otra ruta).

```bash
npm run check
npm run build
npm run test:finance
npm run test:finance-ui
npm audit --omit=dev
```

Las pruebas usan el proyecto ficticio `demo-mirage-finance` y datos efímeros; no escriben en producción. Para desarrollar contra los emuladores usa `VITE_USE_EMULATORS=true` con `npm run dev`. Esta conexión está deshabilitada en compilaciones de producción.
