/* global document */

(function () {
  const form = document.getElementById('inventory-location-filters');
  if (!form) return;

  const faculty = form.querySelector('#inventory-faculty');
  const dependency = form.querySelector('#inventory-dependency');
  const laboratory = form.querySelector('#ual_id');
  const submitButton = form.querySelector('button[type="submit"]');
  const dependencyOptions = dependency ? Array.from(dependency.options).slice(1) : [];
  const laboratoryOptions = Array.from(laboratory.options).slice(1);
  const directDependencyPrefix = 'direct-';

  function filterOptions(select, options, matches, placeholder, emptyPlaceholder) {
    const selectedValue = select.value;
    const available = options.filter(matches);
    available.forEach((option) => {
      option.hidden = false;
      option.disabled = false;
    });
    const placeholderOption = select.options[0];
    placeholderOption.textContent = available.length ? placeholder : emptyPlaceholder;
    select.replaceChildren(placeholderOption, ...available);
    select.value = available.some((option) => option.value === selectedValue) ? selectedValue : '';
    return available.length;
  }

  function updateSubmitButton() {
    if (!submitButton) return;
    submitButton.disabled =
      faculty && dependency
        ? !faculty.value || !dependency.value || !laboratory.value
        : !laboratory.value;
  }

  function filterLaboratories() {
    if (faculty && dependency) {
      if (!faculty.value) {
        filterOptions(
          laboratory,
          [],
          () => true,
          'Selecciona un laboratorio',
          'Selecciona primero una facultad'
        );
        laboratory.disabled = true;
        updateSubmitButton();
        return;
      }
      if (!dependency.value) {
        filterOptions(
          laboratory,
          [],
          () => true,
          'Selecciona un laboratorio',
          'Selecciona primero una dependencia'
        );
        laboratory.disabled = true;
        updateSubmitButton();
        return;
      }

      const isDirectFacultyLocation = dependency.value.startsWith(directDependencyPrefix);
      const targetFacultyId = isDirectFacultyLocation
        ? dependency.value.slice(directDependencyPrefix.length)
        : faculty.value;
      const targetDependencyId = isDirectFacultyLocation ? '' : dependency.value;
      const available = filterOptions(
        laboratory,
        laboratoryOptions.filter(
          (option) =>
            option.dataset.facultyId === targetFacultyId &&
            option.dataset.dependencyId === targetDependencyId
        ),
        () => true,
        'Selecciona un laboratorio',
        'No hay laboratorios disponibles para esta dependencia'
      );
      laboratory.disabled = available === 0;
      updateSubmitButton();
      return;
    }

    const available = filterOptions(
      laboratory,
      laboratoryOptions,
      (option) =>
        (!faculty?.value || option.dataset.facultyId === faculty.value) &&
        (!dependency?.value || option.dataset.dependencyId === dependency.value),
      'Selecciona un laboratorio',
      'No hay laboratorios disponibles'
    );
    laboratory.disabled = available === 0;
    updateSubmitButton();
  }

  function filterDependencies() {
    if (!dependency) return;
    if (!faculty?.value) {
      filterOptions(
        dependency,
        [],
        () => true,
        'Selecciona una dependencia',
        'Selecciona primero una facultad'
      );
      dependency.disabled = true;
      return;
    }

    const available = filterOptions(
      dependency,
      dependencyOptions.filter((option) => option.dataset.facultyId === faculty.value),
      () => true,
      'Selecciona una dependencia',
      'No hay dependencias disponibles para esta facultad'
    );
    dependency.disabled = available === 0;
  }

  faculty?.addEventListener('change', function () {
    dependency.value = '';
    laboratory.value = '';
    filterDependencies();
    filterLaboratories();
    updateSubmitButton();
  });

  dependency?.addEventListener('change', function () {
    laboratory.value = '';
    filterLaboratories();
    updateSubmitButton();
  });

  laboratory.addEventListener('change', updateSubmitButton);

  filterDependencies();
  filterLaboratories();
  updateSubmitButton();
})();
