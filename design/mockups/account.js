/* Account actions: this client has independent logins, not shared profiles. */
(()=>{
 const trigger=document.querySelector('#avatarBtn');if(!trigger)return;
 let menu;
 function close(){menu?.remove();menu=null;trigger.setAttribute('aria-expanded','false')}
 trigger.addEventListener('click',e=>{
  e.stopImmediatePropagation();e.preventDefault();
  if(menu){close();return}
  const raw=localStorage.getItem('nutfin5-profile');let name='Sam';try{name=JSON.parse(raw)==='riz'?'Riz':'Sam'}catch{}
  menu=document.createElement('section');menu.className='account-menu';menu.setAttribute('aria-label','Account');menu.setAttribute('role','dialog');
  const box=trigger.getBoundingClientRect();menu.style.top=box.bottom+10+'px';
  menu.innerHTML='<h2>'+name+'</h2><p>Signed in to NutFin</p><details class="nf-disclosure"><summary>Appearance</summary><div class="appearance"><button type="button" data-appearance="dark">Dark</button><button type="button" data-appearance="light">Light</button></div></details><button type="button" class="account-out">Sign out</button>';
  document.body.append(menu);trigger.setAttribute('aria-expanded','true');menu.querySelector('summary').focus();
  menu.addEventListener('click',e=>{
   const b=e.target.closest('[data-appearance]');
   if(b){const theme=b.dataset.appearance;
    if(typeof setTheme==='function')setTheme(theme);
    else{document.documentElement.dataset.theme=theme;document.documentElement.dataset.eff=theme;localStorage.setItem('nutfin5-theme',JSON.stringify(theme))}
   }
   if(e.target.closest('.account-out')){localStorage.removeItem('nutfin5-profile');location.href='login.html'}
  });
 },true);
 document.addEventListener('click',e=>{if(menu&&!menu.contains(e.target)&&!trigger.contains(e.target))close()});
 document.addEventListener('keydown',e=>{
  if(!menu)return;
  if(e.key==='Escape'){close();trigger.focus()}
  if(e.key==='Tab'){
   const targets=[...menu.querySelectorAll('summary,button')].filter(x=>x.getClientRects().length),i=targets.indexOf(document.activeElement);
   if(e.shiftKey&&i===0){e.preventDefault();targets.at(-1).focus()}else if(!e.shiftKey&&i===targets.length-1){e.preventDefault();targets[0].focus()}
  }
 });
})();
