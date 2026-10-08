// Control de vacaciones - lógica de la página
// Todo el cálculo de saldos lo hace la base de datos (vista saldos_vacaciones).
// Aprobar o rechazar solicitudes también lo hace la base de datos (funciones aprobar_solicitud y rechazar_solicitud).
// Esta página solo consulta, envía solicitudes y muestra los datos.

// Control de vacaciones - lógica de la página
// Todo el cálculo de saldos lo hace la base de datos (vista saldos_vacaciones).
// Aprobar o rechazar solicitudes también lo hace la base de datos (funciones aprobar_solicitud y rechazar_solicitud).
// Esta página solo consulta, envía solicitudes y muestra los datos.

(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // Diccionarios de constantes
  const TIPOS = {
    acumulacion: 'Acumulación',
    disfrute: 'Disfrute',
    anticipo: 'Anticipo',
    proporcional: 'Proporcional',
    ajuste: 'Ajuste'
  };

  const ROLES = {
    administrador: 'Administrador',
    gerente_rrhh: 'Gerente de RRHH',
    gerente_operaciones: 'Gerente de Operaciones',
    rrhh: 'RRHH',
    colaborador: 'Colaborador'
  };

  const ESTADOS = {
    activo: 'Activo',
    suspendido: 'Suspendido',
    renuncio: 'Renunció',
    despedido: 'Despedido'
  };

  const ESTADOS_SOLICITUD = {
    pendiente: 'Pendiente',
    aprobada: 'Aprobada',
    rechazada: 'Rechazada'
  };

  // Roles que pueden VER y REGISTRAR empleados
  const ROLES_STAFF = ['administrador', 'gerente_rrhh', 'rrhh'];

  // Variables globales
  let db = null;
  let perfil = null;
  let saldos = [];
  let empleados = [];
  let empleadoActualId = null;
  let misSolicitudes = [];
  let editandoId = null;

  // ============ FUNCIONES DE CÁLCULO ============

  /**
   * Calcula los días de vacaciones según antigüedad
   * 1 año: 10 días
   * 2 años: 12 días
   * 3 años: 15 días
   * 4+ años: 20 días
   */
  function diasPorAntiguedad(aniosCompletos) {
    const reglas = [
      { anios: 1, dias: 10 },
      { anios: 2, dias: 12 },
      { anios: 3, dias: 15 },
      { anios: 4, dias: 20 }
    ];

    if (aniosCompletos >= 4) return 20;
    const regla = reglas.find(r => r.anios === aniosCompletos);
    return regla ? regla.dias : 0;
  }

  /**
   * Calcula los días proporcionales para empleados que aún no cumplen 1 año
   */
  function diasProporcionales(fechaIngreso, fechaCorte) {
    const aniosCompletos = calcularAniosCompletos(fechaIngreso, fechaCorte);
    const diasAnio = diasPorAntiguedad(aniosCompletos + 1);
    const mesesTrabajados = calcularMesesTrabajados(fechaIngreso, fechaCorte);
    return Math.round((mesesTrabajados / 12) * diasAnio * 100) / 100;
  }

  /**
   * Calcula cuántos años completos ha trabajado un empleado
   */
  function calcularAniosCompletos(fechaIngreso, fechaCorte) {
    const ingreso = new Date(fechaIngreso);
    const corte = new Date(fechaCorte);
    let anios = corte.getFullYear() - ingreso.getFullYear();

    if (
      corte.getMonth() < ingreso.getMonth() ||
      (corte.getMonth() === ingreso.getMonth() && corte.getDate() < ingreso.getDate())
    ) {
      anios--;
    }
    return anios;
  }

  /**
   * Calcula cuántos meses completos ha trabajado un empleado
   */
  function calcularMesesTrabajados(fechaIngreso, fechaCorte) {
    const ingreso = new Date(fechaIngreso);
    const corte = new Date(fechaCorte);
    let meses = (corte.getFullYear() - ingreso.getFullYear()) * 12;
    meses += corte.getMonth() - ingreso.getMonth();

    if (corte.getDate() < ingreso.getDate()) {
      meses--;
    }
    return Math.max(meses, 0);
  }

  /**
   * Cuenta días hábiles (L-V) entre dos fechas (sin contar feriados)
   */
  function diasHabiles(inicio, fin) {
    if (!inicio || !fin || fin < inicio) return 0;

    const actual = new Date(inicio + 'T00:00:00');
    const limite = new Date(fin + 'T00:00:00');
    let total = 0;
    let iteraciones = 0;

    while (actual <= limite && iteraciones < 400) {
      const dia = actual.getDay();
      // 0 = domingo, 6 = sábado
      if (dia !== 0 && dia !== 6) {
        total++;
      }
      actual.setDate(actual.getDate() + 1);
      iteraciones++;
    }
    return total;
  }

  // ============ FUNCIONES DE UTILIDADES ============

  /**
   * Escapa caracteres HTML especiales para evitar XSS
   */
  function esc(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Formatea números según configuración regional (es-HN)
   */
  function num(valor) {
    return Number(valor).toLocaleString('es-HN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  /**
   * Convierte fecha YYYY-MM-DD a DD/MM/YYYY
   */
  function fecha(valor) {
    if (!valor) return '-';
    const partes = String(valor).split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : valor;
  }

  /**
   * Suma valores de un campo en una lista de objetos
   */
  function suma(lista, campo) {
    return lista.reduce((total, item) => total + Number(item[campo] || 0), 0);
  }

  /**
   * Obtén el empleado de un objeto de saldo (maneja nesting)
   */
  function obtenerEmpleado(saldo) {
    if (!saldo) return null;
    return Array.isArray(saldo.empleados) ? saldo.empleados[0] : saldo.empleados;
  }

  /**
   * Verifica si el usuario es staff (Admin, Gerente RRHH, RRHH)
   */
  function esStaff() {
    return perfil && ROLES_STAFF.includes(perfil.rol);
  }

  /**
   * Verifica si el usuario es Gerente de Operaciones
   */
  function esGerenteOperaciones() {
    return perfil && perfil.rol === 'gerente_operaciones';
  }

  /**
   * Verifica si el usuario puede resolver solicitudes
   */
  function puedeResolver() {
    return esStaff() || esGerenteOperaciones();
  }

  // ============ FUNCIONES DE PANTALLAS ============

  function mostrarLogin(mensaje) {
    $('app-view').hidden = true;
    $('login-view').hidden = false;
    mostrarError(mensaje || '');
  }

  function mostrarApp() {
    $('login-view').hidden = true;
    $('app-view').hidden = false;
  }

  function mostrarError(mensaje) {
    const caja = $('login-error');
    caja.textContent = mensaje;
    caja.hidden = !mensaje;
  }

  function mensajeSolicitud(texto, esError) {
    const caja = $('sol-msg');
    caja.textContent = texto || '';
    caja.className = 'msg' + (esError ? ' error' : '');
    caja.hidden = !texto;
  }

  function mensajeEmpleado(texto, esError) {
    const caja = $('emp-msg');
    caja.textContent = texto || '';
    caja.className = 'msg' + (esError ? ' error' : '');
    caja.hidden = !texto;
  }

  // ============ INICIALIZACIÓN ============

  function iniciar() {
    const botonLogin = $('login-form').querySelector('button[type="submit"]');

    // Validar que Supabase esté cargado
    if (!window.supabase) {
      mostrarError('No se pudo cargar la librería de Supabase. Revisa tu conexión a internet.');
      botonLogin.disabled = true;
      return;
    }

    // Validar que las claves estén configuradas
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY || String(cfg.SUPABASE_KEY).indexOf('PEGA_AQUI') === 0) {
      mostrarError('Falta pegar la llave publishable de Supabase en js/config.js');
      botonLogin.disabled = true;
      return;
    }

    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

    // Evento: mostrar/ocultar contraseña
    $('btn-ver-pass').addEventListener('click', function () {
      const campo = $('password');
      campo.type = campo.type === 'password' ? 'text' : 'password';
    });

    // Recordar usuario
    const guardado = localStorage.getItem('usuario_recordado');
    if (guardado) {
      $('email').value = guardado;
      $('recordar').checked = true;
    }

    // Eventos del login
    $('login-form').addEventListener('submit', alEnviarLogin);
    $('btn-salir').addEventListener('click', alSalir);
    $('btn-volver').addEventListener('click', () => mostrarEmpleado(perfil.empleado_id));

    // Eventos de solicitud de vacaciones
    $('sol-inicio').addEventListener('change', recalcularDias);
    $('sol-fin').addEventListener('change', recalcularDias);
    $('form-solicitud').addEventListener('submit', guardarSolicitud);
    $('sol-cancelar').addEventListener('click', salirDeEdicion);
    $('tabla-solicitudes').querySelector('tbody').addEventListener('click', alClicMisSolicitudes);
    $('tabla-pendientes').querySelector('tbody').addEventListener('click', alClicPendientes);

    // Eventos de filtros
    if ($('filtro-estado')) {
      $('filtro-estado').addEventListener('change', () => dibujarResumen());
    }
    if ($('filtro-departamento')) {
      $('filtro-departamento').addEventListener('change', () => dibujarResumen());
    }

    // Eventos de empleado (solo staff)
    if ($('btn-nuevo-empleado')) {
      $('btn-nuevo-empleado').addEventListener('click', function () {
        const panel = $('panel-nuevo-empleado');
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    if ($('form-empleado')) {
      $('form-empleado').addEventListener('submit', guardarEmpleado);
    }
    if ($('emp-cancelar')) {
      $('emp-cancelar').addEventListener('click', function () {
        $('form-empleado').reset();
        mensajeEmpleado('');
        $('panel-nuevo-empleado').hidden = true;
      });
    }

    // Verificar sesión actual
    db.auth.getSession().then((respuesta) => {
      if (respuesta.data.session) {
        entrar();
      } else {
        mostrarLogin();
      }
    });
  }

  // ============ AUTENTICACIÓN ============

  async function alEnviarLogin(evento) {
    evento.preventDefault();
    mostrarError('');
    const boton = evento.target.querySelector('button[type="submit"]');
    boton.disabled = true;

    const correo = $('email').value.trim();
    const respuesta = await db.auth.signInWithPassword({
      email: correo,
      password: $('password').value
    });

    boton.disabled = false;
    if (respuesta.error) {
      mostrarError('Correo o contraseña incorrectos.');
      return;
    }

    // Guardar o eliminar usuario recordado
    if ($('recordar').checked) {
      localStorage.setItem('usuario_recordado', correo);
    } else {
      localStorage.removeItem('usuario_recordado');
    }

    $('password').value = '';
    entrar();
  }

  async function alSalir() {
    await db.auth.signOut();
    perfil = null;
    saldos = [];
    empleados = [];
    misSolicitudes = [];
    empleadoActualId = null;
    salirDeEdicion();
    mostrarLogin();
  }

  // ============ CARGA DE DATOS ============

  async function entrar() {
    const usuario = (await db.auth.getUser()).data.user;
    if (!usuario) {
      mostrarLogin();
      return;
    }

    const respuesta = await db
      .from('perfiles')
      .select('rol, empleado_id, empleados(codigo, nombre, departamento)')
      .eq('usuario_id', usuario.id)
      .maybeSingle();

    if (respuesta.error || !respuesta.data) {
      await db.auth.signOut();
      mostrarLogin('Tu usuario no tiene un perfil asignado. Pide al administrador que lo configure.');
      return;
    }

    perfil = respuesta.data;
    const emp = Array.isArray(perfil.empleados) ? perfil.empleados[0] : perfil.empleados;

    // Mostrar datos del usuario
    $('user-nombre').textContent = emp ? emp.nombre : usuario.email;
    $('user-rol').textContent = ROLES[perfil.rol] || perfil.rol;

    // Mostrar paneles según rol
    $('panel-staff').hidden = !esStaff();
    $('panel-pendientes').hidden = !puedeResolver();
    $('ayuda-pendientes').hidden = !esGerenteOperaciones();
    $('panel-nuevo-empleado').hidden = true;

    empleadoActualId = perfil.empleado_id;
    mostrarApp();
    await refrescarTodo();
  }

  /**
   * Recarga todos los datos necesarios
   */
  async function refrescarTodo() {
    await cargarSaldos();
    await Promise.all([
      cargarMisSolicitudes(),
      puedeResolver() ? cargarPendientes() : Promise.resolve()
    ]);
    await mostrarEmpleado(empleadoActualId || perfil.empleado_id);
  }

  /**
   * Carga los saldos de vacaciones de todos los empleados
   */
async function cargarSaldos() {
  const [respSaldos, respEmpleados] = await Promise.all([
    db.from('saldos_vacaciones').select('*').order('nombre'),
    db.from('empleados').select('id, puesto, departamento, fecha_ingreso, fecha_salida')
  ]);

  saldos = respSaldos.data || [];
  const empleadosList = respEmpleados.data || [];

  // Mezclar puesto/departamento/fechas en cada saldo, por empleado_id
  const porId = {};
  empleadosList.forEach(function (e) { porId[e.id] = e; });

  saldos.forEach(function (s) {
    const e = porId[s.empleado_id];
    if (e) {
      s.puesto = e.puesto;
      s.departamento = e.departamento;
      s.fecha_ingreso = e.fecha_ingreso;
      s.fecha_salida = e.fecha_salida;
    }
  });

  llenarFiltroDepartamentos();
  dibujarResumen();
 }

  /**
   * Llena el select de departamentos con los valores únicos
   */
  function llenarFiltroDepartamentos() {
  const select = $('filtro-departamento');
  if (!select) return;

  const seleccionado = select.value;
  const departamentos = saldos
    .map(function (s) { return s.departamento; })
    .filter(function (d) { return !!d; });
  const unicos = [...new Set(departamentos)].sort();

  select.innerHTML = '<option value="">Todos</option>' +
    unicos.map(function (d) { return `<option value="${esc(d)}">${esc(d)}</option>`; }).join('');

  select.value = unicos.includes(seleccionado) ? seleccionado : '';
  }

  // ============ EMPLEADOS (STAFF) ============

  /**
   * Guarda un nuevo empleado en la BD
   */
  async function guardarEmpleado(evento) {
    evento.preventDefault();
    mensajeEmpleado('');

    const datos = {
      codigo: $('emp-codigo').value.trim(),
      nombre: $('emp-nombre').value.trim(),
      puesto: $('emp-puesto').value.trim(),
      departamento: $('emp-departamento').value.trim(),
      fecha_ingreso: $('emp-ingreso').value,
      tipo_pago: $('emp-tipo-pago').value,
      estado: 'activo'
    };

    // Validar campos obligatorios
    if (!datos.codigo || !datos.nombre || !datos.fecha_ingreso) {
      mensajeEmpleado('Código, nombre y fecha de ingreso son obligatorios.', true);
      return;
    }

    const boton = $('emp-guardar');
    boton.disabled = true;

    const respuesta = await db.from('empleados').insert(datos).select();

    boton.disabled = false;

    if (respuesta.error) {
      if (String(respuesta.error.message).toLowerCase().includes('duplicate')) {
        mensajeEmpleado('Ya existe un empleado con ese código.', true);
      } else {
        mensajeEmpleado(`No se pudo registrar: ${respuesta.error.message}`, true);
      }
      return;
    }

    $('form-empleado').reset();
    mensajeEmpleado('Empleado registrado correctamente. Recuerda crearle su usuario de acceso y vincularlo en perfiles.');
    await refrescarTodo();
  }

  /**
   * Muestra los datos de un empleado específico
   */
  async function mostrarEmpleado(empleadoId) {
    empleadoActualId = empleadoId;
    resaltarFila();

    const saldo = saldos.find(s => s.empleado_id === empleadoId);
    const esPropio = empleadoId === perfil.empleado_id;

    // Actualizar títulos
    $('titulo-empleado').textContent = esPropio ? 'Mis vacaciones' : (saldo ? saldo.nombre : 'Empleado');
    $('subtitulo-empleado').textContent = saldo
      ? `Código ${saldo.codigo} - Estado: ${ESTADOS[saldo.estado] || saldo.estado}${saldo.puesto ? ` - ${saldo.puesto}` : ''}${saldo.departamento ? ` (${saldo.departamento})` : ''}`
      : '';

    // Mostrar/ocultar secciones
    $('btn-volver').hidden = esPropio;
    $('seccion-solicitudes').hidden = !esPropio;

    // Dibujar tarjetas de resumen
    dibujarTarjetas(saldo);

    // Cargar períodos y movimientos
    const [respPeriodos, respMovimientos] = await Promise.all([
      db
        .from('periodos_vacaciones')
        .select('id, anio_servicio, fecha_inicio, fecha_fin, dias_corresponden')
        .eq('empleado_id', empleadoId)
        .order('anio_servicio'),
      db
        .from('movimientos_vacaciones')
        .select('id, periodo_id, fecha, tipo, dias, motivo')
        .eq('empleado_id', empleadoId)
        .order('fecha', { ascending: false })
    ]);

    const periodos = respPeriodos.data || [];
    const movimientos = respMovimientos.data || [];

    dibujarPeriodos(periodos, movimientos);
    dibujarMovimientos(periodos, movimientos);
  }

  // ============ SOLICITUDES DEL COLABORADOR ============

  /**
   * Carga las solicitudes del usuario actual
   */
  async function cargarMisSolicitudes() {
    const respuesta = await db
      .from('solicitudes_vacaciones')
      .select('id, fecha_inicio, fecha_fin, dias_solicitados, estado, nota, respuesta, created_at')
      .eq('empleado_id', perfil.empleado_id)
      .order('created_at', { ascending: false });

    misSolicitudes = respuesta.data || [];
    dibujarMisSolicitudes();
  }

  /**
   * Dibuja la tabla de solicitudes del usuario
   */
  function dibujarMisSolicitudes() {
    const cuerpo = $('tabla-solicitudes').querySelector('tbody');

    if (!misSolicitudes.length) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="vacio">Todavía no has hecho solicitudes.</td></tr>';
      return;
    }

    cuerpo.innerHTML = misSolicitudes.map(s => {
      const acciones = s.estado === 'pendiente'
        ? `<div class="acciones-celda">
             <button class="btn-chico" data-accion="editar" data-id="${esc(s.id)}">Editar</button>
             <button class="btn-chico btn-peligro" data-accion="borrar" data-id="${esc(s.id)}">Eliminar</button>
           </div>`
        : '-';

      return `<tr>
        <td>${esc(fecha(s.fecha_inicio))}</td>
        <td>${esc(fecha(s.fecha_fin))}</td>
        <td class="num">${esc(num(s.dias_solicitados))}</td>
        <td><span class="estado ${esc(s.estado)}">${esc(ESTADOS_SOLICITUD[s.estado] || s.estado)}</span></td>
        <td class="texto">${esc(s.nota || '')}</td>
        <td class="texto">${esc(s.estado === 'pendiente' ? '' : (s.respuesta || ''))}</td>
        <td class="acciones">${acciones}</td>
      </tr>`;
    }).join('');
  }

  /**
   * Recalcula los días hábiles entre las fechas seleccionadas
   */
  function recalcularDias() {
    const dias = diasHabiles($('sol-inicio').value, $('sol-fin').value);
    $('sol-dias').value = dias > 0 ? dias : '';
  }

  /**
   * Guarda una nueva solicitud o actualiza una existente
   */
  async function guardarSolicitud(evento) {
    evento.preventDefault();
    mensajeSolicitud('');

    const inicio = $('sol-inicio').value;
    const fin = $('sol-fin').value;
    const dias = Number($('sol-dias').value);
    const nota = $('sol-nota').value.trim();

    // Validaciones
    if (!inicio || !fin) {
      mensajeSolicitud('Elige las dos fechas.', true);
      return;
    }
    if (fin < inicio) {
      mensajeSolicitud('La fecha final no puede ser anterior a la inicial.', true);
      return;
    }
    if (!(dias > 0)) {
      mensajeSolicitud('Los días deben ser mayores a cero.', true);
      return;
    }

    const datos = {
      fecha_inicio: inicio,
      fecha_fin: fin,
      dias_solicitados: dias,
      nota: nota || null
    };

    const boton = $('sol-guardar');
    boton.disabled = true;

    let respuesta;
    const editando = editandoId;

    if (editando) {
      // Actualizar solicitud existente
      respuesta = await db.from('solicitudes_vacaciones').update(datos).eq('id', editando).select();
      if (!respuesta.error && (!respuesta.data || !respuesta.data.length)) {
        boton.disabled = false;
        mensajeSolicitud('No se pudo editar. Es posible que ya fue resuelta.', true);
        salirDeEdicion();
        await refrescarTodo();
        return;
      }
    } else {
      // Crear nueva solicitud
      datos.empleado_id = perfil.empleado_id;
      respuesta = await db.from('solicitudes_vacaciones').insert(datos).select();
    }

    boton.disabled = false;

    if (respuesta.error) {
      mensajeSolicitud(`No se pudo guardar: ${respuesta.error.message}`, true);
      return;
    }

    salirDeEdicion();
    mensajeSolicitud(editando ? 'Solicitud actualizada.' : 'Solicitud enviada. Queda pendiente de aprobación.');
    await cargarMisSolicitudes();
    if (puedeResolver()) {
      await cargarPendientes();
    }
  }

  /**
   * Entra en modo edición de una solicitud
   */
  function entrarEnEdicion(solicitud) {
    editandoId = solicitud.id;
    $('sol-inicio').value = solicitud.fecha_inicio;
    $('sol-fin').value = solicitud.fecha_fin;
    $('sol-dias').value = solicitud.dias_solicitados;
    $('sol-nota').value = solicitud.nota || '';
    $('sol-guardar').textContent = 'Guardar cambios';
    $('sol-cancelar').hidden = false;
    mensajeSolicitud('');
    $('form-solicitud').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Sale del modo edición
   */
  function salirDeEdicion() {
    editandoId = null;
    $('form-solicitud').reset();
    $('sol-guardar').textContent = 'Solicitar';
    $('sol-cancelar').hidden = true;
  }

  /**
   * Maneja clicks en la tabla de mis solicitudes
   */
  async function alClicMisSolicitudes(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;

    const id = boton.getAttribute('data-id');
    const accion = boton.getAttribute('data-accion');

    if (accion === 'editar') {
      const solicitud = misSolicitudes.find(s => s.id === id);
      if (solicitud) {
        entrarEnEdicion(solicitud);
      }
      return;
    }

    if (accion === 'borrar') {
      if (!window.confirm('¿Eliminar esta solicitud?')) return;

      boton.disabled = true;
      const respuesta = await db.from('solicitudes_vacaciones').delete().eq('id', id).select();

      if (respuesta.error || !respuesta.data || !respuesta.data.length) {
        mensajeSolicitud('No se pudo eliminar. Es posible que ya fue resuelta.', true);
      } else {
        if (editandoId === id) {
          salirDeEdicion();
        }
        mensajeSolicitud('Solicitud eliminada.');
      }

      await cargarMisSolicitudes();
      if (puedeResolver()) {
        await cargarPendientes();
      }
    }
  }

  // ============ SOLICITUDES PENDIENTES (STAFF) ============

  /**
   * Carga las solicitudes pendientes de aprobación
   * Staff: todas las solicitudes
   * Gerente Operaciones: solo de empleados con puesto "Gerente"
   */
  async function cargarPendientes() {
    const respuesta = await db
      .from('solicitudes_vacaciones')
      .select('id, empleado_id, fecha_inicio, fecha_fin, dias_solicitados, nota, created_at, empleados(codigo, nombre, puesto)')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true });

    let lista = respuesta.data || [];

    // Filtrar según rol
    if (esGerenteOperaciones()) {
      lista = lista.filter(s => {
        const emp = obtenerEmpleado(s);
        const puesto = emp && emp.puesto ? String(emp.puesto).toLowerCase() : '';
        return puesto.includes('gerente');
      });
    }

    dibujarPendientes(lista);
  }

  /**
   * Dibuja la tabla de solicitudes pendientes
   */
  function dibujarPendientes(lista) {
    const cuerpo = $('tabla-pendientes').querySelector('tbody');

    if (!lista.length) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="vacio">No hay solicitudes pendientes.</td></tr>';
      return;
    }

    cuerpo.innerHTML = lista.map(s => {
      const emp = obtenerEmpleado(s);
      const nombre = emp ? `${emp.codigo} - ${emp.nombre}` : '-';
      const puesto = emp && emp.puesto ? emp.puesto : '-';
      const propia = s.empleado_id === perfil.empleado_id;

      const acciones = propia
        ? '<span class="ayuda">Tu solicitud la resuelve otra persona</span>'
        : `<div class="acciones-celda">
             <button class="btn-chico btn-ok" data-accion="aprobar" data-id="${esc(s.id)}">Aprobar</button>
             <button class="btn-chico btn-peligro" data-accion="rechazar" data-id="${esc(s.id)}">Rechazar</button>
           </div>`;

      return `<tr>
        <td>${esc(nombre)}</td>
        <td>${esc(puesto)}</td>
        <td>${esc(fecha(s.fecha_inicio))}</td>
        <td>${esc(fecha(s.fecha_fin))}</td>
        <td class="num">${esc(num(s.dias_solicitados))}</td>
        <td class="texto">${esc(s.nota || '')}</td>
        <td class="acciones">${acciones}</td>
      </tr>`;
    }).join('');
  }

  /**
   * Maneja clicks en la tabla de solicitudes pendientes
   */
  async function alClicPendientes(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;

    const id = boton.getAttribute('data-id');
    const accion = boton.getAttribute('data-accion');
    let respuesta;

    if (accion === 'aprobar') {
      if (!window.confirm('¿Aprobar esta solicitud?')) return;
      boton.disabled = true;
      respuesta = await db.rpc('aprobar_solicitud', { p_solicitud: id });
    } else if (accion === 'rechazar') {
      const motivo = window.prompt('Motivo del rechazo (opcional):');
      if (motivo === null) return;
      boton.disabled = true;
      respuesta = await db.rpc('rechazar_solicitud', {
        p_solicitud: id,
        p_respuesta: motivo.trim() || null
      });
    }

    if (respuesta.error) {
      window.alert(respuesta.error.message);
      boton.disabled = false;
      return;
    }

    await refrescarTodo();
  }

  // ============ DIBUJO / PRESENTACIÓN ============

  /**
   * Dibuja las tarjetas de resumen de saldos
   */
  function dibujarTarjetas(s) {
    const caja = $('tarjetas');

    if (!s) {
      caja.innerHTML = '<p class="vacio">No hay datos de saldo para mostrar.</p>';
      return;
    }

    const tarjeta = (etiqueta, valor, clase) => {
      return `<div class="card ${clase || ''}">
        <div class="etiqueta">${esc(etiqueta)}</div>
        <div class="valor">${esc(num(valor))}</div>
      </div>`;
    };

    caja.innerHTML =
      tarjeta('Acumuladas', s.acumuladas) +
      tarjeta('Disfrutadas', s.disfrutadas) +
      tarjeta('Anticipadas', s.anticipadas) +
      tarjeta('Saldo pendiente', s.saldo_pendiente, Number(s.saldo_pendiente) > 0 ? 'alerta' : '') +
      tarjeta('Saldo disponible', s.saldo_disponible, 'destacada');
  }

  /**
   * Dibuja la tabla de resumen de empleados
   */
function dibujarResumen() {
  const cuerpo = $('tabla-resumen').querySelector('tbody');
  const filtroEstado = $('filtro-estado') ? $('filtro-estado').value : 'todos';
  const filtroDepto = $('filtro-departamento') ? $('filtro-departamento').value : '';

  const lista = saldos.filter(function (s) {
    if (filtroEstado === 'activo' && s.estado !== 'activo') {
      return false;
    }
    if (filtroEstado === 'inactivo' && s.estado === 'activo') {
      return false;
    }
    if (filtroDepto && s.departamento !== filtroDepto) {
      return false;
    }
    return true;
  });

  if (!lista.length) {
    cuerpo.innerHTML = '<tr><td colspan="12" class="vacio">Sin empleados con ese filtro.</td></tr>';
    return;
  }

  cuerpo.innerHTML = lista.map(function (s) {
    return `<tr data-id="${esc(s.empleado_id)}">
      <td>${esc(s.codigo)}</td>
      <td>${esc(s.nombre)}</td>
      <td>${esc(s.puesto || '-')}</td>
      <td>${esc(s.departamento || '-')}</td>
      <td>${esc(fecha(s.fecha_ingreso))}</td>
      <td>${esc(fecha(s.fecha_salida))}</td>
      <td>${esc(ESTADOS[s.estado] || s.estado)}</td>
      <td class="num">${esc(num(s.acumuladas))}</td>
      <td class="num">${esc(num(s.disfrutadas))}</td>
      <td class="num">${esc(num(s.anticipadas))}</td>
      <td class="num">${esc(num(s.saldo_pendiente))}</td>
      <td class="num"><strong>${esc(num(s.saldo_disponible))}</strong></td>
    </tr>`;
  }).join('');

  cuerpo.querySelectorAll('tr[data-id]').forEach(function (fila) {
    fila.addEventListener('click', function () {
      mostrarEmpleado(fila.getAttribute('data-id'));
    });
  });

  resaltarFila();
}

  /**
   * Resalta la fila del empleado actualmente seleccionado
   */
  function resaltarFila() {
    document.querySelectorAll('#tabla-resumen tbody tr').forEach(fila => {
      fila.classList.toggle('activa', fila.getAttribute('data-id') === empleadoActualId);
    });
  }

  /**
   * Dibuja la tabla de períodos de vacaciones
   */
  function dibujarPeriodos(periodos, movimientos) {
    const cuerpo = $('tabla-periodos').querySelector('tbody');

    if (!periodos.length) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="vacio">Todavía no hay años de servicio completados.</td></tr>';
      return;
    }

    cuerpo.innerHTML = periodos.map(p => {
      const delPeriodo = movimientos.filter(m => m.periodo_id === p.id);
      const ganado = suma(delPeriodo.filter(m => m.tipo === 'acumulacion'), 'dias');
      const tomados = suma(delPeriodo.filter(m => m.tipo === 'disfrute'), 'dias');
      const anticipados = suma(delPeriodo.filter(m => m.tipo === 'anticipo'), 'dias');
      const sinMovimientos = ganado === 0 && tomados === 0 && anticipados === 0;
      const quedan = ganado - tomados - anticipados;
      const textoQuedan = sinMovimientos ? 'En curso' : num(quedan);

      return `<tr>
        <td>${esc(p.anio_servicio)}</td>
        <td>${esc(fecha(p.fecha_inicio))}</td>
        <td>${esc(fecha(p.fecha_fin))}</td>
        <td class="num">${esc(num(p.dias_corresponden))}</td>
        <td class="num">${esc(num(tomados))}</td>
        <td class="num">${esc(num(anticipados))}</td>
        <td class="num ${quedan < 0 ? 'neg' : ''}">${esc(textoQuedan)}</td>
      </tr>`;
    }).join('');
  }

  /**
   * Dibuja la tabla de movimientos de vacaciones
   */
  function dibujarMovimientos(periodos, movimientos) {
    const cuerpo = $('tabla-movimientos').querySelector('tbody');

    if (!movimientos.length) {
      cuerpo.innerHTML = '<tr><td colspan="5" class="vacio">Sin movimientos registrados.</td></tr>';
      return;
    }

    // Mapear períodos por ID
    const anios = {};
    periodos.forEach(p => {
      anios[p.id] = p.anio_servicio;
    });

    cuerpo.innerHTML = movimientos.map(m => {
      const anio = m.periodo_id && anios[m.periodo_id] ? anios[m.periodo_id] : '-';
      return `<tr>
        <td>${esc(fecha(m.fecha))}</td>
        <td><span class="tipo ${esc(m.tipo)}">${esc(TIPOS[m.tipo] || m.tipo)}</span></td>
        <td>${esc(anio)}</td>
        <td class="num ${Number(m.dias) < 0 ? 'neg' : ''}">${esc(num(m.dias))}</td>
        <td class="motivo">${esc(m.motivo || '')}</td>
      </tr>`;
    }).join('');
  }

  // ============ INICIALIZACIÓN GENERAL ============

  document.addEventListener('DOMContentLoaded', iniciar);
})();