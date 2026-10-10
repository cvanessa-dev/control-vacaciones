# Control de vacaciones

> Proyecto de la clase **Implantación de Tecnología**.

Proyecto académico para consultar saldos de vacaciones del personal.
Usa HTML, CSS y JavaScript, con Supabase (PostgreSQL) como base de datos.

## Capturas

### Inicio de sesión
![Pantalla de inicio de sesión](img/captura-login.png)

### Resumen general (RRHH)
![Resumen general](img/captura-resumen-emple.png)

### Resumen general vista empleado
![Resumen general](img/captura-resumen.png)

### Solicitudes de vacaciones
![Solicitudes](img/captura-solicitudes.png)

## Modelo de base de datos

![Diagrama entidad-relación](img/diagrama-base-datos.png)

Tablas principales:

- `empleados`: datos del personal (código, puesto, departamento, fecha de ingreso, estado).
- `periodos_vacaciones`: días que corresponden por cada año de servicio.
- `solicitudes_vacaciones`: solicitudes de días, con estado y respuesta de RRHH.
- `movimientos_vacaciones`: historial de acumulaciones, disfrutes, anticipos y ajustes.
- `perfiles`: vincula cada usuario de Supabase Auth con su empleado y su rol.
- `suspensiones`: periodos en los que el empleado no acumula vacaciones.
- `reglas_antiguedad`: días por año según la antigüedad.
- `feriados`: días que no se descuentan al calcular una solicitud.

## Estructura

- `index.html`: la página
- `css/styles.css`: los estilos
- `js/config.js`: la conexión con Supabase (URL y llave publishable)
- `js/app.js`: la lógica de la página
- `img/`: imágenes del proyecto

## Cómo abrirlo

1. Descarga el repositorio.
2. Abre `index.html` en Chrome o Edge. Hace falta internet.
3. Inicia sesión con un usuario de prueba.

## Importante

- Los datos son ficticios.
- En `js/config.js` solo va la llave **publishable**. Nunca la llave secret ni service_role.
- Los saldos NO se calculan en la página. Los calcula la base de datos en la vista `saldos_vacaciones`.
- La seguridad está en la base de datos con Row Level Security. Cada colaborador solo ve sus datos.
