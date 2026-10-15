# Gestión administrativa y financiera — Mirage

## Accesos

- **Organizador:** `matiasromanruiz33@gmail.com`. Mantiene Eventos, sorteos, QR y escáner; se agrega la pestaña **Gestión**.
- **Escáner:** `anderson.2008.cobos@gmail.com`. Conserva únicamente validación QR. No tiene acceso al módulo financiero.
- **Control operativo:** `vmc.ecuador@gmail.com`. Debe verificar el correo con el enlace de Firebase. Al ingresar abre Gestión y ve exclusivamente eventos asignados.

Las contraseñas se entregan por separado y no se guardan en el repositorio.

## Vinculación automática de eventos

1. El organizador crea el evento desde su sección habitual **Eventos**.
2. El evento y su espacio de gestión se guardan juntos, vinculado por defecto a **vmc.ecuador@gmail.com**.
3. VMC lo ve automáticamente al ingresar con el correo verificado; no necesita crear otro evento ni solicitar una asignación manual.
4. Desde **Gestión → Mis eventos → Configurar evento**, el organizador puede completar presupuesto, lugar, flyer, hora y estado, y autorizar descuentos o devoluciones.
5. El organizador puede retirar el acceso de VMC explícitamente. El inicio de sesión no revierte esa decisión. Los cambios posteriores de nombre y fecha desde Eventos se sincronizan con el mismo espacio financiero.

No se altera el sorteo, los participantes ni las entradas al vincular un evento existente. Las finanzas se guardan en `financeEvents/{eventId}`, enlazadas por el ID original. Los eventos anteriores sin espacio financiero se vinculan automáticamente al ingresar el organizador; los ya configurados conservan sus importes y permisos.

El selector superior muestra un evento o un resumen de todos los autorizados. Los formularios de registro requieren elegir un evento concreto. En **Configuración**, el organizador puede desactivar globalmente el perfil operativo y editar categorías y permisos por evento.

## Registrar operaciones

- **Inversiones:** aportes de capital efectivamente recibidos. No se cuentan como ventas ni utilidades.
- **Productos:** ficha con categoría, descripción, proveedor, imagen, precio de compra de referencia y precio de venta. Una cantidad inicial genera una compra y un movimiento de stock en una sola transacción.
- **Compras / entradas:** nuevas unidades con su costo unitario real. Se admiten precios distintos en cada compra y pagos completos, parciales o pendientes.
- **Movimientos:** pérdidas, daños, ajustes de entrada/salida y devoluciones a proveedores. Se exige motivo para ajustes y pérdidas. El historial se conserva.
- **Ventas:** selecciona producto, unidades, descuento autorizado y forma de pago. La cantidad se descuenta automáticamente y nunca puede superar el stock. Los botones de productos permiten venta rápida desde un celular.
- **Devoluciones / anulaciones:** reversión total de una venta, una sola vez, con motivo obligatorio y autorización por evento. Se reponen unidades y costo originales, y se registra el dinero devuelto en el método original. No se elimina la venta.
- **Gastos:** costo operativo total y cantidad pagada. El saldo se muestra como pendiente o parcial. Los pagos posteriores reducen la deuda sin sumar nuevamente el gasto.
- **Caja:** saldos separados para efectivo, transferencias, tarjeta y otros. Ingresos no comerciales y retiros no afectan el resultado económico. El cierre compara efectivo esperado y contado, preservando la diferencia. Un cierre no pone el saldo en cero ni ajusta automáticamente el efectivo; si corresponde una corrección real, registra el movimiento con su motivo.

Comprobantes PDF/PNG/JPG/WebP hasta 300 KB se guardan en documentos privados asociados al evento. Los flyers e imágenes pueden cargarse como archivos comprimidos por la aplicación o mediante URL HTTPS. Los comprobantes pueden descargarse desde el historial.

## Criterios de cálculo

Todos los importes se almacenan como **centavos enteros de USD**. Las horas se presentan en `America/Guayaquil` (Ecuador continental).

- **Ingresos netos:** ventas menos descuentos y devoluciones.
- **Costo vendido:** costo promedio ponderado del inventario al registrar cada venta, redondeado al centavo. En una devolución se resta el costo original de esa venta.
- **Resultado:** ingresos netos − costo vendido − gastos operativos devengados − pérdidas/daños/ajustes de salida.
- **Caja / fondos:** cobros reales y aportes menos pagos, devoluciones y retiros. El efectivo se calcula separadamente del resto de métodos.
- **Presupuesto restante:** presupuesto planificado − compras netas de inventario − gastos operativos registrados. Es un límite planificado, distinto del saldo de fondos y de la utilidad.
- **Inventario final:** suma de movimientos de unidades y valor. El precio de compra de referencia de una ficha no revaloriza existencias anteriores.

No registrar una compra de inventario otra vez como gasto operativo. El costo de compra se reconoce en la utilidad al vender o perder las unidades; el pago de compra sí sale de caja cuando se realiza.

Las entradas QR antiguas no contienen precios ni pagos: **no se inventan ni importan ingresos retroactivos**. Para contabilizar ingresos debes registrarlos expresamente en el módulo. El sistema de QR conserva sus registros y funcionamiento independiente.

## Reportes

**Reportes → aplicar filtros → descargar PDF / Excel**. Se puede limitar por evento, período contable, categoría y movimiento. Los registros de la tabla y exportaciones provienen del mismo conjunto filtrado.

- PDF con marca, eventos, resumen, inventario, inversiones/gastos, ventas, métodos de pago, cierres, gráficos y conclusión.
- XLSX con Resumen general, Productos e inventario, Ventas, Inversiones y compras, Gastos, Movimientos de caja, Resultados financieros, Auditoría y movimientos y Cierres de caja. Incluye formatos USD, filtros, encabezados, filas congeladas y fórmulas de resultados/totales.
- El inventario del reporte reconstruye stock inicial y final del período desde el historial completo de cada producto; se filtra por categoría, pero no por tipo de movimiento. El saldo inicial se presenta separado del flujo del período.
- Cada operación guarda tanto fecha contable como fecha/hora real de registro y usuario. Los costos se calculan en el orden real de registro; una fecha contable retroactiva no reescribe costos históricos.

## Integridad y permisos

Las reglas verifican el UID organizador, UID operativo, correo verificado, perfil activo y asignación del evento. El operador no puede acceder a eventos del sorteo, participantes o QR administrativos, cambiar el propietario, asignaciones ni presupuesto.

Una operación y sus efectos en producto, saldo por método y deuda se confirman atómicamente mediante transacción. Firestore verifica deltas y costos; no basta con manipular el JavaScript o enviar otra solicitud. Cada formulario tiene un identificador idempotente; reintentar no duplica operaciones. Los historiales financieros no admiten sobrescritura ni borrado desde clientes, ni siquiera por el organizador.

Las pruebas en emuladores comprueban concurrencia, sobreventa, reintentos, devoluciones, costo ponderado, pagos parciales, cierres, permisos, correo sin verificar, aislamiento del escáner, reportes y diseño móvil.
