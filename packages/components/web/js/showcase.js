import { generateQsmxtCommand, mountImagingWorkspace } from '../../src/index.js';

const root = document.getElementById('app');
const controls = document.createElement('aside');
const viewer = document.createElement('main');
const status = document.createElement('footer');
controls.id = 'controls'; viewer.id = 'viewer'; status.id = 'status';
root.append(controls, viewer, status);

const workspace = mountImagingWorkspace({ root, controls, viewer, status, title: 'Neurodesk Webapp Components', subtitle: 'Reusable imaging primitives' });
workspace.classList.add('nd-app-container');

const sections = [
  ['File I/O', 'FileIOController handles NIfTI and DICOM inputs.'],
  ['Pipeline Outputs', 'PipelineExecutor emits reusable stage results.'],
  ['Viewer Controls', 'ViewerController owns NiiVue volume lifetimes and display controls.'],
  ['Worker Toolkit', 'Module workers share routing, transfer, model-fetch, and cache plumbing.'],
  ['QSM Pipeline', generateQsmxtCommand({ dipoleInversion: 'tv', tv: { lambda: 0.01 } })],
  ['Validation Report', 'Validation renderers surface acquisition checks before inference.']
];
for (const [title, text] of sections) {
  const section = document.createElement('section'); section.className = 'nd-sidebar-section';
  const heading = document.createElement('h2'); heading.textContent = title;
  const copy = document.createElement(title === 'QSM Pipeline' ? 'code' : 'p'); copy.textContent = text;
  section.append(heading, copy); controls.append(section);
}

viewer.className += ' showcase-viewer';
viewer.innerHTML = '<div><h2>Shared NiiVue viewer surface</h2><p>Base volumes, overlays, stage outputs, window controls, and stable object URLs.</p><div class="showcase-slices"><div class="showcase-slice"></div><div class="showcase-slice"></div><div class="showcase-slice"></div></div></div>';
status.textContent = 'Shared workspace, controls, viewer, worker protocol, and scientific I/O ready.';
