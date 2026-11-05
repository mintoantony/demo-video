var user = JSON.parse(localStorage.getItem('fixtureUser') || 'null');
if (!user) location.href = 'index.html';
document.addEventListener('DOMContentLoaded', function () {
  var h = document.querySelector('header');
  h.innerHTML = '<b>Fixture Garden Co</b><span id="who">Signed in as ' + (user ? user.name : '') + '</span><span id="menu"></span>';
  // The menu depends on the role and appears a moment after the page loads.
  setTimeout(function () {
    var m = '<a href="dashboard.html">Dashboard</a> <a href="form.html">New request</a> <a href="list.html">Requests</a> <a href="slow.html">Slow report</a>';
    if (user && user.role === 'manager') m += ' <a href="approvals.html">Approvals</a>';
    document.getElementById('menu').innerHTML = m;
  }, 500);
});
