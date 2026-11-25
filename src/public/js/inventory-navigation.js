/* global document, window */

(function () {
  const carousels = document.querySelectorAll('[data-inventory-lab-carousel]');
  if (!carousels.length) return;

  carousels.forEach((carousel) => {
    const viewport = carousel.querySelector('[data-carousel-viewport]');
    const slides = Array.from(carousel.querySelectorAll('[data-carousel-slide]'));
    const prevButton = carousel.querySelector('[data-carousel-prev]');
    const nextButton = carousel.querySelector('[data-carousel-next]');
    const indicators = Array.from(carousel.querySelectorAll('[data-carousel-indicator]'));
    if (!viewport || !slides.length) return;

    let currentIndex = 0;

    function scrollToIndex(index) {
      const safeIndex = Math.max(0, Math.min(index, slides.length - 1));
      currentIndex = safeIndex;
      slides[safeIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
      updateControls();
    }

    function updateControls() {
      if (prevButton) prevButton.disabled = currentIndex <= 0;
      if (nextButton) nextButton.disabled = currentIndex >= slides.length - 1;
      indicators.forEach((indicator, index) => {
        indicator.classList.toggle('is-active', index === currentIndex);
      });
    }

    function syncByScroll() {
      const viewportStart = viewport.getBoundingClientRect().left;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      slides.forEach((slide, index) => {
        const distance = Math.abs(slide.getBoundingClientRect().left - viewportStart);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      if (closestIndex !== currentIndex) {
        currentIndex = closestIndex;
        updateControls();
      }
    }

    prevButton?.addEventListener('click', () => scrollToIndex(currentIndex - 1));
    nextButton?.addEventListener('click', () => scrollToIndex(currentIndex + 1));
    indicators.forEach((indicator) => {
      indicator.addEventListener('click', () => {
        scrollToIndex(Number.parseInt(indicator.dataset.carouselGoTo || '0', 10));
      });
    });
    viewport.addEventListener('scroll', syncByScroll, { passive: true });
    window.addEventListener('resize', syncByScroll);
    updateControls();
  });
})();
