const cron = require('node-cron');

const pool = require('../libs/db');
const { sendEmailNotification } = require('../libs/email-notifications');

let reminderTask = null;

function formatReminderTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('es-CO', {
    timeZone: process.env.TZ || 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function startReminderJob() {
  if (String(process.env.PRESTAMOS_REMINDERS_ENABLED || 'true').toLowerCase() === 'false') {
    return null;
  }

  if (reminderTask) {
    return reminderTask;
  }

  let isRunning = false;
  reminderTask = cron.schedule(
    '* * * * *',
    async () => {
      if (isRunning) {
        return;
      }

      isRunning = true;

      try {
        const prestamosResult = await pool.query(
          `
            SELECT
              sp.id,
              sp.fecha_inicio,
              u.correo AS usuario_correo,
              u.nombre AS usuario_nombre,
              e.nombre AS equipo_nombre
            FROM solicitud_prestamo sp
            JOIN usuario u ON u.id = sp.usuario_id
            JOIN equipo e ON e.id = sp.equipo_id
            WHERE sp.estado = 'aprobado'
              AND COALESCE(sp.recordatorio_enviado, FALSE) = FALSE
              AND sp.fecha_inicio > CURRENT_TIMESTAMP
              AND sp.fecha_inicio <= (CURRENT_TIMESTAMP + INTERVAL '15 minutes')
          `
        );

        for (const prestamo of prestamosResult.rows) {
          try {
            const sendResult = await sendEmailNotification({
              sourceSystem: 'prestamos',
              templateName: 'prestamos/recordatorio_prestamo',
              recipient: prestamo.usuario_correo,
              subject: 'Recordatorio: tu prestamo comienza en 15 minutos',
              variables: {
                usuarioNombre: prestamo.usuario_nombre,
                equipoNombre: prestamo.equipo_nombre,
                horaInicio: formatReminderTime(prestamo.fecha_inicio),
              },
              correlationId: `prestamo-${prestamo.id}`,
            });

            if (sendResult?.status !== 'SENT') {
              continue;
            }

            await pool.query(
              `
                UPDATE solicitud_prestamo
                SET recordatorio_enviado = TRUE,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1
              `,
              [prestamo.id]
            );
          } catch (error) {
            console.error(`Error enviando recordatorio de prestamo ${prestamo.id}:`, error);
          }
        }

        const practicasResult = await pool.query(
          `
            SELECT
              rp.id,
              rp.fecha_inicio,
              rp.laboratorio,
              s.nombre AS sala_nombre,
              u.correo AS usuario_correo,
              u.nombre AS usuario_nombre
            FROM reserva_practica rp
            JOIN usuario u ON u.id = rp.usuario_id
            LEFT JOIN sala s ON s.id = rp.sala_id
            WHERE rp.estado = 'aprobada'
              AND COALESCE(rp.recordatorio_enviado, FALSE) = FALSE
              AND rp.fecha_inicio > CURRENT_TIMESTAMP
              AND rp.fecha_inicio <= (CURRENT_TIMESTAMP + INTERVAL '15 minutes')
          `
        );

        for (const practica of practicasResult.rows) {
          try {
            const sendResult = await sendEmailNotification({
              sourceSystem: 'prestamos',
              templateName: 'prestamos/recordatorio_practica',
              recipient: practica.usuario_correo,
              subject: 'Recordatorio: tu practica comienza en 15 minutos',
              variables: {
                usuarioNombre: practica.usuario_nombre,
                laboratorio: practica.laboratorio,
                salaNombre: practica.sala_nombre || '',
                horaInicio: formatReminderTime(practica.fecha_inicio),
              },
              correlationId: `practica-${practica.id}`,
            });

            if (sendResult?.status !== 'SENT') {
              continue;
            }

            await pool.query(
              `
                UPDATE reserva_practica
                SET recordatorio_enviado = TRUE,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1
              `,
              [practica.id]
            );
          } catch (error) {
            console.error(`Error enviando recordatorio de practica ${practica.id}:`, error);
          }
        }
      } catch (error) {
        console.error('Error en el job de recordatorios de prestamos:', error);
      } finally {
        isRunning = false;
      }
    },
    {
      timezone: process.env.TZ || 'America/Bogota',
      recoverMissedExecutions: true,
    }
  );

  return reminderTask;
}

module.exports = {
  startReminderJob,
};
