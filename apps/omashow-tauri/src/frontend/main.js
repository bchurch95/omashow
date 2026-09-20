const log = document.getElementById('log');
const slidesDiv = document.getElementById('slides');
let currentModel = null;
let currentPath = null;

async function invoke(cmd, args={}) {
  return await window.__TAURI__.core.invoke(cmd, args);
}

function renderSlides(model) {
  slidesDiv.innerHTML = '<h3>Slides</h3>';
  model.slides.forEach((s, i) => {
    const el = document.createElement('div');
    el.textContent = `Slide ${i+1}: ${s.title || '(no title)'}`;
    el.style.padding = '4px';
    el.style.cursor = 'pointer';
    el.onclick = () => {
      document.getElementById('main').innerHTML = `<h1>${model.title}</h1><h2>Slide ${i+1}</h2><p>${s.title || ''}</p><pre>${s.notes || ''}</pre>`;
    };
    slidesDiv.appendChild(el);
  });
}

document.getElementById('new').onclick = async () => {
  const data = await invoke('new_presentation');
  currentModel = JSON.parse(data);
  currentPath = null;
  renderSlides(currentModel);
  log.textContent = 'New presentation created';
};

document.getElementById('open').onclick = async () => {
  try {
    const path = await invoke('open_file_dialog');
    if (!path) return;
    const data = await invoke('open_pptx', { path });
    currentModel = JSON.parse(data);
    currentPath = path;
    renderSlides(currentModel);
    document.getElementById('main').innerHTML = `<h1>${currentModel.title}</h1><p>${currentModel.slides.length} slides loaded</p>`;
    log.textContent = 'Opened: ' + path;
  } catch(e) { log.textContent = e; }
};

document.getElementById('save').onclick = async () => {
  if (!currentModel) { log.textContent = 'No presentation loaded'; return; }
  const path = await invoke('save_file_dialog');
  if (!path) return;
  await invoke('save_pptx', { path, data: JSON.stringify(currentModel) });
  currentPath = path;
  log.textContent = 'Saved: ' + path;
};
