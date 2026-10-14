/* global window, document */

(() => {
  const filterButtons = Array.from(document.querySelectorAll('[data-row-filter]'));
  const previewRows = Array.from(document.querySelectorAll('[data-preview-row]'));
  const filterSummary = document.getElementById('previewFilterSummary');
  const noMatchingRows = document.getElementById('previewNoMatchingRows');

  function applyRowFilter(filter) {
    let visibleRows = 0;
    previewRows.forEach((row) => {
      const shouldShow = filter === 'all' || row.dataset.rowStatus === filter;
      row.hidden = !shouldShow;
      if (shouldShow) visibleRows += 1;
    });

    filterButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.rowFilter === filter));
    });
    if (filterSummary) {
      filterSummary.textContent = `Mostrando ${visibleRows} de ${previewRows.length} filas.`;
    }
    if (noMatchingRows) noMatchingRows.hidden = visibleRows > 0;
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => applyRowFilter(button.dataset.rowFilter));
  });

  document.querySelectorAll('[data-description-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const description = button.parentElement.querySelector('[data-description-text]');
      const expanded = button.getAttribute('aria-expanded') === 'true';
      description.classList.toggle('is-expanded', !expanded);
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? 'Ver más' : 'Ver menos';
    });
  });

  document.querySelectorAll('form[data-confirm-submit]').forEach((form) => {
    form.addEventListener(
      'submit',
      (event) => {
        if (!window.confirm(form.dataset.confirmSubmit)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    );
  });

  const scrollTopButton = document.getElementById('inventoryPreviewScrollTop');
  if (scrollTopButton) {
    const updateScrollTopButton = () => {
      scrollTopButton.hidden = window.scrollY < 500;
    };
    window.addEventListener('scroll', updateScrollTopButton, { passive: true });
    updateScrollTopButton();
    scrollTopButton.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }
})();
