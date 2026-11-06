// player.mjs - the player.html page: plays every clip in order, click a chapter to jump.
import { esc } from './util.mjs';

export function playerHtml(title, timeline, seekMode) {
  const data = JSON.stringify(timeline).replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
 body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0b1530;color:#fff;display:flex;min-height:100vh}
 nav{width:320px;padding:16px;background:#101c40;overflow:auto}
 nav h1{font-size:18px;color:#ffd400;margin:0 0 12px}
 nav button{display:block;width:100%;text-align:left;margin:0 0 6px;padding:10px;border:0;border-radius:6px;background:#1a2a5c;color:#fff;font-size:15px;cursor:pointer}
 nav button.on{background:#ffd400;color:#0b1530;font-weight:700}
 nav small{opacity:.7}
 main{flex:1;padding:16px}
 video{width:100%;max-height:90vh;background:#000}
</style></head><body>
<nav><h1>${esc(title)}</h1><div id="list"></div></nav>
<main><video id="v" controls autoplay muted></video><p id="now"></p></main>
<script>
const clips = ${data};
const seek = ${seekMode ? 'true' : 'false'};
const v = document.getElementById('v'), list = document.getElementById('list'), now = document.getElementById('now');
let i = 0;
function play(k){
  i = k;
  const c = clips[k];
  const go = function(){ if (seek) v.currentTime = c.segStart; v.play().catch(function(){}); };
  if (seek && v.getAttribute('data-src') === c.file && v.readyState >= 1) { go(); }
  else {
    v.setAttribute('data-src', c.file);
    v.src = c.file;
    if (seek) v.addEventListener('loadedmetadata', go, { once: true }); else v.play().catch(function(){});
  }
  now.textContent = (k+1) + ' / ' + clips.length + ': ' + c.title;
  Array.prototype.forEach.call(list.children, function(b, j){ b.className = j === k ? 'on' : ''; });
}
clips.forEach(function(c, k){ const b = document.createElement('button'); b.innerHTML = c.startText + ' ' + c.title.replace(/</g,'&lt;') + ' <small>(' + c.kind + ')</small>'; b.onclick = function(){ play(k); }; list.appendChild(b); });
v.addEventListener('ended', function(){ if (i + 1 < clips.length) play(i + 1); });
if (seek) v.addEventListener('timeupdate', function(){ const c = clips[i]; if (c && v.currentTime >= c.segEnd - 0.05 && i + 1 < clips.length) play(i + 1); });
play(0);
</script></body></html>
`;
}
