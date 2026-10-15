/* global document */

(function () {
  const form = document.getElementById('inventory-location-filters');
  if (!form) return;

  const faculty = form.querySelector('#inventory-faculty');
  const dependency = form.querySelector('#inventory-dependency');
  const laboratory = form.querySelector('#ual_id');
  const dependencyOptions = dependency ? Array.from(dependency.options).slice(1) : [];
  const laboratoryOptions = Array.from(laboratory.options).slice(1);

  function filterOptions(select, options, matches, placeholder) {
    const selectedValue = select.value;
    const available = options.filter(matches);
    select.replaceChildren(select.options[0], ...available);
    select.options[0].textContent = available.length ? placeholder : 'No hay opciones disponibles';
    select.value = available.some((option) => option.value === selectedValue) ? selectedValue : '';
  }

  function filterLaboratories() {
    filterOptions(
      laboratory,
      laboratoryOptions,
      (option) =>
        (!faculty?.value || option.dataset.facultyId === faculty.value) &&
        (!dependency?.value || option.dataset.dependencyId === dependency.value),
      'Selecciona un laboratorio'
    );
  }

  function filterDependencies() {
    if (!dependency) return;
    filterOptions(
      dependency,
      dependencyOptions,
      (option) => !faculty?.value || option.dataset.facultyId === faculty.value,
      'Todas las dependencias'
    );
  }

  faculty?.addEventListener('change', function () {
    dependency.value = '';
    laboratory.value = '';
    filterDependencies();
    filterLaboratories();
  });

  dependency?.addEventListener('change', function () {
    laboratory.value = '';
    filterLaboratories();
  });

  filterDependencies();
  filterLaboratories();
})();
