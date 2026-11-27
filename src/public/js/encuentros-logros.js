/* global document */

(function () {
  const endpoint = '/milab/encuentros/api/mis-logros';
  const list = document.getElementById('logros-list');
  const alert = document.getElementById('logros-alert');

  function showError(message) {
    alert.className = 'alert alert-danger';
    alert.textContent = message;
    alert.classList.remove('d-none');
  }

  function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  async function loadAchievements() {
    try {
      const response = await fetch(endpoint, { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.message || 'No fue posible consultar tus logros.');
      list.replaceChildren();
      const achievements = [
        ...(data.logros || []).map((achievement) => ({ ...achievement, tipo: 'encuentro' })),
        ...(data.medallas_laboratorios || []),
      ].sort(
        (left, right) =>
          new Date(right.fecha_obtencion).getTime() - new Date(left.fecha_obtencion).getTime()
      );
      if (!achievements.length) {
        const empty = document.createElement('p');
        empty.className = 'col-12 text-muted text-center py-4';
        empty.textContent =
          'Aún no tienes medallas. Al activar un laboratorio o completar un encuentro, aparecerán aquí.';
        list.appendChild(empty);
        return;
      }
      achievements.forEach((achievement) => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';
        const card = document.createElement('article');
        card.className = 'card h-100 border-warning-subtle';
        const body = document.createElement('div');
        body.className = 'card-body';
        const icon = document.createElement('i');
        icon.className = 'bi bi-award-fill fs-2 text-warning';
        icon.setAttribute('aria-hidden', 'true');
        const heading = document.createElement('h3');
        heading.className = 'h5 mt-2';
        heading.textContent =
          achievement.tipo === 'laboratorio' ? achievement.titulo : achievement.evento;
        if (achievement.tipo === 'laboratorio') {
          const description = document.createElement('p');
          description.className = 'mb-1';
          description.textContent = achievement.descripcion;
          body.append(icon, heading, description);
          const level = document.createElement('span');
          level.className = 'badge text-bg-warning';
          level.textContent = `Nivel ${achievement.nivel}`;
          body.appendChild(level);
        } else {
          const eventDate = document.createElement('p');
          eventDate.className = 'mb-1';
          eventDate.textContent = `Participación: ${formatDate(achievement.fecha_evento)}`;
          body.append(icon, heading, eventDate);
        }
        const received = document.createElement('p');
        received.className = 'small text-muted';
        received.textContent = `Medalla obtenida: ${new Intl.DateTimeFormat('es-CO', {
          dateStyle: 'medium',
          timeZone: 'America/Bogota',
        }).format(new Date(achievement.fecha_obtencion))}`;
        body.appendChild(received);
        if (achievement.tipo !== 'laboratorio') {
          const download = document.createElement('a');
          download.className = 'btn btn-sm btn-outline-primary';
          download.href = `/milab/encuentros/api/certificados/${achievement.certificado_id}/descargar`;
          download.textContent = `Descargar certificado ${achievement.codigo_certificado}`;
          body.appendChild(download);
        }
        card.appendChild(body);
        col.appendChild(card);
        list.appendChild(col);
      });
    } catch (error) {
      list.replaceChildren();
      showError(error.message);
    }
  }

  loadAchievements();
})();
