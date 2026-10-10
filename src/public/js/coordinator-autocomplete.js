/* global document */

(function () {
  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  document.querySelectorAll('[data-coordinator-autocomplete]').forEach(function (widget) {
    const input = widget.querySelector('[data-coordinator-search]');
    const selectedValue = widget.querySelector('[data-coordinator-value]');
    const results = widget.querySelector('[data-coordinator-results]');
    const options = Array.from(widget.querySelectorAll('[data-coordinator-option]'));

    if (!input || !selectedValue || !results) return;

    function closeResults() {
      results.hidden = true;
    }

    function filterResults() {
      const query = normalize(input.value.trim());
      let matchCount = 0;

      options.forEach(function (option) {
        const matches = Boolean(query) && normalize(option.dataset.search).includes(query);
        option.hidden = !matches || matchCount >= 10;
        if (!option.hidden) matchCount += 1;
      });

      results.hidden = matchCount === 0;
    }

    input.addEventListener('input', function () {
      const selectedOption = options.find(function (option) {
        return option.dataset.value === selectedValue.value;
      });
      if (!selectedOption || input.value !== selectedOption.dataset.label) {
        selectedValue.value = '';
      }
      filterResults();
    });

    input.addEventListener('focus', filterResults);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeResults();
      } else if (event.key === 'ArrowDown' && !results.hidden) {
        const firstOption = options.find(function (option) {
          return !option.hidden;
        });
        if (firstOption) {
          event.preventDefault();
          firstOption.focus();
        }
      } else if (event.key === 'Enter' && !results.hidden) {
        const firstOption = options.find(function (option) {
          return !option.hidden;
        });
        if (firstOption) {
          event.preventDefault();
          firstOption.click();
        }
      }
    });

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        input.value = option.dataset.label;
        selectedValue.value = option.dataset.value;
        closeResults();

        if (widget.dataset.submitOnSelect === 'true' && input.form) {
          input.form.requestSubmit();
        }
      });
    });

    document.addEventListener('click', function (event) {
      if (!widget.contains(event.target)) closeResults();
    });
  });
})();
