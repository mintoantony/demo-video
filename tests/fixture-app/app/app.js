// Client-side routed portal: views switch with history.pushState, no reload.
// The nav appears only after an async capabilities fetch (a capability-driven menu).
window.__spaLoad = Math.random();
var titles = { home: 'Portal home', reports: 'Reports', team: 'Team' };
function viewOf(path) { var m = /^\/app\/(\w+)/.exec(path); return m && titles[m[1]] ? m[1] : 'home'; }
function render(v) {
  document.getElementById('view-title').textContent = titles[v];
  var el = document.getElementById('view');
  if (v === 'home') el.innerHTML = '<p>Welcome to the portal. <a href="/app/request.html" id="new-request">New request</a></p>';
  else if (v === 'team') el.innerHTML = '<p id="team">Team: Ada Fixture, Ben Sample.</p>';
  else {
    el.innerHTML = '<p id="rep">Loading the report...</p>';
    fetch('/api/report').then(function (r) { return r.json(); }).then(function (d) {
      if (viewOf(location.pathname) === 'reports') document.getElementById('view').innerHTML = '<p id="rep">' + d.text + '</p>';
    });
  }
}
function go(v, push) { if (push) history.pushState({}, '', '/app/' + (v === 'home' ? '' : v)); render(v); }
window.onpopstate = function () { render(viewOf(location.pathname)); };
document.getElementById('signout').onclick = function () {
  fetch('/api/signout', { method: 'POST' }).then(function () { location.href = '/app/signin.html'; });
};
fetch('/api/me').then(function (r) { return r.json(); }).then(function (me) {
  document.getElementById('who').textContent = 'Signed in as ' + me.name;
  render(viewOf(location.pathname));
  return fetch('/api/caps').then(function (r) { return r.json(); });
}).then(function (caps) {
  var nav = document.getElementById('nav');
  nav.innerHTML = caps.views.map(function (v) { return '<a data-view="' + v + '">' + titles[v] + '</a>'; }).join(' ');
  nav.hidden = false;
  nav.onclick = function (e) { var v = e.target.dataset && e.target.dataset.view; if (v) go(v, true); };
});
