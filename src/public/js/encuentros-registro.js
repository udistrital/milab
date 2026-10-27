/* global document, window */

(function () {
  const form = document.getElementById('registro-form');
  if (!form) return;

  const input = document.getElementById('documento');
  const boton = document.getElementById('btn-registrar');
  const resultado = document.getElementById('resultado');
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

  const clases = {
    success: 'alert-success',
    warning: 'alert-warning',
    danger: 'alert-danger',
  };

  function mostrar(tipo, mensaje) {
    resultado.classList.remove('d-none', 'alert-success', 'alert-warning', 'alert-danger');
    resultado.classList.add(clases[tipo]);
    resultado.textContent = mensaje;
  }

  function tipoPorEstado(status) {
    if (status === 'registered' || status === 'already_registered' || status === 'already_out')
      return 'success';
    if (status === 'no_entry' || status === 'event_not_open') return 'warning';
    return 'danger';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const documento = input.value.replace(/\D/g, '');
    if (!documento) {
      mostrar('danger', 'Ingresa tu número de documento.');
      input.focus();
      return;
    }

    boton.disabled = true;
    try {
      const response = await fetch(window.location.pathname, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ documento }),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!data || typeof data.message !== 'string') {
        mostrar('danger', 'No fue posible registrar la asistencia. Intenta nuevamente.');
        return;
      }
      mostrar(tipoPorEstado(data.status), data.message);
      if (data.ok) {
        input.value = '';
      }
    } catch {
      mostrar('danger', 'Sin conexión. Verifica tu red e intenta nuevamente.');
    } finally {
      boton.disabled = false;
      input.focus();
    }
  });
})();
