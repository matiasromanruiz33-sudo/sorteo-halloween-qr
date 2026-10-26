# Logs, reportes y auditoría del sistema

## Consulta

El organizador (`matiasromanruiz33@gmail.com`) dispone de la pestaña **Auditoría** en el menú principal. VMC conserva sus movimientos financieros por evento y Anderson conserva exclusivamente el escáner; ninguno puede leer la auditoría global.

1. Abre Auditoría y pulsa **Actualizar historial** para consultar los registros del servidor.
2. Filtra por fecha inicial/final en Ecuador, evento, usuario, módulo, resultado o texto (acción, ID, documento o descripción).
3. Abre **Ver detalle** para consultar el estado anterior y los campos modificados. Los cambios pueden agruparse por lote: por ejemplo, un sorteo incluye la lista de participantes ganadores y entradas creadas.
4. Usa **DESCARGAR PDF** o **DESCARGAR EXCEL (.XLSX)**. Se exporta todo el conjunto filtrado, no solo los 50 registros de la página visible.

Los datos se cargan por páginas del servidor sin un límite silencioso de registros. Si falla una consulta, no se permite exportar un resultado incompleto. Actualizar vuelve a cargar el conjunto; no elimina ni modifica datos.

## Cobertura

| Movimiento | Registro persistente |
| --- | --- |
| Creación, cambios y eliminación de eventos | `systemAudit`, en la misma transacción que el cambio |
| Alta, edición y eliminación de participantes | `systemAudit`, incluido el recuento modificado del evento |
| Sorteo y reinicio | `systemAudit`, con los documentos afectados y sin los códigos utilizables |
| Crear, editar, revocar, reactivar, regenerar y eliminar entradas | `systemAudit`, con log obligatorio |
| Canje QR autorizado | Actualización y log `qr.redeem` atómicos; no se duplican al reintentar la transacción |
| QR desconocido, revocado, usado o no coincidente | Actividad `qr.reject` informada por el usuario autenticado |
| Apertura de evento, consulta/descarga/copia QR y cámara | Actividad autenticada de la aplicación |
| Sesión iniciada o restaurada, cierre solicitado, verificación de correo | Actividad de sesión autenticada |
| Compras, ventas, devoluciones, inversiones, gastos, pagos, pérdidas, ajustes | Historial inmutable `financeEvents/{evento}/operations` ya existente |
| Cierre de caja | Historial inmutable `closures` con esperado, contado y diferencia |
| Configuración, asignación de eventos y permisos financieros | Historial `audit`; las modificaciones requieren una nueva entrada vinculada |
| Activar/desactivar al operador | `userAudit`, obligatorio en el mismo lote que el cambio de permiso |
| Subida de comprobante | Documento de comprobante inmutable; la auditoría muestra solo sus metadatos |
| Descarga de comprobante o reporte financiero | Actividad autenticada de descarga |
| Descarga de auditoría PDF/XLSX | Actividad `audit.export`, con formato, filtros y cantidad de registros |
| Errores de la interfaz o del registro financiero | Actividad de error del cliente autenticado, sin credenciales |

El log utiliza fecha/hora del servidor, UID y correo de la sesión. El perfil se valida con el UID; no se puede escribir un log como otro usuario. Los importes se muestran en USD y las fechas en `America/Guayaquil`.

## Integridad y alcance

- Los nuevos cambios de eventos, participantes y tickets requieren un log nuevo en Firestore. La escritura de datos y el log se confirman juntos; si el log no se guarda, la mutación no se confirma.
- Los estados anteriores de actualizaciones y eliminaciones se leen dentro de la misma transacción. Después se muestran los **campos enviados al cambio**, no una copia completa del documento posterior. Para incrementos se conserva el operador de incremento.
- Un lote comparte una entrada para no exceder los límites de evaluación de reglas de Firestore. Los documentos quedan enlazados mediante `auditId`. Los IDs de auditoría no alteran la generación ni validación de los QR existentes.
- El historial no admite edición o borrado por clientes, incluido el organizador. Borrar un evento no borra sus logs ni su historial financiero.
- Las operaciones financieras anteriores se consultan directamente desde su historial persistente; no se duplican ni se inventan fechas, responsables o acciones antiguas. Las acciones de eventos o sesiones que nunca tuvieron log no pueden reconstruirse retroactivamente.
- La aplicación no guarda contraseñas, tokens, claves, códigos QR utilizables, imágenes o contenido de comprobantes en los logs/exportaciones. Estos últimos se mantienen en sus documentos privados originales.
- Las sesiones, lecturas, descargas, errores y rechazos son **actividad reportada por la aplicación autenticada**. Su log es complementario: si no hay conexión, no se bloquea indefinidamente el cierre de sesión. El estado de sesión no es una prueba de que el navegador siga abierto.
- Los intentos fallidos **antes de autenticar**, las solicitudes rechazadas enviadas fuera de la aplicación y las acciones de la consola de Firebase no se convierten automáticamente en entradas de esta vista. No se habilitan escrituras anónimas de logs ni se simula un registro de esos sucesos. La auditoría de infraestructura corresponde a los registros del proveedor.

## Formatos de descarga

**PDF:** encabezado de Mirage, fecha de generación, filtros, tabla de movimientos, usuario/perfil, resultado y anexo de detalles antes/después. Los encabezados y pies se repiten al cambiar de página.

**Excel:** hojas **Resumen**, **Auditoría** y **Cambios y detalles**. Incluye encabezados, formatos USD, filtros y filas congeladas. Los detalles largos se dividen en partes de hasta 30.000 caracteres para respetar el límite de cada celda sin perder el resto del detalle.

Las descargas reflejan la consulta cargada y sus filtros. El log de la propia descarga se verá al actualizar el historial y no se añade retroactivamente al archivo que acaba de generarse.

## Pruebas y despliegue

`npm run test:finance` verifica integridad de logs, bloqueo de suplantación/edición/borrado, lotes de 200 participantes, permisos, filtros por fecha de Ecuador y privacidad. `npm run test:finance-ui` prueba el flujo de eventos/sorteo, finanzas, exportaciones completas con más de 250 registros, QR aceptado/rechazado y diseño móvil.

Publica el código actualizado junto con las reglas `firestore.rules`. Los clientes que tengan una pestaña antigua abierta deben recargar antes de registrar nuevas operaciones: las reglas exigirán los nuevos enlaces de auditoría. No hace falta regenerar QR, migrar participantes ni reescribir eventos existentes.
