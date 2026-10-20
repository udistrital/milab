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
      if (!data.logros.length) {
        const empty = document.createElement('p');
        empty.className = 'col-12 text-muted text-center py-4';
        empty.textContent =
          'Aún no tienes medallas. Al completar un encuentro y recibir el certificado, aparecerá aquí.';
        list.appendChild(empty);
        return;
      }
      data.logros.forEach((achievement) => {
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
        heading.textContent = achievement.evento;
        const eventDate = document.createElement('p');
        eventDate.className = 'mb-1';
        eventDate.textContent = `Participación: ${formatDate(achievement.fecha_evento)}`;
        const received = document.createElement('p');
        received.className = 'small text-muted';
        received.textContent = `Medalla obtenida: ${new Intl.DateTimeFormat('es-CO', {
          dateStyle: 'medium',
          timeZone: 'America/Bogota',
        }).format(new Date(achievement.fecha_obtencion))}`;
        body.append(icon, heading, eventDate, received);
        const download = document.createElement('a');
        download.className = 'btn btn-sm btn-outline-primary';
        download.href = `/milab/encuentros/api/certificados/${achievement.certificado_id}/descargar`;
        download.textContent = `Descargar certificado ${achievement.codigo_certificado}`;
        body.appendChild(download);
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
