document.addEventListener('DOMContentLoaded',function(){
 if(window.DTGClientForms&&window.supabase&&window.DTG_PUBLIC_CONFIG)window.DTGClientForms.publicStart();
 else document.getElementById('client-form-app').textContent='No pudimos cargar el formulario. Revisa tu conexión y vuelve a abrir el enlace.';
});
window.addEventListener('hashchange',function(){if(window.DTGClientForms)window.DTGClientForms.publicStart();});
