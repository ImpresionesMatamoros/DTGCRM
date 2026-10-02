/* DTG CRM — service worker de NOTIFICACIONES. Nada más.
 *
 * DECISIÓN DELIBERADA: este archivo NO tiene un listener de "fetch".
 * La versión anterior del CRM evitaba a propósito un service worker por el
 * riesgo de servir código o datos viejos. Sin listener de fetch el navegador
 * no intercepta NINGUNA petición: es imposible que esta pieza sirva algo
 * desactualizado. Si alguien agrega un fetch aquí, se rompe esa garantía.
 *
 * Solo hace dos cosas: recibir un push y abrir la conversación al tocarlo.
 */
"use strict";

var DTG_TAG = "dtg-chat";

self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function(event){
  var d = {};
  try{ d = event.data ? event.data.json() : {}; }catch(e){ d = {}; }
  var autor = d.autor || "Equipo";
  var cuerpo = d.cuerpo || "";
  var kind = d.kind;
  if(["personal","mencion","respuesta"].indexOf(kind)===-1) return;           /* mensaje | mencion | equipo */
  var titulo = kind === "mencion" ? (autor + " te mencionó")
             : kind === "respuesta" ? (autor + " te respondió")
             : autor;
  event.waitUntil((async function(){
    try{
      var unread = Number(d.unread || 0);
      if(self.navigator && self.navigator.setAppBadge){
        if(unread > 0) await self.navigator.setAppBadge(unread);
        else if(self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
      }
    }catch(e){}
    return self.registration.showNotification(titulo, {
      body: cuerpo,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      /* Un tag por mensaje: dos avisos distintos no se pisan, pero el MISMO
         mensaje entregado dos veces reemplaza en vez de duplicar. */
      tag: DTG_TAG + "-" + (d.postId || Date.now()),
      renotify: kind !== "mensaje",
      requireInteraction: false,
      silent: false,
      data: { postId: d.postId || null, url: d.url || "./?chat=1", unread: Number(d.unread || 0) }
    });
  })());
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  var destino = (event.notification.data && event.notification.data.url) || "./?chat=1";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(lista){
      /* Si el CRM ya está abierto en alguna pestaña, se ENFOCA esa en vez de
         abrir una nueva — y se le dice a qué mensaje ir. */
      for(var i = 0; i < lista.length; i++){
        var c = lista[i];
        if(c.url.indexOf(self.registration.scope) === 0 && "focus" in c){
          try{ c.postMessage({ type: "dtg-open-chat", postId: (event.notification.data||{}).postId || null }); }catch(e){}
          return c.focus();
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});

/* Si el navegador rota la suscripción, la app la vuelve a registrar al
   siguiente arranque; aquí solo se avisa a las pestañas abiertas. */
self.addEventListener("pushsubscriptionchange", function(){
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(lista){
    lista.forEach(function(c){ try{ c.postMessage({ type: "dtg-resubscribe" }); }catch(e){} });
  });
});

