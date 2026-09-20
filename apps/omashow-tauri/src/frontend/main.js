const log = document.getElementById('log');
async function invoke(cmd, args={}) {
  return await window.__TAURI__.core.invoke(cmd, args);
}
document.getElementById('open').onclick = async () => {
  try {
    const path = await invoke('open_file_dialog');
    const data = await invoke('open_pptx', { path });
    log.textContent = 'Opened: ' + path + '\n' + data.slice(0,500);
  } catch(e) { log.textContent = e; }
};
document.getElementById('new').onclick = () => {
  log.textContent = 'New presentation created';
};
document.getElementById('save').onclick = () => {
  log.textContent = 'Save not implemented yet';
};
