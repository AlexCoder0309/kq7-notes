// PF Alerta: consulta si hay citas en la Polícia Federal y avisa por Telegram.
// Uso:  node pf-alerta.js          -> vigila en bucle (en tu PC)
//       node pf-alerta.js --once   -> una sola consulta (GitHub Actions)
//       node pf-alerta.js --test   -> mensaje de prueba a Telegram + 1 consulta
//       node pf-alerta.js --demo   -> envía un aviso de citas de ejemplo (marcado como PRUEBA)
//
// TELEGRAM_TOKEN y TELEGRAM_CHAT_ID se leen de variables de entorno
// (en GitHub: Settings > Secrets and variables > Actions). No los escribas en este archivo.
//
// Botones del aviso (se leen en la siguiente consulta):
//   ✅ Ya lo sé     -> deja de insistir con estas citas (vuelve a avisar si cambian o aparecen nuevas)
//   🎉 Ya reservé   -> pausa todos los avisos (botón ▶️ Reanudar para volver)

const fs = require('fs');
const path = require('path');

// ===== CONFIGURACIÓN =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const ID_UNIDADE = process.env.ID_UNIDADE || '183';        // DELEMIG/DREX/SR/PF/PR - Curitiba
const ID_TIPO_SERVICO = process.env.ID_TIPO_SERVICO || '2'; // 1 = Solicitação de Refúgio, 2 = Requerimentos Diversos (renovação, 1º RNM, correção)
const INTERVALO_MIN = 5;   // modo bucle: cada cuántos minutos consultar
const RECORDAR_MIN = 0;    // si siguen habiendo citas, repetir aviso cada X minutos (0 = en cada consulta)
const LATIDO_MIN = 60;     // mensaje "sigo vivo" cada X minutos
// =========================

const URL_PF = `https://servicos.pf.gov.br/agenda-publico-rest/api/unidades/posto-configurado-agenda/${ID_UNIDADE}/${ID_TIPO_SERVICO}`;
const URL_AGENDA = 'https://servicos.pf.gov.br/agenda-web/acessar';
const ARCHIVO_ESTADO = path.join(__dirname, 'estado.json');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const BOTONES_CITA = [[
  { text: '✅ Ya lo sé', callback_data: 'ack' },
  { text: '🎉 Ya reservé (pausar)', callback_data: 'pausa' },
]];
const BOTON_REANUDAR = [[{ text: '▶️ Reanudar avisos', callback_data: 'reanudar' }]];

const log = (...a) => console.log(new Date().toISOString(), ...a);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function tgApi(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// opts: { html, silencioso, botones }
async function telegram(text, opts = {}) {
  const body = { chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true };
  if (opts.html) body.parse_mode = 'HTML';
  if (opts.silencioso) body.disable_notification = true;
  if (opts.botones) body.reply_markup = { inline_keyboard: opts.botones };
  const d = await tgApi('sendMessage', body);
  if (!d.ok) log('❌ Error de Telegram:', d.description);
  return d.ok;
}

// Aviso de citas: mensaje grande + 2 avisos extra para que el móvil suene varias veces.
async function avisarCitas(mes, prueba = false) {
  const p = prueba ? '🧪 <b>ESTO ES UNA PRUEBA</b> 🧪\n\n' : '';
  const ok = await telegram(
    `${p}🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n\n` +
    `<b>‼️ HAY CITAS EN LA POLÍCIA FEDERAL ‼️</b>\n\n` +
    `<b>📅 Primer mes con citas: ${mes.toUpperCase()}</b>\n` +
    `🏢 DELEMIG Curitiba · Primer RNM\n\n` +
    `<b>👉 ENTRA YA Y AGENDA:</b>\n${URL_AGENDA}\n\n` +
    `🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n\n` +
    `<i>Te seguiré avisando hasta que pulses un botón.</i>`,
    { html: true, botones: BOTONES_CITA },
  );
  for (const extra of ['⏰⏰⏰ <b>¡CITA DISPONIBLE! ENTRA YA</b> ⏰⏰⏰', '🔴🔴🔴 <b>¡CORRE, QUE SE ACABAN!</b> 🔴🔴🔴']) {
    await esperar(4000);
    await telegram(p + extra, { html: true, botones: BOTONES_CITA });
  }
  return ok;
}

// Lee los botones pulsados desde la última consulta y actualiza el estado.
async function leerBotones(e) {
  let d;
  try {
    d = await tgApi('getUpdates', { offset: (e.ultimoUpdate || 0) + 1, timeout: 0, allowed_updates: ['callback_query'] });
  } catch (err) { log('No se pudieron leer los botones:', err.message); return; }
  if (!d.ok) { log('No se pudieron leer los botones:', d.description); return; }

  for (const u of d.result) {
    e.ultimoUpdate = u.update_id;
    const q = u.callback_query;
    if (!q || !q.message || String(q.message.chat.id) !== String(TELEGRAM_CHAT_ID)) continue;
    tgApi('answerCallbackQuery', { callback_query_id: q.id, text: '👍 Recibido' }).catch(() => {});
    log('Botón pulsado:', q.data);

    if (q.data === 'ack' && !e.confirmado && !e.pausado) {
      e.confirmado = true;
      await telegram('👍 Vale, dejo de insistir con estas citas.\nTe avisaré si cambian o aparecen nuevas.');
    } else if (q.data === 'pausa' && !e.pausado) {
      e.pausado = true;
      await telegram('🎉 ¡Enhorabuena por la cita! Avisos de citas PAUSADOS.\nSeguiré mandando el 💚 cada hora. Pulsa el botón para volver a vigilar.', { botones: BOTON_REANUDAR });
    } else if (q.data === 'reanudar' && e.pausado) {
      e.pausado = false;
      e.confirmado = false;
      await telegram('▶️ Avisos REANUDADOS. Vuelvo a vigilar las citas.');
    }
  }
}

// 404 = sin citas | 200 con {ano, mes} = hay citas a partir de ese mes
async function consultar() {
  const r = await fetch(URL_PF, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const text = await r.text();
  if (r.status === 404) return { estado: 'sin_citas' };
  if (r.status !== 200) return { estado: 'error', detalle: `HTTP ${r.status}` };
  if (!text.trim()) return { estado: 'sin_citas' };
  let d;
  try { d = JSON.parse(text); } catch { return { estado: 'error', detalle: 'respuesta no JSON (¿bloqueo de Cloudflare?)' }; }
  if (d && (d.mes || d.ano)) return { estado: 'hay_citas', mes: d.mes, ano: d.ano };
  return { estado: 'sin_citas' };
}

// Estado: { estado, mes, ano, ultimoAviso, errores, ultimoLatido, ultimoUpdate, confirmado, pausado }
function leerEstado() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_ESTADO, 'utf8')); } catch { return {}; }
}
function guardarEstado(e) {
  fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify(e, null, 2) + '\n');
}

async function ciclo(previo) {
  const e = { ...previo };
  await leerBotones(e);

  let res;
  try { res = await consultar(); } catch (err) { res = { estado: 'error', detalle: err.message }; }
  log(res.estado, res.mes ? `${res.mes}/${res.ano}` : '', res.detalle || '', e.pausado ? '(pausado)' : '', e.confirmado ? '(confirmado)' : '');

  if (res.estado === 'hay_citas') {
    const cambio = e.estado !== 'hay_citas' || e.mes !== res.mes || e.ano !== res.ano;
    if (cambio) e.confirmado = false; // citas nuevas o de otro mes: volver a insistir
    Object.assign(e, { estado: res.estado, mes: res.mes, ano: res.ano, errores: 0 });
    const toca = cambio || Date.now() - (e.ultimoAviso || 0) >= RECORDAR_MIN * 60000;
    if (!e.pausado && !e.confirmado && toca) {
      const mes = res.mes ? `${MESES[res.mes - 1] || res.mes} ${res.ano || ''}` : '¿?';
      if (await avisarCitas(mes)) e.ultimoAviso = Date.now();
    }
  } else if (res.estado === 'sin_citas') {
    if (e.estado === 'hay_citas' && !e.pausado) await telegram('ℹ️ Las citas ya no aparecen disponibles. Sigo vigilando.');
    Object.assign(e, { estado: res.estado, errores: 0, ultimoAviso: 0, confirmado: false });
    delete e.mes; delete e.ano;
  } else {
    // En error conservamos el último estado conocido para no generar avisos falsos.
    e.errores = (e.errores || 0) + 1;
    if (e.errores === 3) await telegram(`⚠️ PF Alerta: no puedo consultar la web de la PF (${res.detalle}). Revisa el script.`);
  }

  // Latido: margen de 5 min porque GitHub no ejecuta exactamente a la hora.
  // Las ejecuciones manuales (botón "Run workflow") siempre lo envían.
  if (process.env.FORZAR_LATIDO === 'true' || Date.now() - (e.ultimoLatido || 0) >= (LATIDO_MIN - 5) * 60000) {
    const hora = new Date().toLocaleTimeString('es-ES', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const txt = { sin_citas: 'sin citas por ahora', hay_citas: `HAY CITAS (${res.mes}/${res.ano})` }[res.estado] || `error: ${res.detalle}`;
    const pausa = e.pausado ? '\n⏸️ Avisos de citas pausados' : '';
    if (await telegram(`💚 PF Alerta sigue vivo\nÚltima consulta ${hora} (Brasília): ${txt}${pausa}`,
      { silencioso: true, botones: e.pausado ? BOTON_REANUDAR : undefined })) e.ultimoLatido = Date.now();
  }
  return e;
}

(async () => {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️  Faltan las variables de entorno TELEGRAM_TOKEN y TELEGRAM_CHAT_ID.');
    process.exit(1);
  }
  if (process.argv.includes('--test')) {
    const ok = await telegram('👋 Prueba de PF Alerta: ¡las notificaciones funcionan!');
    log(ok ? '✅ Mensaje de prueba enviado' : '❌ No se pudo enviar');
    log('Consulta PF:', JSON.stringify(await consultar().catch((err) => ({ estado: 'error', detalle: err.message }))));
    return;
  }
  if (process.argv.includes('--demo')) {
    log(await avisarCitas('febrero 2027', true) ? '✅ Aviso de ejemplo enviado' : '❌ No se pudo enviar');
    return;
  }
  if (process.argv.includes('--once')) {
    guardarEstado(await ciclo(leerEstado()));
    return;
  }
  await telegram(`✅ PF Alerta en marcha. Vigilo la unidad ${ID_UNIDADE} cada ${INTERVALO_MIN} min.`);
  let estado = leerEstado();
  const vuelta = async () => { estado = await ciclo(estado); guardarEstado(estado); };
  await vuelta();
  setInterval(vuelta, INTERVALO_MIN * 60000);
})();
