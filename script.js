// ---------- Worker for gif.js ----------
const GIF_WORKER_URL = URL.createObjectURL(new Blob(
  ["importScripts('https://unpkg.com/gif.js.optimized/dist/gif.worker.js');"],
  { type: 'application/javascript' }
));

// ---------- Helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function createBeep() {
  let ctx;
  return function beep(freq=880, ms=120, type='square'){
    try{
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms/1000);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + ms/1000);
    }catch(e){}
  }
}
const beep = createBeep();

function makeSquareCanvas(size){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = false;
  return [c, cx];
}

// Square “contain” with a tiny overscale to kill hairline gaps
function drawSquareContain(source, size){
  const [c, cx] = makeSquareCanvas(size);
  const w = source.videoWidth || source.naturalWidth || source.width || source.clientWidth;
  const h = source.videoHeight || source.naturalHeight || source.height || source.clientHeight;
  const scale = Math.min(size / w, size / h) * 1.01; // 1% overscale
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  const x = Math.floor((size - nw) / 2);
  const y = Math.floor((size - nh) / 2);
  cx.fillStyle = '#000'; cx.fillRect(0,0,size,size);
  cx.drawImage(source, 0, 0, w, h, x, y, nw, nh);
  return c;
}

// Overlay a transparent PNG frame on a frame canvas
function applyOverlayFrame(srcCanvas, overlayImg){
  const size = srcCanvas.width;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const cx = out.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = false;
  cx.drawImage(srcCanvas, 0, 0);
  if (overlayImg && overlayImg.complete) {
    try { cx.drawImage(overlayImg, 0, 0, size, size); } catch(_) {}
  }
  return out;
}

// ---------- Tabs ----------
const tabUploadBtn = document.getElementById('tab-upload');
const tabCameraBtn = document.getElementById('tab-camera');
const uploadSection = document.getElementById('upload-section');
const cameraSection = document.getElementById('camera-section');

function setTab(which){
  if(which==='upload'){
    tabUploadBtn.classList.remove('secondary');
    tabCameraBtn.classList.add('secondary');
    uploadSection.style.display='';
    cameraSection.style.display='none';
  }else{
    tabCameraBtn.classList.remove('secondary');
    tabUploadBtn.classList.add('secondary');
    cameraSection.style.display='';
    uploadSection.style.display='none';
    ensureCameraReady();
  }
}
tabUploadBtn.onclick = () => setTab('upload');
tabCameraBtn.onclick = () => setTab('camera');

// ---------- Upload handling ----------
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file-input');
const uploadGrid = document.getElementById('upload-grid');
const makeGifUploadBtn = document.getElementById('make-gif-upload');
const uploadStatus = document.getElementById('upload-status');
const gifSizeSel = document.getElementById('gif-size');
const uploadDelay = document.getElementById('upload-delay');
const repeatInfinite = document.getElementById('repeat-infinite') || { checked: true };

let uploadImages = []; // Image objects in order

function refreshUploadUI(){
  uploadGrid.innerHTML = '';
  uploadImages.forEach(img=>{
    const d = document.createElement('div'); d.className='thumb';
    d.appendChild(img);
    uploadGrid.appendChild(d);
  });
  const n = uploadImages.length;
  const ok = n>=10 && n<=20;
  makeGifUploadBtn.disabled = !ok;
  uploadStatus.textContent = ok ? `Ready: ${n} images` : (n ? `Need 10–20 images (currently ${n})` : '');
}

function ingestFiles(files){
  const list = Array.from(files).filter(f=>f.type.startsWith('image/'));
  if(!list.length) return;
  const max = 20 - uploadImages.length;
  const chosen = list.slice(0, max);
  chosen.forEach(f=>{
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      img.style.width='100%'; img.style.height='100%'; img.style.objectFit='cover';
      img.style.imageRendering='pixelated';
      refreshUploadUI();
    };
    img.src = url;
    uploadImages.push(img);
  });
  refreshUploadUI();
}

drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('drag');
  ingestFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => ingestFiles(e.target.files));

// ---------- Camera capture ----------
const video = document.getElementById('video');
const countdownEl = document.getElementById('countdown');
const startBtn = document.getElementById('start-camera');
const stopBtn = document.getElementById('stop-camera');
const shotCount = document.getElementById('shot-count');
const intervalSecs = document.getElementById('interval-secs');
const preCountSecs = document.getElementById('precount-secs');
const cameraDelay = document.getElementById('camera-delay');
const gifSizeCam = document.getElementById('gif-size-camera');
const cameraStatus = document.getElementById('camera-status');
const mirrorPreview = document.getElementById('mirror-preview');

let stream = null;
let stopFlag = false;

function applyPreviewMirror(){
  video.style.transform = mirrorPreview.checked ? 'scaleX(-1)' : 'none';
}
mirrorPreview.addEventListener('change', applyPreviewMirror);
applyPreviewMirror();

async function ensureCameraReady(){
  if(stream) return;
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
  }catch(err){
    cameraStatus.textContent = 'Camera error: ' + (err?.message || err);
  }
}

async function doCountdown(n){
  for(let i=n; i>0; i--){
    countdownEl.textContent = i;
    beep(880, 120);
    await sleep(1000);
  }
  countdownEl.textContent = '★';
  beep(1200, 200);
  await sleep(120);
  countdownEl.textContent = '';
}

async function captureSeries(){
  cameraStatus.textContent = '';
  const N = Math.max(10, Math.min(20, Number(shotCount.value)||20));
  const gap = Math.max(1, Math.min(5, Number(intervalSecs.value)||2)) * 1000;
  const prec = Math.max(1, Math.min(3, Number(preCountSecs.value)||3));
  const size = Number(gifSizeCam.value)||320;

  stopFlag = false; startBtn.disabled = true; stopBtn.disabled = false;

  const frames = [];
  for(let i=0; i<N; i++){
    if(stopFlag) break;
    await doCountdown(prec);

    const base = drawSquareContain(video, size);
    const overlay = PRELOADED_FRAMES.get(selectedFrameId);
    frames.push(overlay ? applyOverlayFrame(base, overlay) : base);

    cameraStatus.textContent = `Captured ${frames.length}/${N}`;
    if(i < N - 1){
      const remaining = gap - 120;
      await sleep(Math.max(0, remaining));
    }
  }
  startBtn.disabled = false; stopBtn.disabled = true;

  if (frames.length >= 10) {
    const delay = Math.max(20, Number(cameraDelay.value)||120);
    await buildGif(frames, { delay, repeat: 0, size });
  } else {
    cameraStatus.textContent = `Capture cancelled (only ${frames.length}/${N}).`;
  }
}

startBtn.addEventListener('click', captureSeries);
stopBtn.addEventListener('click', ()=>{ stopFlag = true; startBtn.disabled=false; stopBtn.disabled=true; countdownEl.textContent=''; });

// ---------- Frames ----------
const FRAME_OPTIONS = [
  { id: 'none',    name: 'None',          src: null },
  { id: 'hearts',  name: 'Golden Hearts', src: 'borders/apples_and_hearts.png' },
  { id: 'pearls',  name: 'Pearls',        src: 'borders/watermelon_frame.png' },
  { id: 'retro',   name: 'Retro TV',      src: 'borders/piano_cutesy.png' },
  { id: 'sparkle', name: 'Sparkle',       src: 'frames/sparkle.png' },
];

const PRELOADED_FRAMES = new Map();
let selectedFrameId = 'none';

const framePreviewImg = document.getElementById('frame-preview');

function updateFramePreview(){
  const opt = FRAME_OPTIONS.find(o => o.id === selectedFrameId);
  if (opt && opt.src){
    framePreviewImg.src = opt.src;
    framePreviewImg.style.display = '';
  } else {
    framePreviewImg.removeAttribute('src');
    framePreviewImg.style.display = 'none';
  }
}

function preloadFrames(){
  FRAME_OPTIONS.forEach(opt=>{
    if (!opt.src) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = opt.src;
    PRELOADED_FRAMES.set(opt.id, img);
  });
}

function renderFrameChooser(containerId){
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';

  FRAME_OPTIONS.forEach(opt=>{
    const thumb = document.createElement('div');
    thumb.className = 'frame-thumb' + (opt.src ? '' : ' none');
    thumb.title = opt.name;

    if (opt.src){
      const img = new Image();
      img.src = opt.src;
      thumb.appendChild(img);
    }

    if (opt.id === selectedFrameId) thumb.classList.add('selected');

    thumb.onclick = ()=>{
      selectedFrameId = opt.id;

      // update selection highlights across all choosers
      document.querySelectorAll('.frame-chooser .frame-thumb').forEach(t=>t.classList.remove('selected'));
      // mark all thumbs with same title (name) as selected
      document.querySelectorAll('.frame-chooser .frame-thumb').forEach(t=>{
        if (t.title === opt.name) t.classList.add('selected');
      });

      updateFramePreview();
    };

    wrap.appendChild(thumb);
  });
}

// Render pickers
preloadFrames();
renderFrameChooser('frame-chooser');          // camera tab
renderFrameChooser('upload-frame-chooser');   // upload tab
updateFramePreview();

// Keep the camera preview box square in sync with dropdown
const camBox = document.querySelector('.camera-wrap');
function syncPreviewSize(){
  const s = Number(gifSizeCam.value) || 320;
  camBox.style.width = camBox.style.height = s + 'px';
}
gifSizeCam.addEventListener('change', syncPreviewSize);
syncPreviewSize();

// ---------- GIF builder ----------
const bar = document.getElementById('bar');
const progressStatus = document.getElementById('progress-status');
const resultEl = document.getElementById('result');
const shareRow = document.getElementById('share-row');
const dlBtn = document.getElementById('download');
const shareBtn = document.getElementById('share');
const copyBtn = document.getElementById('copygif');
const openTab = document.getElementById('open-tab');

let lastBlob = null;
let lastURL = null;

async function buildGif(frames, {delay=120, repeat=0, size=320}={}){
  if (lastURL) { URL.revokeObjectURL(lastURL); lastURL = null; }
  lastBlob = null; resultEl.innerHTML=''; shareRow.style.display='none';
  bar.style.width='0%'; progressStatus.textContent='Encoding…';

  let resolved = false;

  try {
    const gif = new GIF({
      workers: 2,
      quality: 10,
      workerScript: GIF_WORKER_URL,
      width: size, height: size,
      repeat
    });

    frames.forEach((frame) => gif.addFrame(frame, { copy: true, delay }));

    gif.on('progress', p => { bar.style.width = Math.floor(p * 100) + '%'; });

    const TIMEOUT_MS = 30000;
    const finished = new Promise((resolve, reject) => {
      gif.on('finished', resolve);
      gif.on('abort', () => reject(new Error('Encoding aborted')));
      gif.on('error', (e) => reject(e || new Error('Encoding error')));
      gif.render();
    });

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Encoding timed out')), TIMEOUT_MS));

    const blob = await Promise.race([finished, timeout]);
    resolved = true;

    lastBlob = blob;
    lastURL  = URL.createObjectURL(blob);

    const img = new Image();
    img.src = lastURL;
    img.alt = 'Your animated GIF';
    img.loading = 'eager';
    resultEl.innerHTML = '';
    resultEl.appendChild(img);

    progressStatus.textContent = 'Done!';
    shareRow.style.display = '';
    openTab.href = lastURL;
  } catch (err) {
    progressStatus.textContent = 'Failed to encode GIF. ' + (err && err.message ? err.message : '');
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Tip: if you opened the file directly (file://), host it over http(s) so the worker can run.';
    resultEl.innerHTML = '';
    resultEl.appendChild(hint);
  } finally {
    if (!resolved) { bar.style.width = '0%'; }
  }
}

// Upload → GIF (with optional frame)
makeGifUploadBtn.addEventListener('click', async ()=>{
  const size = Number(gifSizeSel.value)||320;
  const delay = Math.max(20, Number(uploadDelay.value)||120);
  const overlay = PRELOADED_FRAMES.get(selectedFrameId);

  const frames = uploadImages.map(img => {
    const base = drawSquareContain(img, size);
    return overlay ? applyOverlayFrame(base, overlay) : base;
  });

  await buildGif(frames, { delay, repeat: repeatInfinite.checked ? 0 : 1, size });
});

// ---------- Share + Download ----------
dlBtn.addEventListener('click', ()=>{
  if(!lastBlob) return;
  const a = document.createElement('a');
  a.href = lastURL;
  a.download = 'pixel-gif-booth.gif';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

shareBtn.addEventListener('click', async ()=>{
  if(!lastBlob) return;
  const file = new File([lastBlob], 'pixel-gif-booth.gif', { type: 'image/gif' });
  if(navigator.canShare && navigator.canShare({ files:[file] })){
    try{
      await navigator.share({ files:[file], title:'My pixel GIF', text:'Made with Pixel GIF Booth ✨' });
    }catch(e){}
  }else{
    alert('Your browser does not support system sharing for files. Download the GIF and share it in your app.');
  }
});

copyBtn.addEventListener('click', async ()=>{
  if(!lastBlob) return;
  try{
    if(navigator.clipboard && window.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({ [lastBlob.type]: lastBlob })]);
      alert('GIF copied to clipboard! Paste it where you like.');
    }else{
      throw new Error('Clipboard not supported');
    }
  }catch(e){
    alert('Clipboard image copy not supported here. Download the GIF instead.');
  }
});

// ---------- Upload validation polish ----------
const enableMakeIfValid = () => {
  const n = uploadImages.length;
  makeGifUploadBtn.disabled = !(n>=10 && n<=20);
  uploadStatus.textContent = n ? (makeGifUploadBtn.disabled ? `Need 10–20 images (currently ${n})` : `Ready: ${n} images`) : '';
};
const origRefresh = refreshUploadUI;
refreshUploadUI = function(){ origRefresh(); enableMakeIfValid(); };

// Default tab
setTab('camera');

// Keyboard focus helper for outlines (optional)
document.body.addEventListener('keydown', (e)=>{ if(e.key === 'Tab'){ document.body.classList.add('kbd'); } });

// Nice glass cursor hotspot (optional)
(function(){
  const glassAreas = document.querySelectorAll('.card, .pill, .drop, .btn');
  const setSpot = (el, e) => {
    const r = el.getBoundingClientRect();
    const x = ((e?.clientX ?? (r.left + r.width/2)) - r.left) / r.width * 100;
    const y = ((e?.clientY ?? (r.top + r.height/2)) - r.top) / r.height * 100;
    el.style.setProperty('--spot-x', `${x}%`);
    el.style.setProperty('--spot-y', `${y}%`);
  };
  glassAreas.forEach(el => {
    setSpot(el, null);
    el.addEventListener('mousemove', (e)=> setSpot(el, e));
    el.addEventListener('mouseleave', ()=> setSpot(el, null));
  });
})();
