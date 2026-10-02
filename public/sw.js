/* COFFEE RUN service worker：プッシュ通知を受け取って表示する（画面のキャッシュはしない） */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

// 届いた通知は必ず表示する（iPhone は、表示しない通知が続くと購読を止めてしまう）
self.addEventListener('push', function(e){
  var d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = {t:'COFFEE RUN', b:e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.t || 'COFFEE RUN', {
    body:d.b || '新しいお知らせがあります',
    icon:'/assets/icon-192.png?v=2',
    badge:'/assets/badge-96.png',
    tag:d.g || undefined,
    renotify:!!d.g,
    data:{url:d.u || '/'}
  }));
});

// 購読が切れた・入れ替わったときは、すぐに作り直してサーバーに登録する
self.addEventListener('pushsubscriptionchange', function(e){
  e.waitUntil((async function(){
    try{
      var k = await (await fetch('/api/push/key', {credentials:'include'})).json();
      var raw = atob(k.key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - k.key.length % 4) % 4));
      var key = Uint8Array.from(raw, function(c){ return c.charCodeAt(0); });
      var sub = await self.registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:key});
      var j = sub.toJSON();
      await fetch('/api/push/subscribe', {method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body:JSON.stringify({endpoint:j.endpoint, keys:j.keys})});
    }catch(err){}
  })());
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async function(){
    var list = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for(var i = 0; i < list.length; i++){
      if(list[i].url.indexOf(self.location.origin) === 0){
        await list[i].focus();
        list[i].postMessage({type:'go', url:url});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
