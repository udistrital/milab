/* global window, document */

(() => {
  const filterButtons = Array.from(document.querySelectorAll('[data-row-filter]'));
  const previewRows = Array.from(document.querySelectorAll('[data-preview-row]'));
  const previewTable = document.getElementById('previewRowsTable');
  const filterSummary = document.getElementById('previewFilterSummary');
  const noMatchingRows = document.getElementById('previewNoMatchingRows');
  const $ = window.jQuery;
  const hasDataTableSupport = Boolean(previewTable && $?.fn?.dataTable);
  let activeRowFilter = 'all';
  let dataTable = null;

  function countMatchingRows() {
    if (dataTable) return dataTable.rows({ search: 'applied' }).count();

    return previewRows.filter(
      (row) => activeRowFilter === 'all' || row.dataset.rowStatus === activeRowFilter
    ).length;
  }

  function updateFilterSummary() {
    const matchingRows = countMatchingRows();
    if (filterSummary) {
      filterSummary.textContent = `Mostrando ${matchingRows} de ${previewRows.length} filas.`;
    }
    if (noMatchingRows) noMatchingRows.hidden = matchingRows > 0;
  }

  function applyRowFilter(filter) {
    activeRowFilter = filter;
    filterButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.rowFilter === filter));
    });

    if (dataTable) {
      dataTable.draw();
      return;
    }

    if (!hasDataTableSupport) {
      previewRows.forEach((row) => {
        row.hidden = activeRowFilter !== 'all' && row.dataset.rowStatus !== activeRowFilter;
      });
    }
    updateFilterSummary();
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => applyRowFilter(button.dataset.rowFilter));
  });

  if (hasDataTableSupport) {
    $.fn.dataTable.ext.search.push((settings, _data, dataIndex) => {
      if (settings.nTable !== previewTable || activeRowFilter === 'all') return true;

      const row = settings.aoData[dataIndex]?.nTr;
      return row?.dataset.rowStatus === activeRowFilter;
    });

    $(function () {
      if (!$.fn.dataTable.isDataTable(previewTable)) return;

      previewRows.forEach((row) => {
        row.hidden = false;
      });
      dataTable = $(previewTable).DataTable();
      dataTable.on('draw', updateFilterSummary);
      dataTable.draw();
    });
  }

  document.querySelectorAll('[data-description-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const description = button.parentElement.querySelector('[data-description-text]');
      const expanded = button.getAttribute('aria-expanded') === 'true';
      description.classList.toggle('is-expanded', !expanded);
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? 'Ver más' : 'Ver menos';
    });
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
