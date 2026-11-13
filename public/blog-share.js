const section = document.querySelector('[data-blog-share]');

if (section) {
  const url = section.dataset.blogShare;
  const title = document.querySelector('h1')?.textContent;
  const native = section.querySelector('[data-share-native]');
  const copy = section.querySelector('[data-share-copy]');
  const status = section.querySelector('[data-share-status]');
  const link = section.querySelector('[data-share-url]');

  copy.hidden = false;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      link.hidden = true;
      status.textContent = 'Link gekopieerd.';
    } catch {
      link.hidden = false;
      link.select();
      status.textContent = 'Selecteer en kopieer de link.';
    }
  });

  if (navigator.share) {
    native.hidden = false;
    native.addEventListener('click', async () => {
      try {
        await navigator.share({url, title});
      } catch (error) {
        if (error.name !== 'AbortError') status.textContent = 'Gebruik Kopieer link of kies een deelkanaal.';
      }
    });
  }
}
