// Control de vacaciones - lógica de la página
// Todo el cálculo de saldos lo hace la base de datos (vista saldos_vacaciones).
// Aprobar o rechazar solicitudes también lo hace la base de datos (funciones aprobar_solicitud y rechazar_solicitud).
// Esta página solo consulta, envía solicitudes y muestra los datos.

(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const TIPOS = {
    acumulacion: 'Acumulación',
    disfrute: 'Disfrute',
    anticipo: 'Anticipo',
    proporcional: 'Proporcional',
    ajuste: 'Ajuste'
  };
  const ROLES = { administrador: 'Administrador', rrhh: 'RRHH', colaborador: 'Colaborador' };
  const ESTADOS = { activo: 'Activo', suspendido: 'Suspendido', renuncio: 'Renunció', despedido: 'Despedido' };
  const ESTADOS_SOLICITUD = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };

  let db = null;
  let perfil = null;
  let saldos = [];
  let empleadoActualId = null;
  let misSolicitudes = [];
  let editandoId = null;

  // ---------- Utilidades ----------
  function esc(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(valor) {
    return Number(valor).toLocaleString('es-HN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function fecha(valor) {
    if (!valor) return '-';
    const partes = String(valor).split('-');
    return partes.length === 3 ? partes[2] + '/' + partes[1] + '/' + partes[0] : valor;
  }

  function suma(lista, campo) {
    return lista.reduce(function (total, item) { return total + Number(item[campo] || 0); }, 0);
  }

  function esStaff() {
    return perfil && (perfil.rol === 'rrhh' || perfil.rol === 'administrador');
  }

  // Cuenta los días de lunes a viernes entre dos fechas (sin descontar feriados)
  function diasHabiles(inicio, fin) {
    if (!inicio || !fin || fin < inicio) return 0;
    const actual = new Date(inicio + 'T00:00:00');
    const limite = new Date(fin + 'T00:00:00');
    let total = 0;
    let vueltas = 0;
    while (actual <= limite && vueltas < 400) {
      const dia = actual.getDay();
      if (dia !== 0 && dia !== 6) total++;
      actual.setDate(actual.getDate() + 1);
      vueltas++;
    }
    return total;
  }

  // ---------- Pantallas ----------
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

  // ---------- Inicio ----------
  function iniciar() {
    const botonLogin = $('login-form').querySelector('button[type="submit"]');

    if (!window.supabase) {
      mostrarError('No se pudo cargar la librería de Supabase. Revisa tu conexión a internet.');
      botonLogin.disabled = true;
      return;
    }
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY || String(cfg.SUPABASE_KEY).indexOf('PEGA_AQUI') === 0) {
      mostrarError('Falta pegar la llave publishable de Supabase en js/config.js');
      botonLogin.disabled = true;
      return;
    }

    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

    // Mostrar/ocultar contraseña
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

    $('login-form').addEventListener('submit', alEnviarLogin);
    $('btn-salir').addEventListener('click', alSalir);
    $('btn-volver').addEventListener('click', function () { mostrarEmpleado(perfil.empleado_id); });

    $('sol-inicio').addEventListener('change', recalcularDias);
    $('sol-fin').addEventListener('change', recalcularDias);
    $('form-solicitud').addEventListener('submit', guardarSolicitud);
    $('sol-cancelar').addEventListener('click', salirDeEdicion);
    $('tabla-solicitudes').querySelector('tbody').addEventListener('click', alClicMisSolicitudes);
    $('tabla-pendientes').querySelector('tbody').addEventListener('click', alClicPendientes);

    db.auth.getSession().then(function (respuesta) {
      if (respuesta.data.session) {
        entrar();
      } else {
        mostrarLogin();
      }
    });
  }

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

    if ($('recordar').checked) localStorage.setItem('usuario_recordado', correo);
    else localStorage.removeItem('usuario_recordado');

    $('password').value = '';
    entrar();
  }

  async function alSalir() {
    await db.auth.signOut();
    perfil = null;
    saldos = [];
    misSolicitudes = [];
    empleadoActualId = null;
    salirDeEdicion();
    mostrarLogin();
  }

  // ---------- Carga de datos ----------
  async function entrar() {
    const usuario = (await db.auth.getUser()).data.user;
    if (!usuario) { mostrarLogin(); return; }

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

    $('user-nombre').textContent = emp ? emp.nombre : usuario.email;

    $('user-rol').textContent = ROLES[perfil.rol] || perfil.rol;
    $('panel-staff').hidden = !esStaff();
    $('panel-pendientes').hidden = !esStaff();

    empleadoActualId = perfil.empleado_id;
    mostrarApp();
    await refrescarTodo();
  }

  async function refrescarTodo() {
    await cargarSaldos();
    await Promise.all([cargarMisSolicitudes(), esStaff() ? cargarPendientes() : Promise.resolve()]);
    await mostrarEmpleado(empleadoActualId || perfil.empleado_id);
  }

  async function cargarSaldos() {
    const respuesta = await db.from('saldos_vacaciones').select('*').order('codigo');
    saldos = respuesta.data || [];
    if (esStaff()) dibujarResumen();
  }

  async function mostrarEmpleado(empleadoId) {
    empleadoActualId = empleadoId;

    resaltarFila();

    const saldo = saldos.find(function (s) { return s.empleado_id === empleadoId; });
    const propio = empleadoId === perfil.empleado_id;

    $('titulo-empleado').textContent = propio ? 'Mis vacaciones' : (saldo ? saldo.nombre : 'Empleado');
    $('subtitulo-empleado').textContent = saldo
      ? 'Código ' + saldo.codigo + ' - Estado: ' + (ESTADOS[saldo.estado] || saldo.estado)
      : '';
    $('btn-volver').hidden = propio;
    $('seccion-solicitudes').hidden = !propio;

    dibujarTarjetas(saldo);

    const resultados = await Promise.all([
      db.from('periodos_vacaciones')
        .select('id, anio_servicio, fecha_inicio, fecha_fin, dias_corresponden')
        .eq('empleado_id', empleadoId).order('anio_servicio'),
      db.from('movimientos_vacaciones')
        .select('id, periodo_id, fecha, tipo, dias, motivo')
        .eq('empleado_id', empleadoId).order('fecha', { ascending: false })
    ]);

    const periodos = resultados[0].data || [];
    const movimientos = resultados[1].data || [];

    dibujarPeriodos(periodos, movimientos);
    dibujarMovimientos(periodos, movimientos);
  }
  
  // ---------- Solicitudes del colaborador ----------
  async function cargarMisSolicitudes() {
    const respuesta = await db
      .from('solicitudes_vacaciones')
      .select('id, fecha_inicio, fecha_fin, dias_solicitados, estado, nota, respuesta, created_at')
      .eq('empleado_id', perfil.empleado_id)
      .order('created_at', { ascending: false });
    misSolicitudes = respuesta.data || [];
    dibujarMisSolicitudes();
  }

  function dibujarMisSolicitudes() {
    const cuerpo = $('tabla-solicitudes').querySelector('tbody');
    if (!misSolicitudes.length) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="vacio">Todavía no has hecho solicitudes.</td></tr>';
      return;
    }
    cuerpo.innerHTML = misSolicitudes.map(function (s) {
      const acciones = s.estado === 'pendiente'
        ? '<div class="acciones-celda">' +
          '<button class="btn-chico" data-accion="editar" data-id="' + esc(s.id) + '">Editar</button>' +
          '<button class="btn-chico btn-peligro" data-accion="borrar" data-id="' + esc(s.id) + '">Eliminar</button>' +
          '</div>'
        : '-';
      return '<tr>' +
        '<td>' + esc(fecha(s.fecha_inicio)) + '</td>' +
        '<td>' + esc(fecha(s.fecha_fin)) + '</td>' +
        '<td class="num">' + esc(num(s.dias_solicitados)) + '</td>' +
        '<td><span class="estado ' + esc(s.estado) + '">' + esc(ESTADOS_SOLICITUD[s.estado] || s.estado) + '</span></td>' +
        '<td class="texto">' + esc(s.nota || '') + '</td>' +
        '<td class="texto">' + esc(s.estado === 'pendiente' ? '' : (s.respuesta || '')) + '</td>' +
        '<td class="acciones">' + acciones + '</td>' +
        '</tr>';
    }).join('');
  }

  function recalcularDias() {
    const dias = diasHabiles($('sol-inicio').value, $('sol-fin').value);
    $('sol-dias').value = dias > 0 ? dias : '';
  }

  async function guardarSolicitud(evento) {
    evento.preventDefault();
    mensajeSolicitud('');

    const inicio = $('sol-inicio').value;
    const fin = $('sol-fin').value;
    const dias = Number($('sol-dias').value);
    const nota = $('sol-nota').value.trim();

    if (!inicio || !fin) { mensajeSolicitud('Elige las dos fechas.', true); return; }
    if (fin < inicio) { mensajeSolicitud('La fecha final no puede ser anterior a la inicial.', true); return; }
    if (!(dias > 0)) { mensajeSolicitud('Los días deben ser mayores a cero.', true); return; }

    const datos = { fecha_inicio: inicio, fecha_fin: fin, dias_solicitados: dias, nota: nota || null };
    const boton = $('sol-guardar');
    boton.disabled = true;

    let respuesta;
    const editando = editandoId;
    if (editando) {
      respuesta = await db.from('solicitudes_vacaciones').update(datos).eq('id', editando).select();
      if (!respuesta.error && (!respuesta.data || !respuesta.data.length)) {
        boton.disabled = false;
        mensajeSolicitud('No se pudo editar. Es posible que ya fue resuelta.', true);
        salirDeEdicion();
        await refrescarTodo();
        return;
      }
    } else {
      datos.empleado_id = perfil.empleado_id;
      respuesta = await db.from('solicitudes_vacaciones').insert(datos).select();
    }

    boton.disabled = false;
    if (respuesta.error) {
      mensajeSolicitud('No se pudo guardar: ' + respuesta.error.message, true);
      return;
    }

    salirDeEdicion();
    mensajeSolicitud(editando ? 'Solicitud actualizada.' : 'Solicitud enviada. Queda pendiente de aprobación.');
    await cargarMisSolicitudes();
    if (esStaff()) await cargarPendientes();
  }

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

  function salirDeEdicion() {
    editandoId = null;
    $('form-solicitud').reset();
    $('sol-guardar').textContent = 'Solicitar';
    $('sol-cancelar').hidden = true;
  }

  async function alClicMisSolicitudes(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const id = boton.getAttribute('data-id');
    const accion = boton.getAttribute('data-accion');

    if (accion === 'editar') {
      const solicitud = misSolicitudes.find(function (s) { return s.id === id; });
      if (solicitud) entrarEnEdicion(solicitud);
      return;
    }

    if (accion === 'borrar') {
      if (!window.confirm('¿Eliminar esta solicitud?')) return;
      boton.disabled = true;
      const respuesta = await db.from('solicitudes_vacaciones').delete().eq('id', id).select();
      if (respuesta.error || !respuesta.data || !respuesta.data.length) {
        mensajeSolicitud('No se pudo eliminar. Es posible que ya fue resuelta.', true);
      } else {
        if (editandoId === id) salirDeEdicion();
        mensajeSolicitud('Solicitud eliminada.');
      }
      await cargarMisSolicitudes();
      if (esStaff()) await cargarPendientes();
    }
  }

  // ---------- Solicitudes por resolver (RRHH y administrador) ----------
  async function cargarPendientes() {
    const respuesta = await db
      .from('solicitudes_vacaciones')
      .select('id, empleado_id, fecha_inicio, fecha_fin, dias_solicitados, nota, created_at, empleados(codigo, nombre)')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true });
    dibujarPendientes(respuesta.data || []);
  }

  function dibujarPendientes(lista) {
    const cuerpo = $('tabla-pendientes').querySelector('tbody');
    if (!lista.length) {
      cuerpo.innerHTML = '<tr><td colspan="6" class="vacio">No hay solicitudes pendientes.</td></tr>';
      return;
    }
    cuerpo.innerHTML = lista.map(function (s) {
      const emp = Array.isArray(s.empleados) ? s.empleados[0] : s.empleados;
      const nombre = emp ? emp.codigo + ' - ' + emp.nombre : '-';
      const propia = s.empleado_id === perfil.empleado_id;
      const acciones = propia
        ? '<span class="ayuda">Tu solicitud la resuelve otra persona</span>'
        : '<div class="acciones-celda">' +
          '<button class="btn-chico btn-ok" data-accion="aprobar" data-id="' + esc(s.id) + '">Aprobar</button>' +
          '<button class="btn-chico btn-peligro" data-accion="rechazar" data-id="' + esc(s.id) + '">Rechazar</button>' +
          '</div>';
      return '<tr>' +
        '<td>' + esc(nombre) + '</td>' +
        '<td>' + esc(fecha(s.fecha_inicio)) + '</td>' +
        '<td>' + esc(fecha(s.fecha_fin)) + '</td>' +
        '<td class="num">' + esc(num(s.dias_solicitados)) + '</td>' +
        '<td class="texto">' + esc(s.nota || '') + '</td>' +
        '<td class="acciones">' + acciones + '</td>' +
        '</tr>';
    }).join('');
  }

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
    } else {
      const motivo = window.prompt('Motivo del rechazo (opcional):');
      if (motivo === null) return;
      boton.disabled = true;
      respuesta = await db.rpc('rechazar_solicitud', { p_solicitud: id, p_respuesta: motivo.trim() || null });
    }

    if (respuesta.error) {
      window.alert(respuesta.error.message);
      boton.disabled = false;
      return;
    }
    await refrescarTodo();
  }

  // ---------- Dibujo ----------
  function dibujarTarjetas(s) {
    const caja = $('tarjetas');
    if (!s) {
      caja.innerHTML = '<p class="vacio">No hay datos de saldo para mostrar.</p>';
      return;
    }
    const tarjeta = function (etiqueta, valor, clase) {
      return '<div class="card ' + (clase || '') + '"><div class="etiqueta">' + esc(etiqueta) +
        '</div><div class="valor">' + esc(num(valor)) + '</div></div>';
    };
    caja.innerHTML =
      tarjeta('Acumuladas', s.acumuladas) +
      tarjeta('Disfrutadas', s.disfrutadas) +
      tarjeta('Anticipadas', s.anticipadas) +
      tarjeta('Saldo pendiente', s.saldo_pendiente, Number(s.saldo_pendiente) > 0 ? 'alerta' : '') +
      tarjeta('Saldo disponible', s.saldo_disponible, 'destacada');
  }

  function dibujarResumen() {
    const cuerpo = $('tabla-resumen').querySelector('tbody');
    if (!saldos.length) {
      cuerpo.innerHTML = '<tr><td colspan="8" class="vacio">Sin empleados.</td></tr>';
      return;
    }
    cuerpo.innerHTML = saldos.map(function (s) {
      return '<tr data-id="' + esc(s.empleado_id) + '">' +
        '<td>' + esc(s.codigo) + '</td>' +
        '<td>' + esc(s.nombre) + '</td>' +
        '<td>' + esc(ESTADOS[s.estado] || s.estado) + '</td>' +
        '<td class="num">' + esc(num(s.acumuladas)) + '</td>' +
        '<td class="num">' + esc(num(s.disfrutadas)) + '</td>' +
        '<td class="num">' + esc(num(s.anticipadas)) + '</td>' +
        '<td class="num">' + esc(num(s.saldo_pendiente)) + '</td>' +
        '<td class="num"><strong>' + esc(num(s.saldo_disponible)) + '</strong></td>' +
        '</tr>';
    }).join('');

    cuerpo.querySelectorAll('tr[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () { mostrarEmpleado(fila.getAttribute('data-id')); });
    });
    resaltarFila();
  }

  function resaltarFila() {
    document.querySelectorAll('#tabla-resumen tbody tr').forEach(function (fila) {
      fila.classList.toggle('activa', fila.getAttribute('data-id') === empleadoActualId);
    });
  }

  function dibujarPeriodos(periodos, movimientos) {
    const cuerpo = $('tabla-periodos').querySelector('tbody');
    if (!periodos.length) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="vacio">Todavía no hay años de servicio completados.</td></tr>';
      return;
    }
    cuerpo.innerHTML = periodos.map(function (p) {
      const delPeriodo = movimientos.filter(function (m) { return m.periodo_id === p.id; });
      const ganado = suma(delPeriodo.filter(function (m) { return m.tipo === 'acumulacion'; }), 'dias');
      const tomados = suma(delPeriodo.filter(function (m) { return m.tipo === 'disfrute'; }), 'dias');
      const anticipados = suma(delPeriodo.filter(function (m) { return m.tipo === 'anticipo'; }), 'dias');
      const sinMovimientos = ganado === 0 && tomados === 0 && anticipados === 0;
      const quedan = ganado - tomados - anticipados;
      const textoQuedan = sinMovimientos ? 'En curso' : num(quedan);
      return '<tr>' +
        '<td>' + esc(p.anio_servicio) + '</td>' +
        '<td>' + esc(fecha(p.fecha_inicio)) + '</td>' +
        '<td>' + esc(fecha(p.fecha_fin)) + '</td>' +
        '<td class="num">' + esc(num(p.dias_corresponden)) + '</td>' +
        '<td class="num">' + esc(num(tomados)) + '</td>' +
        '<td class="num">' + esc(num(anticipados)) + '</td>' +
        '<td class="num ' + (quedan < 0 ? 'neg' : '') + '">' + esc(textoQuedan) + '</td>' +
        '</tr>';
    }).join('');
  }

  function dibujarMovimientos(periodos, movimientos) {
    const cuerpo = $('tabla-movimientos').querySelector('tbody');
    if (!movimientos.length) {
      cuerpo.innerHTML = '<tr><td colspan="5" class="vacio">Sin movimientos registrados.</td></tr>';
      return;
    }
    const anios = {};
    periodos.forEach(function (p) { anios[p.id] = p.anio_servicio; });

    cuerpo.innerHTML = movimientos.map(function (m) {
      const anio = m.periodo_id && anios[m.periodo_id] ? anios[m.periodo_id] : '-';
      return '<tr>' +
        '<td>' + esc(fecha(m.fecha)) + '</td>' +
        '<td><span class="tipo ' + esc(m.tipo) + '">' + esc(TIPOS[m.tipo] || m.tipo) + '</span></td>' +
        '<td>' + esc(anio) + '</td>' +
        '<td class="num ' + (Number(m.dias) < 0 ? 'neg' : '') + '">' + esc(num(m.dias)) + '</td>' +
        '<td class="motivo">' + esc(m.motivo || '') + '</td>' +
        '</tr>';
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
