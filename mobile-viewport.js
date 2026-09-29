/* Visual viewport only. No data, navigation, focus or subscriptions. */
(function(){
  'use strict';
  var frame=0, root=document.documentElement, vv=window.visualViewport;
  function update(){
    frame=0;
    // Pinch zoom belongs to the user. Do not resize the application while zooming.
    if(vv && Math.abs(vv.scale-1)>0.05)return;
    root.style.setProperty('--mobile-vh',(vv?vv.height:window.innerHeight)+'px');
    root.style.setProperty('--mobile-top',(vv?vv.offsetTop:0)+'px');
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  if(vv){vv.addEventListener('resize',schedule,{passive:true});vv.addEventListener('scroll',schedule,{passive:true});}
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('pageshow',schedule);
  update();
})();
